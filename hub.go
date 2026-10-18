// Serveur multijoueur « connexion directe » : un joueur héberge, les autres se connectent par IP.
// Simple relais WebSocket par salons : chaque client gère sa propre ville, le serveur relaie les messages.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type wsClient struct {
	id   string
	room string
	conn *websocket.Conn
	send chan []byte
}

type hub struct {
	mu    sync.Mutex
	rooms map[string]map[string]*wsClient
	ln    net.Listener
	port  int
	code  string
}

var theHub = &hub{rooms: map[string]map[string]*wsClient{}}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1 << 16,
	WriteBufferSize: 1 << 16,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func localIPs() []string {
	out := []string{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok {
				if ip4 := ipn.IP.To4(); ip4 != nil && !ip4.IsLinkLocalUnicast() {
					out = append(out, ip4.String())
				}
			}
		}
	}
	return out
}

func (h *hub) running() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.ln != nil }

func (h *hub) start(port int, code string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if code != "" {
		h.code = code
	}
	if h.ln != nil {
		return nil
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		return err
	}
	h.ln = ln
	h.port = port
	mux := http.NewServeMux()
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = w.Write([]byte("terra-medievale"))
	})
	mux.HandleFunc("/ws", h.serveWS)
	go func() { log.Println("hub:", http.Serve(ln, mux)) }()
	return nil
}

func (h *hub) stop() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.ln != nil {
		_ = h.ln.Close()
		h.ln = nil
	}
	for _, room := range h.rooms {
		for _, c := range room {
			_ = c.conn.Close()
		}
	}
}

func (h *hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, r := range h.rooms {
		n += len(r)
	}
	return n
}

func (h *hub) broadcast(room, except string, msg []byte) {
	for id, c := range h.rooms[room] {
		if id == except {
			continue
		}
		select {
		case c.send <- msg:
		default: // client trop lent : on saute ce message
		}
	}
}

func (h *hub) serveWS(w http.ResponseWriter, r *http.Request) {
	room := "main" // un seul salon par hôte
	id := r.URL.Query().Get("id")
	if room == "" || id == "" || len(room) > 64 || len(id) > 64 {
		http.Error(w, "room/id", http.StatusBadRequest)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(16 << 20)
	c := &wsClient{id: id, room: room, conn: conn, send: make(chan []byte, 512)}

	h.mu.Lock()
	if h.rooms[room] == nil {
		h.rooms[room] = map[string]*wsClient{}
	}
	for h.rooms[room][c.id] != nil {
		c.id = c.id + "_"
	}
	peers := []string{}
	for pid := range h.rooms[room] {
		peers = append(peers, pid)
	}
	h.rooms[room][c.id] = c
	welcome, _ := json.Marshal(map[string]any{"t": "_welcome", "d": map[string]any{"id": c.id, "peers": peers, "room": h.code}})
	c.send <- welcome
	join, _ := json.Marshal(map[string]any{"t": "_join", "from": c.id})
	h.broadcast(room, c.id, join)
	h.mu.Unlock()

	go c.writer()
	c.reader(h)

	h.mu.Lock()
	delete(h.rooms[room], c.id)
	if len(h.rooms[room]) == 0 {
		delete(h.rooms, room)
	}
	leave, _ := json.Marshal(map[string]any{"t": "_leave", "from": c.id})
	h.broadcast(room, c.id, leave)
	h.mu.Unlock()
	close(c.send)
}

func (c *wsClient) reader(h *hub) {
	defer c.conn.Close()
	_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.conn.SetPongHandler(func(string) error { return c.conn.SetReadDeadline(time.Now().Add(90 * time.Second)) })
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		var env map[string]json.RawMessage
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		from, _ := json.Marshal(c.id)
		env["from"] = from
		var to string
		if raw, ok := env["to"]; ok {
			_ = json.Unmarshal(raw, &to)
			delete(env, "to")
		}
		out, err := json.Marshal(env)
		if err != nil {
			continue
		}
		h.mu.Lock()
		if to != "" {
			if dst := h.rooms[c.room][to]; dst != nil {
				select {
				case dst.send <- out:
				default:
				}
			}
		} else {
			h.broadcast(c.room, c.id, out)
		}
		h.mu.Unlock()
	}
}

func (c *wsClient) writer() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(20 * time.Second))
			if c.conn.WriteMessage(websocket.TextMessage, msg) != nil {
				_ = c.conn.Close()
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if c.conn.WriteMessage(websocket.PingMessage, nil) != nil {
				_ = c.conn.Close()
				return
			}
		}
	}
}

// API locale (appelée par l'interface du jeu)
func handleHost(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	switch r.URL.Path {
	case "/api/host/start":
		port, _ := strconv.Atoi(r.URL.Query().Get("port"))
		if port <= 0 || port > 65535 {
			port = 7777
		}
		code := r.URL.Query().Get("code")
		if len(code) > 40 {
			code = code[:40]
		}
		if err := theHub.start(port, code); err != nil {
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
	case "/api/host/stop":
		theHub.stop()
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"running": theHub.running(), "port": theHub.port, "ips": localIPs(), "players": theHub.count(), "code": theHub.code,
	})
}
