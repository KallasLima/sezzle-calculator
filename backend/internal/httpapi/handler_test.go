package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KallasLima/sezzle-calculator/backend/internal/httpapi"
)

func TestCalculateSuccess(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"addition", `{"operation":"add","a":2,"b":3}`, `{"result":5}`},
		{"subtraction", `{"operation":"subtract","a":2,"b":3}`, `{"result":-1}`},
		{"multiplication", `{"operation":"multiply","a":12,"b":2}`, `{"result":24}`},
		{"division", `{"operation":"divide","a":7,"b":2}`, `{"result":3.5}`},
		{"zero operands", `{"operation":"add","a":0,"b":0}`, `{"result":0}`},
		{"negative operands", `{"operation":"multiply","a":-3,"b":-2}`, `{"result":6}`},
		{"decimal operands", `{"operation":"add","a":0.25,"b":0.5}`, `{"result":0.75}`},
		{"scientific notation", `{"operation":"divide","a":2e3,"b":1e2}`, `{"result":20}`},
		{"floating point precision", `{"operation":"add","a":0.1,"b":0.2}`, `{"result":0.30000000000000004}`},
		{"trailing whitespace", "{\"operation\":\"add\",\"a\":2,\"b\":3}\n\t ", `{"result":5}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := post(test.body)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			if got := response.Header().Get("Content-Type"); got != "application/json" {
				t.Errorf("Content-Type = %q", got)
			}
			if got := strings.TrimSpace(response.Body.String()); got != test.want {
				t.Errorf("body = %s, want %s", got, test.want)
			}
		})
	}
}

func TestCalculateInvalidRequests(t *testing.T) {
	tests := []struct {
		name string
		body string
		code string
	}{
		{"empty body", ``, "INVALID_INPUT"},
		{"malformed body", `{"operation":"add","a":2,"b":`, "INVALID_INPUT"},
		{"empty object", `{}`, "INVALID_INPUT"},
		{"missing first operand", `{"operation":"add","b":3}`, "INVALID_INPUT"},
		{"missing second operand", `{"operation":"add","a":2}`, "INVALID_INPUT"},
		{"null first operand", `{"operation":"add","a":null,"b":3}`, "INVALID_INPUT"},
		{"null second operand", `{"operation":"add","a":2,"b":null}`, "INVALID_INPUT"},
		{"string operand", `{"operation":"add","a":"2","b":3}`, "INVALID_INPUT"},
		{"boolean operand", `{"operation":"add","a":2,"b":true}`, "INVALID_INPUT"},
		{"array operand", `{"operation":"add","a":[],"b":3}`, "INVALID_INPUT"},
		{"object operand", `{"operation":"add","a":2,"b":{}}`, "INVALID_INPUT"},
		{"missing operation", `{"a":2,"b":3}`, "INVALID_INPUT"},
		{"null operation", `{"operation":null,"a":2,"b":3}`, "INVALID_INPUT"},
		{"nonstring operation", `{"operation":2,"a":2,"b":3}`, "INVALID_INPUT"},
		{"unsupported operation", `{"operation":"power","a":2,"b":3}`, "INVALID_INPUT"},
		{"uppercase operation", `{"operation":"ADD","a":2,"b":3}`, "INVALID_INPUT"},
		{"null body", `null`, "INVALID_INPUT"},
		{"array body", `[]`, "INVALID_INPUT"},
		{"string body", `"text"`, "INVALID_INPUT"},
		{"unknown field", `{"operation":"add","a":2,"b":3,"extra":true}`, "INVALID_INPUT"},
		{"multiple objects", `{"operation":"add","a":2,"b":3} {}`, "INVALID_INPUT"},
		{"trailing null", `{"operation":"add","a":2,"b":3} null`, "INVALID_INPUT"},
		{"trailing garbage", `{"operation":"add","a":2,"b":3} garbage`, "INVALID_INPUT"},
		{"number beyond float64", `{"operation":"add","a":1e400,"b":3}`, "INVALID_INPUT"},
		{"NaN is not JSON", `{"operation":"add","a":NaN,"b":3}`, "INVALID_INPUT"},
		{"Infinity is not JSON", `{"operation":"add","a":2,"b":Infinity}`, "INVALID_INPUT"},
		{"division by zero", `{"operation":"divide","a":2,"b":0}`, "DIVISION_BY_ZERO"},
		{"division by negative zero", `{"operation":"divide","a":2,"b":-0}`, "DIVISION_BY_ZERO"},
		{"zero divided by zero", `{"operation":"divide","a":0,"b":0}`, "DIVISION_BY_ZERO"},
		{"addition overflow", `{"operation":"add","a":1.7976931348623157e308,"b":1.7976931348623157e308}`, "RESULT_OUT_OF_RANGE"},
		{"subtraction overflow", `{"operation":"subtract","a":-1.7976931348623157e308,"b":1.7976931348623157e308}`, "RESULT_OUT_OF_RANGE"},
		{"multiplication overflow", `{"operation":"multiply","a":1e308,"b":2}`, "RESULT_OUT_OF_RANGE"},
		{"division overflow", `{"operation":"divide","a":1e308,"b":0.1}`, "RESULT_OUT_OF_RANGE"},
		{"oversized body", strings.Repeat(" ", 1<<20) + `{"operation":"add","a":2,"b":3}`, "INVALID_INPUT"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := post(test.body)
			assertError(t, response, http.StatusBadRequest, test.code)
		})
	}
}

func TestMethodNotAllowed(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			request := httptest.NewRequest(method, "/api/calculate", nil)
			response := httptest.NewRecorder()
			httpapi.NewHandler("").ServeHTTP(response, request)
			assertError(t, response, http.StatusMethodNotAllowed, "INVALID_INPUT")
			if got := response.Header().Get("Allow"); got != http.MethodPost {
				t.Errorf("Allow = %q, want POST", got)
			}
		})
	}
}

func TestUnknownRoute(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/unknown", nil)
	response := httptest.NewRecorder()
	httpapi.NewHandler("").ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", response.Code)
	}
}

func post(body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/calculate", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	httpapi.NewHandler("").ServeHTTP(response, request)
	return response
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decoder := json.NewDecoder(response.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		t.Fatalf("invalid error envelope: %v", err)
	}
	if body.Error.Code != code {
		t.Errorf("error code = %q, want %q", body.Error.Code, code)
	}
	if body.Error.Message == "" {
		t.Error("error message must explain the problem")
	}
}
