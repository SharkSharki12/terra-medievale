// Terra Médiévale — lanceur : serveur local embarqué + fenêtre de jeu
package main

import (
	"embed"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed web
var webFS embed.FS

const appName = "TerraMedievale"

func dataDir() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		base, _ = os.UserHomeDir()
	}
	d := filepath.Join(base, appName)
	_ = os.MkdirAll(d, 0o755)
	return d
}

var kvName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Stockage clé/valeur JSON dans %AppData%\TerraMedievale (sauvegardes, réglages, mondes multijoueurs)
func handleKV(w http.ResponseWriter, r *http.Request, name string) {
	w.Header().Set("Cache-Control", "no-store")
	if !kvName.MatchString(name) {
		http.Error(w, "bad name", http.StatusBadRequest)
		return
	}
	p := filepath.Join(dataDir(), name+".json")
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(p)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("null"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	case http.MethodPost:
		b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil || len(b) < 2 || (b[0] != '{' && b[0] != '[') {
			http.Error(w, "bad data", http.StatusBadRequest)
			return
		}
		if old, err := os.ReadFile(p); err == nil {
			_ = os.WriteFile(p+".bak", old, 0o644)
		}
		tmp := p + ".tmp"
		if err := os.WriteFile(tmp, b, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp, p); err != nil {
			_ = os.Remove(p)
			_ = os.Rename(tmp, p)
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodDelete:
		_ = os.Remove(p)
		_ = os.Remove(p + ".bak")
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method", http.StatusMethodNotAllowed)
	}
}

// startServer démarre le serveur HTTP local et renvoie son URL
func startServer() (string, error) {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		return "", err
	}
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/save", func(w http.ResponseWriter, r *http.Request) { handleKV(w, r, "save") })
	mux.HandleFunc("/api/kv/", func(w http.ResponseWriter, r *http.Request) {
		handleKV(w, r, strings.TrimPrefix(r.URL.Path, "/api/kv/"))
	})
	mux.HandleFunc("/api/host", handleHost)
	mux.HandleFunc("/api/host/", handleHost)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		}
		files.ServeHTTP(w, r)
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	go func() { log.Println(http.Serve(ln, mux)) }()
	return "http://" + ln.Addr().String() + "/", nil
}

func main() {
	if !platformInit() {
		return
	}
	url, err := startServer()
	if err != nil {
		fatal("Impossible de démarrer le jeu : " + err.Error())
		return
	}
	runUI(url)
}
