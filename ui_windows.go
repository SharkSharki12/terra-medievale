//go:build windows

package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	shell32                 = windows.NewLazySystemDLL("shell32.dll")
	kernel32                = windows.NewLazySystemDLL("kernel32.dll")
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procGetWindowLongPtr    = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr    = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW     = user32.NewProc("CallWindowProcW")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procGetWindowRect       = user32.NewProc("GetWindowRect")
	procMonitorFromWnd      = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	procIsZoomed            = user32.NewProc("IsZoomed")
	procIsIconic            = user32.NewProc("IsIconic")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procRegisterClassExW    = user32.NewProc("RegisterClassExW")
	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procDefWindowProcW      = user32.NewProc("DefWindowProcW")
	procDestroyWindow       = user32.NewProc("DestroyWindow")
	procCreatePopupMenu     = user32.NewProc("CreatePopupMenu")
	procAppendMenuW         = user32.NewProc("AppendMenuW")
	procSetMenuDefaultItem  = user32.NewProc("SetMenuDefaultItem")
	procTrackPopupMenu      = user32.NewProc("TrackPopupMenu")
	procDestroyMenu         = user32.NewProc("DestroyMenu")
	procGetCursorPos        = user32.NewProc("GetCursorPos")
	procPostMessageW        = user32.NewProc("PostMessageW")
	procLoadImageW          = user32.NewProc("LoadImageW")
	procGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	procFindWindowW         = user32.NewProc("FindWindowW")
	procRegisterWindowMsgW  = user32.NewProc("RegisterWindowMessageW")
	procShellNotifyIconW    = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
)

const (
	gwlStyle           = ^uintptr(15) // -16
	gwlpWndProc        = ^uintptr(3)  // -4
	wsOverlappedWindow = 0x00CF0000
	swHide             = 0
	swShow             = 5
	swMaximize         = 3
	swRestore          = 9
	swpNoZOrder        = 0x0004
	swpNoOwnerZOrder   = 0x0200
	swpFrameChanged    = 0x0020
	monitorNearest     = 2
	mbIconInformation  = 0x40
	mbIconError        = 0x10

	wmNull          = 0x0000
	wmClose         = 0x0010
	wmCommand       = 0x0111
	wmLButtonUp     = 0x0202
	wmLButtonDblClk = 0x0203
	wmRButtonUp     = 0x0205
	wmTrayCallback  = 0x8000 + 11 // WM_APP + 11 (WM_APP seul est réservé par la bibliothèque webview)
	wmShowWindow    = 0x8000 + 12
	ninBalloonClick = 0x0405

	nimAdd     = 0
	nimModify  = 1
	nimDelete  = 2
	nifMessage = 0x1
	nifIcon    = 0x2
	nifTip     = 0x4
	nifInfo    = 0x10
	niifUser   = 0x4

	mfString       = 0x0
	mfSeparator    = 0x800
	mfChecked      = 0x8
	tpmRightButton = 0x2
	tpmNoNotify    = 0x80
	tpmReturnCmd   = 0x100

	trayClassName = "TerraMedievaleTray"
	runKeyPath    = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName  = "TerraMedievale"
)

type rect struct{ Left, Top, Right, Bottom int32 }
type point struct{ X, Y int32 }
type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}
type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}
type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     uintptr
}

// ---------- état ----------
var (
	mainHwnd    uintptr
	trayHwnd    uintptr
	trayIcon    uintptr
	trayAdded   bool
	oldWndProc  uintptr
	quitting    bool
	instanceMtx windows.Handle
	theView     webview2.WebView
	taskbarMsg  uintptr
	nativeCfg   = struct {
		CloseToTray bool `json:"closeToTray"`
		TrayHinted  bool `json:"trayHinted"`
	}{CloseToTray: true}
	cfgMu sync.Mutex
)

func cfgPath() string { return filepath.Join(dataDir(), "native.json") }
func loadNativeCfg() {
	if b, err := os.ReadFile(cfgPath()); err == nil {
		_ = json.Unmarshal(b, &nativeCfg)
	}
}
func saveNativeCfg() {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	b, _ := json.Marshal(nativeCfg)
	_ = os.WriteFile(cfgPath(), b, 0o644)
}

func utf16(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }
func copyUTF16(dst []uint16, s string) {
	u, _ := windows.UTF16FromString(s)
	if len(u) > len(dst) {
		u = u[:len(dst)]
		u[len(u)-1] = 0
	}
	copy(dst, u)
}

