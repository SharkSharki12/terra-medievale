// Mise à jour automatique : vérifie un fichier latest.json, télécharge la nouvelle version,
// vérifie son empreinte SHA-256, puis remplace l'exécutable au redémarrage.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Version du jeu et adresse du fichier de mise à jour (modifiables à la compilation avec -ldflags -X)
var (
	Version   = "3.1.0"
	UpdateURL = ""
)

type updateInfo struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Notes   string `json:"notes"`
	Path    string `json:"path,omitempty"` // fichier téléchargé (local)
}

var upd struct {
	sync.Mutex
	busy  bool
	ready *updateInfo
}

func updateDir() string { d := filepath.Join(dataDir(), "update"); _ = os.MkdirAll(d, 0o755); return d }

// compare deux versions "1.2.3" : >0 si a > b
func compareVersions(a, b string) int {
	pa, pb := strings.Split(strings.TrimPrefix(a, "v"), "."), strings.Split(strings.TrimPrefix(b, "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x - y
		}
	}
	return 0
}

func effectiveUpdateURL() string {
	if UpdateURL != "" {
		return UpdateURL
	}
	// permet d'activer les mises à jour sans recompiler : %AppData%\TerraMedievale\update_url.txt
	if b, err := os.ReadFile(filepath.Join(dataDir(), "update_url.txt")); err == nil {
		return strings.TrimSpace(string(b))
	}
	return ""
}

var httpClient = &http.Client{Timeout: 10 * time.Minute}

func fetchUpdateInfo() (*updateInfo, error) {
	u := effectiveUpdateURL()
	if u == "" {
		return nil, errors.New("aucun serveur de mise à jour configuré")
	}
	c := &http.Client{Timeout: 25 * time.Second}
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("User-Agent", "TerraMedievale/"+Version)
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("serveur de mise à jour : erreur %d", resp.StatusCode)
	}
	var info updateInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&info); err != nil {
		return nil, err
	}
	if info.Version == "" || info.URL == "" || len(info.SHA256) != 64 {
		return nil, errors.New("fichier de mise à jour invalide")
	}
	return &info, nil
}

func fileSHA256(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func downloadUpdate(info *updateInfo) error {
	dst := filepath.Join(updateDir(), "TerraMedievale-"+info.Version+".exe")
	if sum, err := fileSHA256(dst); err == nil && strings.EqualFold(sum, info.SHA256) {
		info.Path = dst
		return nil
	}
	req, _ := http.NewRequest("GET", info.URL, nil)
	req.Header.Set("User-Agent", "TerraMedievale/"+Version)
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("téléchargement : erreur %d", resp.StatusCode)
	}
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, 400<<20))
	f.Close()
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if sum := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(sum, info.SHA256) {
		os.Remove(tmp)
		return errors.New("fichier téléchargé corrompu (empreinte incorrecte)")
	}
	_ = os.Remove(dst)
	if err := os.Rename(tmp, dst); err != nil {
		return err
	}
	info.Path = dst
	b, _ := json.Marshal(info)
	return os.WriteFile(filepath.Join(updateDir(), "pending.json"), b, 0o644)
}

// vérifie et télécharge ; onReady est appelé quand une nouvelle version est prête
func checkAndDownload(onReady func(*updateInfo), onErr func(error)) (bool, string) {
	upd.Lock()
	if upd.busy {
		upd.Unlock()
		return false, ""
	}
	if upd.ready != nil {
		r := upd.ready
		upd.Unlock()
		if onReady != nil {
			onReady(r)
		}
		return true, r.Version
	}
	upd.busy = true
	upd.Unlock()
	info, err := fetchUpdateInfo()
	if err != nil || compareVersions(info.Version, Version) <= 0 {
		upd.Lock()
		upd.busy = false
		upd.Unlock()
		if err != nil && onErr != nil {
			onErr(err)
		}
		return false, ""
	}
	go func() {
		err := downloadUpdate(info)
		upd.Lock()
		upd.busy = false
		if err == nil {
			upd.ready = info
		}
		upd.Unlock()
		if err != nil {
			if onErr != nil {
				onErr(err)
			}
			return
		}
		if onReady != nil {
			onReady(info)
		}
	}()
	return true, info.Version
}

func readPending() *updateInfo {
	b, err := os.ReadFile(filepath.Join(updateDir(), "pending.json"))
	if err != nil {
		return nil
	}
	var info updateInfo
	if json.Unmarshal(b, &info) != nil || info.Path == "" {
		return nil
	}
	if compareVersions(info.Version, Version) <= 0 {
		_ = os.Remove(filepath.Join(updateDir(), "pending.json"))
		_ = os.Remove(info.Path)
		return nil
	}
	if sum, err := fileSHA256(info.Path); err != nil || !strings.EqualFold(sum, info.SHA256) {
		return nil
	}
	return &info
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// remplace l'exécutable en cours par la nouvelle version (le fichier en cours d'exécution est renommé .old)
func swapExecutable(info *updateInfo) (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	return exe, swapExecutableAt(exe, info)
}

func swapExecutableAt(exe string, info *updateInfo) error {
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return fmt.Errorf("impossible de remplacer le jeu (%v) : déplace TerraMedievale.exe dans un dossier à toi, par exemple le Bureau", err)
	}
	if err := copyFile(info.Path, exe); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	_ = os.Remove(filepath.Join(updateDir(), "pending.json"))
	_ = os.Remove(info.Path)
	return nil
}

func relaunch(exe string, extra ...string) error {
	args := []string{"--updated"}
	for _, a := range os.Args[1:] {
		if a != "--updated" {
			args = append(args, a)
		}
	}
	args = append(args, extra...)
	cmd := exec.Command(exe, args...)
	return cmd.Start()
}

// au démarrage : applique une mise à jour déjà téléchargée ; renvoie true si le programme doit s'arrêter
func applyPendingAtStartup() bool {
	info := readPending()
	if info == nil {
		return false
	}
	exe, err := swapExecutable(info)
	if err != nil {
		return false
	}
	return relaunch(exe) == nil
}

// supprime l'ancienne version laissée par une mise à jour
func cleanupOldExecutable() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	old := exe + ".old"
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(old); err != nil {
			return
		}
		if os.Remove(old) == nil {
			return
		}
		time.Sleep(2 * time.Second)
	}
}

func hasArg(a string) bool {
	for _, x := range os.Args[1:] {
		if x == a {
			return true
		}
	}
	return false
}
