package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
		want config
	}{
		{
			name: "local defaults",
			want: config{host: "127.0.0.1", port: "8080"},
		},
		{
			name: "hosting",
			env: map[string]string{
				"HOST":           "0.0.0.0",
				"PORT":           "10000",
				"ALLOWED_ORIGIN": "https://calculator.example.com",
			},
			want: config{
				host:          "0.0.0.0",
				port:          "10000",
				allowedOrigin: "https://calculator.example.com",
			},
		},
		{
			name: "local separate origin",
			env:  map[string]string{"ALLOWED_ORIGIN": "http://localhost:5173"},
			want: config{
				host:          "127.0.0.1",
				port:          "8080",
				allowedOrigin: "http://localhost:5173",
			},
		},
		{
			name: "IPv6",
			env: map[string]string{
				"HOST":           "::1",
				"PORT":           "65535",
				"ALLOWED_ORIGIN": "http://[::1]:5173",
			},
			want: config{
				host:          "::1",
				port:          "65535",
				allowedOrigin: "http://[::1]:5173",
			},
		},
		{
			name: "minimum port",
			env:  map[string]string{"PORT": "1"},
			want: config{host: "127.0.0.1", port: "1"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := loadConfig(func(key string) string { return test.env[key] })
			if err != nil || got != test.want {
				t.Fatalf("loadConfig = %+v, %v; want %+v", got, err, test.want)
			}
		})
	}
}

func TestInvalidPort(t *testing.T) {
	for _, port := range []string{"0", "-1", "65536", "1.5", "abc", " 8080", "8080 ", "1e4", "+8080"} {
		t.Run(port, func(t *testing.T) {
			_, err := loadConfig(func(key string) string {
				if key == "PORT" {
					return port
				}
				return ""
			})
			if err == nil || !strings.Contains(err.Error(), "PORT") {
				t.Fatalf("expected useful PORT error, got %v", err)
			}
		})
	}
}

func TestInvalidAllowedOrigin(t *testing.T) {
	for _, origin := range []string{
		"*", "https://*.example.com", "null", "calculator.example.com", "ftp://calculator.example.com", "https://",
		"https://calculator.example.com/", "https://calculator.example.com/path",
		"https://calculator.example.com?query", "https://calculator.example.com#fragment",
		"https://user:password@calculator.example.com", "https://calculator.example.com:invalid",
		"https://calculator.example.com https://other.example.com", "%invalid",
	} {
		t.Run(origin, func(t *testing.T) {
			_, err := loadConfig(func(key string) string {
				if key == "ALLOWED_ORIGIN" {
					return origin
				}
				return ""
			})
			if err == nil || !strings.Contains(err.Error(), "ALLOWED_ORIGIN") {
				t.Fatalf("expected useful ALLOWED_ORIGIN error, got %v", err)
			}
		})
	}
}

func TestServerConfiguration(t *testing.T) {
	server := newServer(config{host: "::1", port: "10000", allowedOrigin: "https://calculator.example.com"})
	if server.Addr != "[::1]:10000" {
		t.Errorf("address = %q", server.Addr)
	}
	if server.ReadHeaderTimeout != 5*time.Second || server.ReadTimeout != 10*time.Second ||
		server.WriteTimeout != 10*time.Second || server.IdleTimeout != 60*time.Second {
		t.Errorf("HTTP timeouts changed: %+v", server)
	}
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set("Origin", "https://calculator.example.com")
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != "https://calculator.example.com" {
		t.Errorf("configured handler: status %d, headers %v", response.Code, response.Header())
	}
}