// ---------- fenêtre unique ----------
// renvoie false si une autre instance tourne déjà (elle est alors ramenée au premier plan)
func acquireSingleInstance() bool {
	for i := 0; i < 30; i++ {
		h, err := windows.CreateMutex(nil, false, utf16("Local\\TerraMedievaleSingleInstance"))
		if err == nil {
			instanceMtx = h
			return true
		}
		if h != 0 {
			windows.CloseHandle(h)
		}
		if err != windows.ERROR_ALREADY_EXISTS {
			return true
		}
		if !hasArg("--updated") {
			if w, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(utf16(trayClassName))), 0); w != 0 {
				procPostMessageW.Call(w, wmShowWindow, 0, 0)
			}
			return false
		}
		time.Sleep(300 * time.Millisecond) // après une mise à jour : l'ancienne version se termine
	}
	return true
}

func releaseSingleInstance() {
	if instanceMtx != 0 {
		windows.CloseHandle(instanceMtx)
		instanceMtx = 0
	}
}

// ---------- démarrage avec Windows ----------
func autostartEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue(runValueName)
	return err == nil
}
func setAutostart(on bool) bool {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	if on {
		exe, err := os.Executable()
		if err != nil {
			return false
		}
		return k.SetStringValue(runValueName, `"`+exe+`" --background`) == nil
	}
	_ = k.DeleteValue(runValueName)
	return true
}

// ---------- icône de la zone de notification ----------
func loadAppIcon(small bool) uintptr {
	hinst, _, _ := procGetModuleHandleW.Call(0)
	cx, cy := uintptr(0), uintptr(0)
	if small {
		cx, _, _ = procGetSystemMetrics.Call(49) // SM_CXSMICON
		cy, _, _ = procGetSystemMetrics.Call(50)
	}
	h, _, _ := procLoadImageW.Call(hinst, 2, 1, cx, cy, 0) // ressource n°2 = icône du jeu
	return h
}

func trayData(flags uint32) *notifyIconData {
	d := &notifyIconData{}
	d.CbSize = uint32(unsafe.Sizeof(*d))
	d.HWnd = trayHwnd
	d.UID = 1
	d.UFlags = flags
	return d
}

func trayAdd() {
	if trayHwnd == 0 {
		return
	}
	d := trayData(nifMessage | nifIcon | nifTip)
	d.UCallbackMessage = wmTrayCallback
	d.HIcon = trayIcon
	copyUTF16(d.SzTip[:], "Terra Médiévale")
	r, _, _ := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(d)))
	trayAdded = r != 0
}

func trayRemove() {
	if !trayAdded {
		return
	}
	d := trayData(0)
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(d)))
	trayAdded = false
}

func trayNotify(title, text string) {
	if !trayAdded {
		return
	}
	d := trayData(nifInfo)
	copyUTF16(d.SzInfoTitle[:], title)
	copyUTF16(d.SzInfo[:], text)
	d.DwInfoFlags = niifUser
	d.HBalloonIcon = loadAppIcon(false)
	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(d)))
}

func windowVisible() bool {
	if mainHwnd == 0 {
		return false
	}
	v, _, _ := procIsWindowVisible.Call(mainHwnd)
	return v != 0
}

func showMain() {
	if mainHwnd == 0 {
		return
	}
	ic, _, _ := procIsIconic.Call(mainHwnd)
	if !windowVisible() || ic != 0 {
		procShowWindow.Call(mainHwnd, swRestore)
	}
	procShowWindow.Call(mainHwnd, swShow)
	procSetForegroundWindow.Call(mainHwnd)
	if theView != nil {
		theView.Eval("window.onTrayShow && window.onTrayShow()")
	}
}

func hideMain() {
	if mainHwnd == 0 {
		return
	}
	procShowWindow.Call(mainHwnd, swHide)
	if !nativeCfg.TrayHinted {
		nativeCfg.TrayHinted = true
		saveNativeCfg()
		trayNotify("Terra Médiévale continue en arrière-plan", "Ta ville grandit toujours. Clique sur l'icône en bas à droite pour revenir, ou clic droit → Quitter.")
	}
}

// quitter proprement : la page sauvegarde, puis on ferme
func quitApp() {
	if quitting {
		return
	}
	quitting = true
	if theView != nil {
		theView.Eval("try{window.app&&window.app.writeSave()}catch(e){}")
	}
	go func() {
		time.Sleep(1200 * time.Millisecond)
		if theView != nil {
			theView.Dispatch(func() {
				trayRemove()
				procDestroyWindow.Call(mainHwnd)
			})
		}
	}()
}

