# Sezzle calculator

A local calculator built with React, TypeScript, and a Go HTTP service. The frontend edits numeric input; the backend performs all four arithmetic operations.

## Run locally

Prerequisites: Go 1.26 or newer, Node.js 24.15 or newer, and npm. Download runtimes from [go.dev](https://go.dev/dl/) and [nodejs.org](https://nodejs.org/). No database, API keys, or other services are required.

Start the backend in one terminal:

```sh
cd backend
go run ./cmd/server
```

Start the frontend in a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The Go service listens on `127.0.0.1:8080`. Vite forwards `/api` requests to Go so the browser uses one origin without CORS configuration. Both services stay on loopback.

## Verify

Backend (from `backend/`; `mkdir coverage` is needed only on the first run):

```sh
mkdir coverage
go test ./... '-covermode=atomic' '-coverprofile=coverage/coverage.out'
go tool cover '-func=coverage/coverage.out'
go tool cover '-html=coverage/coverage.out' -o coverage/coverage.html
go vet ./...
go build ./...
```

The quoted Go flags also work in PowerShell. Open `backend/coverage/coverage.html` for the annotated report; `coverage.out` is the machine-readable profile.

Frontend (from `frontend/`):

```sh
npm run test:coverage
npm run typecheck
npm run build
```

Open `frontend/coverage/index.html` for the HTML report. `coverage-summary.json` and `lcov.info` provide machine-readable results. Tests cover the API client and user interactions; the DOM bootstrap is excluded from frontend unit coverage. Generated reports, dependencies, and builds are ignored by Git.

Verified October 2, 2026, on Windows with Go 1.27.1 and Node 24.19.0:

| Check | Result |
| --- | --- |
| Go unit/handler tests | 76 cases passed; arithmetic and HTTP packages each have 100% statement coverage. |
| Go total coverage | 90%; the small server startup function is exercised by live integration rather than unit tests. |
| Frontend tests | 51 passed; 100% statements, lines, and functions; 98.68% branches. |
| Static/build checks | `go vet`, `go build`, TypeScript checking, and Vite production build passed. |
| Live API | 28 cases passed directly against Go and through the production preview proxy. |
| Browser integration | Real keypad and keyboard input, chaining, result continuation, errors/retry, duplicate prevention, clear/edit during delayed requests passed in Chromium. |
| Responsive UI | Desktop 1440 × 900, mobile 390 × 844, and narrow 320 × 568 checked against the reference. All keys fit on narrow screens without page overflow. |

Coverage is a dated verification snapshot, not a guarantee of every possible behavior. The commands above regenerate the reports for future changes.

For a local production-build check, stop the Vite dev server, leave Go running, and run `npm run preview` from `frontend/`. Preview uses the same loopback URL and API proxy. `dist/` alone is static frontend output and requires a same-origin `/api` route to the Go service; this project does not deploy or configure public hosting.

## API

`POST /api/calculate`, with `Content-Type: application/json`:

```json
{"operation":"add","a":2,"b":3}
```

```sh
curl -i http://127.0.0.1:8080/api/calculate \
  -H 'Content-Type: application/json' \
  -d '{"operation":"add","a":2,"b":3}'
```

PowerShell equivalent:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/calculate -Method Post `
  -ContentType application/json -Body '{"operation":"add","a":2,"b":3}'
```

Success is HTTP 200:

```json
{"result":5}
```

Operations are `add`, `subtract`, `multiply`, and `divide`. Operands must be finite JSON numbers; zero, negative values, and decimals are accepted. Missing operands are never defaulted to zero. Invalid requests return HTTP 400:

```json
{"error":{"code":"DIVISION_BY_ZERO","message":"cannot divide by zero"}}
```

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Missing/null or nonnumeric operands, unsupported operation, malformed JSON, or a number outside the finite input range. |
| `DIVISION_BY_ZERO` | The divisor is zero, including negative zero. |
| `RESULT_OUT_OF_RANGE` | Finite operands produce an infinite or NaN result. |

Unknown fields and trailing JSON values are rejected. Request bodies are limited to 1 MiB. Other HTTP methods return 405 with `Allow: POST`; unknown routes return 404.

## Calculator behavior

- The display starts at `0`; input remains text, preserving decimal entry and an explicitly entered second operand of zero.
- Operators execute immediately from left to right. `2 + 3 × 4 =` produces `20`. Selecting another operator before entering the second operand replaces the pending operator.
- Equals with no pending operation or no second operand does nothing. Repeated equals does nothing; it does not replay the last operation.
- A digit after a completed result starts a new calculation. An operator continues from the result.
- Decimal entry preserves a trailing decimal point and ignores repeated decimal presses. Sign toggling edits the current number; while waiting for a second operand it begins that operand at `-0`.
- Backspace edits an entry and returns an emptied entry to `0`. While waiting for a second operand it does nothing. After a completed result it starts a fresh entry at `0`.
- AC clears the entire calculation, including any pending request. A late response cannot restore cleared state.
- While calculating, operators and equals are disabled to prevent duplicate submissions. Editing a number cancels the pending response and keeps the edited operands available for a new calculation. Errors preserve operands so they can be corrected or retried.
- Long numbers scroll inside the display, keeping the latest digits visible without moving the keypad. Focus the display to scroll it with arrow keys.
- Keyboard input supports digits, `.`, `+`, `-`, `*`, `/`, Enter or `=`, Backspace, and Escape to clear. All keypad buttons are real focusable controls with accessible names.

## Design rationale

The structure follows the dependency principle without extra layers: pure Go arithmetic has no HTTP or UI dependencies; the HTTP handler validates and translates requests around that logic. The React UI delegates network communication to a separate API client and keeps entry/pending-operation state separate from arithmetic. There is no local fallback calculation, expression parser, database, authentication, persistence, or Docker setup.

```text
backend/
  cmd/server/           loopback HTTP server setup
  internal/calculator/ pure arithmetic and unit tests
  internal/httpapi/    JSON validation, responses, and handler tests
frontend/src/
  api.ts               typed HTTP client and response validation
  useCalculator.ts     numeric entry and pending-operation state
  Calculator.tsx       accessible display, keypad, and keyboard input
  styles.css           responsive reference-based appearance
```

The backend uses only the Go standard library. Vite handles local development/builds, and Vitest with Testing Library tests behavior through accessible controls. Request cancellation uses both an `AbortController` and a request-identity guard, because cancellation alone cannot prevent an already-completing response from overwriting a clear or edit. The rounded font ships with the frontend, avoiding a runtime font-service dependency.

Ordinary IEEE 754 binary floating-point arithmetic is used in both Go (`float64`) and JavaScript (`number`). Decimal fractions are not always exact: `0.1 + 0.2` returns `0.30000000000000004`; integers beyond `Number.MAX_SAFE_INTEGER` may lose precision. Results are not arbitrarily rounded. Overflow is rejected, while ordinary finite underflow and floating-point rounding follow the runtime's behavior. This is not a financial decimal calculator.

The [supplied reference](docs/design-reference.png) guides the lavender surfaces, purple display, rounded keypad, and typography. The application uses React controls and CSS, never the image as its interface. The complete heading is a single text element. The [prompt record](PROMPTS.md) preserves the implementation request and identifies privacy redactions.
