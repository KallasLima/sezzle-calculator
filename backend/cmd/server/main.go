package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/KallasLima/sezzle-calculator/backend/internal/httpapi"
)

func main() {
	config, err := loadConfig(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	server := newServer(config)
	log.Printf("Calculator API listening at http://%s", server.Addr)
	log.Fatal(server.ListenAndServe())
}

func newServer(config config) *http.Server {
	return &http.Server{
		Addr:              net.JoinHostPort(config.host, config.port),
		Handler:           httpapi.NewHandler(config.allowedOrigin),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}