func showTrayMenu() {
	m, _, _ := procCreatePopupMenu.Call()
	if m == 0 {
		return
	}
	defer procDestroyMenu.Call(m)
	procAppendMenuW.Call(m, mfString, 1, uintptr(unsafe.Pointer(utf16("Ouvrir Terra Médiévale"))))
	procAppendMenuW.Call(m, mfSeparator, 0, 0)
	if !peamDistrib() {
		flags := uintptr(mfString)
		if autostartEnabled() {
			flags |= mfChecked
		}
		procAppendMenuW.Call(m, flags, 2, uintptr(unsafe.Pointer(utf16("Lancer au démarrage de Windows"))))
		procAppendMenuW.Call(m, mfSeparator, 0, 0)
	}
	procAppendMenuW.Call(m, mfString, 3, uintptr(unsafe.Pointer(utf16("Quitter"))))
	procSetMenuDefaultItem.Call(m, 1, 0)
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(trayHwnd)
	cmd, _, _ := procTrackPopupMenu.Call(m, tpmRightButton|tpmNoNotify|tpmReturnCmd, uintptr(pt.X), uintptr(pt.Y), 0, trayHwnd, 0)
	procPostMessageW.Call(trayHwnd, wmNull, 0, 0)
	switch cmd {
	case 1:
		showMain()
	case 2:
		setAutostart(!autostartEnabled())
	case 3:
		quitApp()
	}
}

func trayWndProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch msg {
	case wmTrayCallback:
		switch lp & 0xFFFF {
		case wmLButtonUp, wmLButtonDblClk, ninBalloonClick:
			showMain()
		case wmRButtonUp:
			showTrayMenu()
		}
		return 0
	case wmShowWindow:
		showMain()
		return 0
	}
	if taskbarMsg != 0 && msg == taskbarMsg { // l'Explorateur a redémarré : on remet l'icône
		trayAdded = false
		trayAdd()
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, msg, wp, lp)
	return r
}

func createTray() {
	hinst, _, _ := procGetModuleHandleW.Call(0)
	wc := wndClassEx{
		LpfnWndProc:   windows.NewCallback(trayWndProc),
		HInstance:     hinst,
		LpszClassName: utf16(trayClassName),
	}
	wc.CbSize = uint32(unsafe.Sizeof(wc))
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	trayHwnd, _, _ = procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(utf16(trayClassName))), uintptr(unsafe.Pointer(utf16("Terra Médiévale"))),
		0, 0, 0, 0, 0, 0, 0, hinst, 0)
	if trayHwnd == 0 {
		return
	}
	taskbarMsg, _, _ = procRegisterWindowMsgW.Call(uintptr(unsafe.Pointer(utf16("TaskbarCreated"))))
	trayIcon = loadAppIcon(true)
	trayAdd()
}

// la croix de la fenêtre cache le jeu dans la zone de notification au lieu de le quitter
func mainWndProc(hwnd, msg, wp, lp uintptr) uintptr {
	if msg == wmClose && !quitting {
		if nativeCfg.CloseToTray && trayAdded && !peamDistrib() {
			theView.Eval("try{window.app&&window.app.writeSave()}catch(e){}")
			hideMain()
			return 0
		}
		quitApp()
		return 0
	}
	r, _, _ := procCallWindowProcW.Call(oldWndProc, hwnd, msg, wp, lp)
	return r
}

// ---------- plein écran ----------
var fsState struct {
	on     bool
	style  uintptr
	r      rect
	wasMax bool
}

func toggleFullscreen(hwnd uintptr) {
	if !fsState.on {
		z, _, _ := procIsZoomed.Call(hwnd)
		fsState.wasMax = z != 0
		if fsState.wasMax {
			procShowWindow.Call(hwnd, swRestore)
		}
		fsState.style, _, _ = procGetWindowLongPtr.Call(hwnd, gwlStyle)
		procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&fsState.r)))
		mon, _, _ := procMonitorFromWnd.Call(hwnd, monitorNearest)
		mi := monitorInfo{CbSize: uint32(unsafe.Sizeof(monitorInfo{}))}
		procGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&mi)))
		procSetWindowLongPtr.Call(hwnd, gwlStyle, fsState.style&^wsOverlappedWindow)
		m := mi.RcMonitor
		procSetWindowPos.Call(hwnd, 0, uintptr(m.Left), uintptr(m.Top), uintptr(m.Right-m.Left), uintptr(m.Bottom-m.Top), swpNoOwnerZOrder|swpFrameChanged)
		fsState.on = true
	} else {
		procSetWindowLongPtr.Call(hwnd, gwlStyle, fsState.style)
		r := fsState.r
		procSetWindowPos.Call(hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), swpNoZOrder|swpNoOwnerZOrder|swpFrameChanged)
		if fsState.wasMax {
			procShowWindow.Call(hwnd, swMaximize)
		}
		fsState.on = false
	}
}

func messageBox(title, text string, flags uintptr) {
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(utf16(text))), uintptr(unsafe.Pointer(utf16(title))), flags)
}

func fatal(msg string) { messageBox("Terra Médiévale", msg, mbIconError) }

