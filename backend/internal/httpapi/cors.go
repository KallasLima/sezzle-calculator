package httpapi

import (
	"net/http"
	"strings"
)

func withCORS(next http.Handler, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedOrigin != "" {
			w.Header().Add("Vary", "Origin")
			if origin == allowedOrigin {
				w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			}
		}

		if r.URL.Path == "/api/calculate" && r.Method == http.MethodOptions &&
			origin != "" && r.Header.Get("Access-Control-Request-Method") != "" {
			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			if allowedOrigin == "" || origin != allowedOrigin {
				writeError(w, http.StatusForbidden, "INVALID_INPUT", "This origin is not allowed for browser requests.")
				return
			}
			if r.Header.Get("Access-Control-Request-Method") != http.MethodPost ||
				!allowsHeaders(r.Header.Get("Access-Control-Request-Headers")) {
				writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Browser requests must use POST with only the Content-Type request header.")
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", http.MethodPost)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// CORS controls browser access to responses, not permission to call the API.
		next.ServeHTTP(w, r)
	})
}

func allowsHeaders(headers string) bool {
	if headers == "" {
		return true
	}
	for _, header := range strings.Split(headers, ",") {
		if !strings.EqualFold(strings.TrimSpace(header), "Content-Type") {
			return false
		}
	}
	return true
}
