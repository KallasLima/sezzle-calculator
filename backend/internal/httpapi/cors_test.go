package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KallasLima/sezzle-calculator/backend/internal/httpapi"
)

const frontendOrigin = "https://calculator.example.com"

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()
	httpapi.NewHandler(frontendOrigin).ServeHTTP(response, request)
	if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("health response: %d, %s", response.Code, response.Body)
	}
	if response.Header().Get("Content-Type") != "application/json" {
		t.Errorf("Content-Type = %q", response.Header().Get("Content-Type"))
	}
	request = httptest.NewRequest(http.MethodPost, "/healthz", nil)
	response = httptest.NewRecorder()
	httpapi.NewHandler(frontendOrigin).ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST health status = %d", response.Code)
	}
}

func TestCORSResponses(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		body   string
		status int
		allow  string
	}{
		{"allowed", frontendOrigin, `{"operation":"add","a":2,"b":3}`, 200, frontendOrigin},
		{"allowed validation error", frontendOrigin, `{}`, 400, frontendOrigin},
		{"allowed division error", frontendOrigin, `{"operation":"divide","a":2,"b":0}`, 400, frontendOrigin},
		{"allowed range error", frontendOrigin, `{"operation":"multiply","a":1e308,"b":2}`, 400, frontendOrigin},
		{"disallowed still callable", "https://other.example.com", `{"operation":"add","a":2,"b":3}`, 200, ""},
		{"origin suffix must not match", frontendOrigin + ".other.example.com", `{"operation":"add","a":2,"b":3}`, 200, ""},
		{"null origin", "null", `{"operation":"add","a":2,"b":3}`, 200, ""},
		{"no origin", "", `{"operation":"add","a":2,"b":3}`, 200, ""},
		{"no origin validation error", "", `{}`, 400, ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/calculate", strings.NewReader(test.body))
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			httpapi.NewHandler(frontendOrigin).ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			assertCORS(t, response, test.allow)
			assertVary(t, response, "Origin")
		})
	}
}

func TestCORSRouteErrors(t *testing.T) {
	for _, test := range []struct {
		path   string
		status int
	}{{"/api/calculate", 405}, {"/unknown", 404}} {
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		request.Header.Set("Origin", frontendOrigin)
		response := httptest.NewRecorder()
		httpapi.NewHandler(frontendOrigin).ServeHTTP(response, request)
		if response.Code != test.status {
			t.Errorf("%s status = %d", test.path, response.Code)
		}
		assertCORS(t, response, frontendOrigin)
		assertVary(t, response, "Origin")
	}
}

func TestCORSPreflight(t *testing.T) {
	tests := []struct {
		name    string
		allowed string
		origin  string
		method  string
		headers string
		status  int
		allow   string
	}{
		{"allowed", frontendOrigin, frontendOrigin, "POST", "Content-Type", 204, frontendOrigin},
		{"header case and whitespace", frontendOrigin, frontendOrigin, "POST", " content-type ", 204, frontendOrigin},
		{"no extra headers", frontendOrigin, frontendOrigin, "POST", "", 204, frontendOrigin},
		{"disallowed origin", frontendOrigin, "https://other.example.com", "POST", "Content-Type", 403, ""},
		{"not configured", "", frontendOrigin, "POST", "Content-Type", 403, ""},
		{"unsupported method", frontendOrigin, frontendOrigin, "DELETE", "Content-Type", 400, frontendOrigin},
		{"unsupported header", frontendOrigin, frontendOrigin, "POST", "Content-Type, Authorization", 400, frontendOrigin},
		{"missing request method", frontendOrigin, frontendOrigin, "", "Content-Type", 405, frontendOrigin},
		{"no origin OPTIONS", frontendOrigin, "", "POST", "Content-Type", 405, ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodOptions, "/api/calculate", nil)
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Access-Control-Request-Method", test.method)
			request.Header.Set("Access-Control-Request-Headers", test.headers)
			response := httptest.NewRecorder()
			httpapi.NewHandler(test.allowed).ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			assertCORS(t, response, test.allow)
			if test.allowed != "" {
				assertVary(t, response, "Origin")
			}
			if test.status == http.StatusNoContent {
				assertVary(t, response, "Access-Control-Request-Method")
				assertVary(t, response, "Access-Control-Request-Headers")
				if response.Header().Get("Access-Control-Allow-Methods") != "POST" || response.Header().Get("Access-Control-Allow-Headers") != "Content-Type" {
					t.Errorf("preflight headers = %v", response.Header())
				}
				if response.Body.Len() != 0 {
					t.Errorf("preflight body = %s", response.Body)
				}
			} else {
				assertError(t, response, test.status, "INVALID_INPUT")
			}
		})
	}
}

func TestCORSDisabledLocally(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/calculate", strings.NewReader(`{"operation":"add","a":2,"b":3}`))
	request.Header.Set("Origin", frontendOrigin)
	response := httptest.NewRecorder()
	httpapi.NewHandler("").ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Errorf("status = %d", response.Code)
	}
	assertCORS(t, response, "")
}

func assertCORS(t *testing.T, response *httptest.ResponseRecorder, origin string) {
	t.Helper()
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, origin)
	}
	if got := response.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("unexpected credential support: %q", got)
	}
}

func assertVary(t *testing.T, response *httptest.ResponseRecorder, name string) {
	t.Helper()
	for _, value := range response.Header().Values("Vary") {
		for _, field := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(field), name) {
				return
			}
		}
	}
	t.Errorf("Vary %s missing in %v", name, response.Header())
}
