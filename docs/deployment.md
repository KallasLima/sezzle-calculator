# Render deployment

The calculator uses two services from the repository's `main` branch. Build commands and output paths are relative to each service's Root Directory.

| Setting | Go Web Service | React Static Site |
| --- | --- | --- |
| Plan/type | Free, native Go | Free Static Site |
| Root Directory | `backend` | `frontend` |
| Build Command | `go version && go build -o bin/server ./cmd/server` | `npm ci && npm run build` |
| Start / Publish | `./bin/server` | `dist` |
| Health Check Path | `/healthz` | Not applicable |
| Auto-deploy / PR previews | Off / Off | Off / Off |
| Runtime | Render's stable Go, satisfying `go.mod` | `.node-version` pins Node 24.19.0 |

## Environment

Backend:

```text
HOST=0.0.0.0
ALLOWED_ORIGIN=https://sezzle-calculator-ur1z.onrender.com
```

Render supplies `PORT`. Locally, `HOST` and `PORT` default to `127.0.0.1:8080`; valid ports are 1–65535. `ALLOWED_ORIGIN` must be the frontend origin with no path or trailing slash. CORS permits that origin, including POST preflight and error responses. Requests without an Origin header also work. CORS is not authentication.

Frontend:

```text
SKIP_INSTALL_DEPS=true
VITE_API_BASE_URL=https://sezzle-calculator-api-bf7n.onrender.com
```

`VITE_API_BASE_URL` is a public build-time value. The client removes trailing slashes and appends `/api/calculate`. When unset, it uses the relative `/api/calculate` route and Vite's local proxy. Rebuild after changing the value.

## Manual redeployment

1. Run `npm run verify`, then commit and push the change.
2. In the affected Render service, select **Manual Deploy → Deploy latest commit**.
3. Check the deployed commit and build-log runtime version. Preserve existing variables when updating configuration.
4. Verify `/healthz` and a calculation through the public frontend. If either origin changes, update the frontend API base and backend allowed origin, then redeploy both.

For a local production preview, build the frontend, run Go separately, and use `npm run preview` from `frontend/`. It serves at `http://127.0.0.1:5173` with the same API proxy.

## Free hosting

The API sleeps after 15 minutes of inactivity and can take about a minute to restart. Render's free instance-hour, build-minute, and bandwidth allowances apply. The UI shows slow-request feedback after 8 seconds and offers an explicit retry after its 90-second timeout.

References: [web services](https://render.com/docs/web-services), [static sites](https://render.com/docs/static-sites), [monorepos](https://render.com/docs/monorepo-support), and [free services](https://render.com/docs/free).
