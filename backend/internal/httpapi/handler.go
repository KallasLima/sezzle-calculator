// Package httpapi adapts JSON requests to the independent calculator package.
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/KallasLima/sezzle-calculator/backend/internal/calculator"
)

const maxBodyBytes = 1 << 20

type calculateRequest struct {
	Operation string   `json:"operation"`
	A         *float64 `json:"a"`
	B         *float64 `json:"b"`
}

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// NewHandler returns the service's HTTP routes. It does not start a server.
func NewHandler(allowedOrigin string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/calculate", calculate)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, struct {
			Status string `json:"status"`
		}{Status: "ok"})
	})
	return withCORS(mux, allowedOrigin)
}

func calculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "INVALID_INPUT", "Use POST for this endpoint.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request calculateRequest
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Body must be a JSON object with operation, a, and b; operands must be finite numbers.")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Body must contain exactly one JSON object.")
		return
	}
	if request.A == nil || request.B == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Both a and b are required and must be numbers, not null.")
		return
	}

	result, err := calculator.Calculate(request.Operation, *request.A, *request.B)
	if err != nil {
		code := "INVALID_INPUT"
		switch {
		case errors.Is(err, calculator.ErrDivisionByZero):
			code = "DIVISION_BY_ZERO"
		case errors.Is(err, calculator.ErrResultOutOfRange):
			code = "RESULT_OUT_OF_RANGE"
		}
		writeError(w, http.StatusBadRequest, code, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, struct {
		Result float64 `json:"result"`
	}{Result: result})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var response errorResponse
	response.Error.Code = code
	response.Error.Message = message
	writeJSON(w, status, response)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// Responses have a known JSON shape and finite numeric values. A write can
	// still fail (for example, on a deadline or connection error) after headers
	// are sent, so the handler cannot safely replace it with another response.
	_ = json.NewEncoder(w).Encode(value)
}
