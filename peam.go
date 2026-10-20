// Intégration PEAM (plateforme de jeux Windows) : licence, succès, statistiques, présence, overlay,
// invitations d'amis. Le jeu (page web) passe par ce lanceur, qui relaie les requêtes au serveur local de PEAM
// (protocole HTTP de la documentation PEAM, section 9.2). Sans PEAM, tout renvoie « échec » sans bloquer le jeu.
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Distrib vaut "peam" pour la version publiée sur PEAM (licence obligatoire, mises à jour gérées par PEAM)
var Distrib = ""

const peamDefaultID = "terra-medievale"

func peamDistrib() bool { return Distrib == "peam" }

// lancé par PEAM : le serveur local et le secret de la partie sont fournis
func peamLaunched() bool {
	return os.Getenv("PEAM_SDK_ENDPOINT") != "" && os.Getenv("PEAM_SDK_SECRET") != ""
}

var peamIDRe = regexp.MustCompile(`^[a-z0-9_-]{2,41}$`)

// identifiant du jeu : PEAM_GAME_ID, sinon peam.json à côté de l'exe, sinon la valeur par défaut
func peamGameID() string {
	if id := os.Getenv("PEAM_GAME_ID"); peamIDRe.MatchString(id) {
		return id
	}
	if exe, err := os.Executable(); err == nil {
		if b, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "peam.json")); err == nil {
			var m struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(b, &m) == nil && peamIDRe.MatchString(m.ID) {
				return m.ID
			}
		}
	}
	return peamDefaultID
}

// Licence (version PEAM) : sans PEAM_USER_ID et PEAM_LICENSE_TOKEN, le jeu se fait relancer par PEAM et se ferme.
func peamLicenseOK() bool {
	if !peamDistrib() {
		return true
	}
	if os.Getenv("PEAM_USER_ID") != "" && os.Getenv("PEAM_LICENSE_TOKEN") != "" {
		return true
	}
	openBrowser("peam://run/" + peamGameID())
	return false
}

// routes autorisées vers PEAM (jamais de remise à zéro des succès dans le jeu publié)
var peamRoutes = map[string]bool{
	"presence": true, "stats": true, "achievements/unlock": true, "achievements/progress": true, "achievements/list": true,
	"overlay/open": true, "party": true, "invite/open": true, "invite/poll": true, "event": true,
}

var peamClient = &http.Client{Timeout: 10 * time.Second}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

// GET /api/peam/info : état de PEAM pour le jeu
func handlePeamInfo(w http.ResponseWriter, r *http.Request) {
	var join any
	if s := os.Getenv("PEAM_JOIN_SECRET"); s != "" {
		join = map[string]string{"secret": s, "fromName": os.Getenv("PEAM_JOIN_FROM"), "fromUid": os.Getenv("PEAM_JOIN_FROM_UID")}
	}
	writeJSON(w, map[string]any{
		"active": peamLaunched(), "distrib": Distrib, "gameId": peamGameID(),
		"userName": os.Getenv("PEAM_USER_NAME"), "userId": os.Getenv("PEAM_USER_ID"), "lang": os.Getenv("PEAM_LANG"), "join": join,
	})
}

// POST /api/peam/call/<route> : relaie la requête au serveur local de PEAM
func handlePeamCall(w http.ResponseWriter, r *http.Request) {
	route := strings.TrimPrefix(r.URL.Path, "/api/peam/call/")
	if r.Method != http.MethodPost || !peamRoutes[route] {
		writeJSON(w, map[string]any{"ok": false, "error": "not_found"})
		return
	}
	if !peamLaunched() {
		writeJSON(w, map[string]any{"ok": false, "error": "not_launched"})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(os.Getenv("PEAM_SDK_ENDPOINT"), "/")+"/"+route, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-peam-secret", os.Getenv("PEAM_SDK_SECRET"))
	resp, err := peamClient.Do(req)
	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": "peam_unavailable"})
		return
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if len(out) == 0 || (out[0] != '{' && out[0] != '[') {
		writeJSON(w, map[string]any{"ok": false, "error": "bad_response", "status": resp.StatusCode})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(out)
}