func openBrowser(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func browserFallback(url string) {
	openBrowser(url)
	messageBox("Terra Médiévale",
		"Le composant Microsoft Edge WebView2 n'est pas installé sur ce PC : le jeu s'ouvre dans ton navigateur.\n\n"+
			"Laisse cette fenêtre ouverte pendant que tu joues.\nClique sur OK pour quitter le jeu.\n\n"+
			"(Pour jouer dans sa propre fenêtre, installe « WebView2 Runtime » depuis le site de Microsoft.)", mbIconInformation)
}

// avant l'interface : instance unique + mise à jour en attente
func platformInit() bool {
	runtime.LockOSThread()
	if !acquireSingleInstance() {
		return false
	}
	if applyPendingAtStartup() {
		releaseSingleInstance()
		return false
	}
	go cleanupOldExecutable()
	loadNativeCfg()
	return true
}

func runUI(url string) {
	if v, err := webviewloader.GetInstalledVersion(); err == nil && v == "" {
		browserFallback(url)
		return
	}
	if hasArg("--updated") {
		time.Sleep(1200 * time.Millisecond) // laisse l'ancienne version libérer WebView2
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(dataDir(), "WebView2"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Terra Médiévale",
			Width:  1440,
			Height: 900,
			IconId: 2,
			Center: true,
		},
	})
	if w == nil {
		browserFallback(url)
		return
	}
	theView = w
	defer w.Destroy()
	mainHwnd = uintptr(w.Window())
	background := hasArg("--background")
	if background {
		procShowWindow.Call(mainHwnd, swHide)
	} else {
		procShowWindow.Call(mainHwnd, swMaximize)
	}
	createTray()
	defer trayRemove()
	oldWndProc, _, _ = procGetWindowLongPtr.Call(mainHwnd, gwlpWndProc)
	if oldWndProc != 0 {
		procSetWindowLongPtr.Call(mainHwnd, gwlpWndProc, windows.NewCallback(mainWndProc))
	}

	_ = w.Bind("toggleFullscreen", func() { w.Dispatch(func() { toggleFullscreen(mainHwnd) }) })
	_ = w.Bind("quitApp", func() { w.Dispatch(quitApp) })
	_ = w.Bind("hideToTray", func() { w.Dispatch(hideMain) })
	_ = w.Bind("trayNotify", func(title, text string) { trayNotify(title, text) })
	_ = w.Bind("setAutostart", func(on bool) bool {
		if peamDistrib() {
			return false
		}
		return setAutostart(on)
	})
	_ = w.Bind("setCloseToTray", func(on bool) { nativeCfg.CloseToTray = on; saveNativeCfg() })
	_ = w.Bind("appInfo", func() map[string]any {
		return map[string]any{"version": Version, "updateURL": effectiveUpdateURL(), "autostart": autostartEnabled(), "closeToTray": nativeCfg.CloseToTray && !peamDistrib(), "background": background, "peam": peamDistrib()}
	})
	onReady := func(info *updateInfo) {
		b, _ := json.Marshal(map[string]string{"version": info.Version, "notes": info.Notes})
		w.Dispatch(func() {
			w.Eval("window.onUpdateReady && window.onUpdateReady(" + string(b) + ")")
			if !windowVisible() {
				trayNotify("Mise à jour disponible", "La version "+info.Version+" de Terra Médiévale est prête. Ouvre le jeu pour l'installer.")
			}
		})
	}
	_ = w.Bind("checkUpdate", func() bool {
		go func() {
			var lastErr string
			ok, ver := checkAndDownload(onReady, func(e error) { lastErr = e.Error() })
			b, _ := json.Marshal(map[string]any{"error": lastErr, "available": ok, "version": ver})
			w.Dispatch(func() { w.Eval("window.onUpdateCheck && window.onUpdateCheck(" + string(b) + ")") })
		}()
		return true
	})
	_ = w.Bind("applyUpdate", func() string {
		upd.Lock()
		info := upd.ready
		upd.Unlock()
		if info == nil {
			return "aucune mise à jour prête"
		}
		exe, err := swapExecutable(info)
		if err != nil {
			return err.Error()
		}
		releaseSingleInstance()
		if err := relaunch(exe); err != nil {
			return err.Error()
		}
		w.Dispatch(func() { quitting = true; trayRemove(); procDestroyWindow.Call(mainHwnd) })
		return ""
	})
	// vérification automatique : 15 s après le lancement, puis toutes les 3 heures
	go func() {
		time.Sleep(15 * time.Second)
		for {
			if effectiveUpdateURL() != "" {
				checkAndDownload(onReady, nil)
			}
			time.Sleep(3 * time.Hour)
		}
	}()
	w.Navigate(url)
	w.Run()
	releaseSingleInstance()
}
