package main

import (
	"log"
	"net/http"
	"time"

	"github.com/KallasLima/sezzle-calculator/backend/internal/httpapi"
)

func main() {
	server := &http.Server{
		Addr:              "127.0.0.1:8080",
		Handler:           httpapi.NewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Calculator API listening at http://%s", server.Addr)
	log.Fatal(server.ListenAndServe())
}
