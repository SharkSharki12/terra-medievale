package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{{"1.2.0", "1.1.9", 1}, {"1.10.0", "1.9.9", 1}, {"2.0", "2.0.0", 0}, {"v3.0.1", "3.0.0", 1}, {"1.0.0", "1.0.1", -1}}
	for _, c := range cases {
		got := compareVersions(c.a, c.b)
		if (got > 0) != (c.want > 0) || (got < 0) != (c.want < 0) {
			t.Errorf("%s vs %s = %d", c.a, c.b, got)
		}
	}
}

func TestUpdateFlow(t *testing.T) {
	dir := t.TempDir()
	os.Setenv("XDG_CONFIG_HOME", dir)
	payload := []byte("NOUVELLE VERSION DU JEU")
	sum := sha256.Sum256(payload)
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc("/latest.json", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"version":"9.9.9","url":"%s/game.exe","sha256":"%s","notes":"test"}`, srv.URL, hex.EncodeToString(sum[:]))
	})
	mux.HandleFunc("/game.exe", func(w http.ResponseWriter, r *http.Request) { w.Write(payload) })
	srv = httptest.NewServer(mux)
	defer srv.Close()
	UpdateURL = srv.URL + "/latest.json"
	Version = "3.0.0"
	done := make(chan *updateInfo, 1)
	ok, ver := checkAndDownload(func(i *updateInfo) { done <- i }, func(e error) { t.Error(e) })
	if !ok || ver != "9.9.9" {
		t.Fatalf("check: %v %s", ok, ver)
	}
	var info *updateInfo
	select {
	case info = <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("timeout")
	}
	if p := readPending(); p == nil || p.Version != "9.9.9" {
		t.Fatalf("pending: %+v", p)
	}
	exe := filepath.Join(dir, "TerraMedievale.exe")
	os.WriteFile(exe, []byte("ANCIENNE"), 0o755)
	if err := swapExecutableAt(exe, info); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(exe)
	if string(b) != string(payload) {
		t.Fatalf("exe = %q", b)
	}
	if b, _ := os.ReadFile(exe + ".old"); string(b) != "ANCIENNE" {
		t.Fatalf("old = %q", b)
	}
	if readPending() != nil {
		t.Fatal("pending should be cleared")
	}
	upd.ready = nil
	bad := &updateInfo{Version: "9.9.10", URL: srv.URL + "/game.exe", SHA256: "00" + hex.EncodeToString(sum[:])[2:]}
	if err := downloadUpdate(bad); err == nil {
		t.Fatal("corrupted download accepted")
	}
}
