//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
)

// Version de développement (hors Windows) : ouvre le jeu dans le navigateur.
func fatal(msg string) { fmt.Fprintln(os.Stderr, msg) }

func openBrowser(url string) { _ = exec.Command("xdg-open", url).Start() }

func platformInit() bool { return true }

func runUI(url string) {
	fmt.Println("Terra Médiévale :", url)
	if os.Getenv("TERRA_NO_BROWSER") == "" {
		_ = exec.Command("xdg-open", url).Start()
	}
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	<-c
}
