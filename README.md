# Health Tracker

Personal dashboard that pulls every available data type (heart rate, steps,
sleep, weight, etc.) from a Fitbit-linked Google account via the Google
Health API, stores it forever in Postgres, and charts it.

Deployed at `health.hamidullah.net` via Dokploy, same pattern as
`football-draft-game`.

## How it works

- **Auth**: `GET /api/auth/connect` redirects to Google's OAuth consent
  screen requesting read-only scopes for activity/fitness, health metrics,
  sleep, nutrition, ECG, and irregular rhythm data. Google redirects back to
  `GET /api/oauth2callback`, which exchanges the code for tokens and stores
  them (single-user app — one row in `GoogleAccount`).
- **Sync**: `POST /api/sync` (or `npm run sync` from a cron job) loops over
  every data type in `src/lib/googleHealth.ts`, fetches new `dataPoints`
  since the last sync in ≤14-day windows (Google's per-request cap), and
  upserts them into the generic `DataPoint` table. The raw API payload is
  always kept in `raw` so nothing is lost even for shapes we don't model,
  alongside a best-effort `value`/`unit` extraction for quick charting.
- **Dashboard**: `/` shows a connect button (if not yet connected), a 24h
  heart rate line chart, and a count of synced points per data type.

## Google Cloud setup

The legacy Fitbit Web API is deprecated (Sept 2026) in favor of the Google
Health API. To get credentials:

1. Go to https://developers.google.com/health/setup and click "Enable the
   API and get an OAuth 2.0 Client ID".
2. Create/select a Google Cloud project.
3. When configuring the OAuth client, choose **Web server**.
4. Add an Authorized redirect URI matching `NEXT_PUBLIC_BASE_URL` exactly:
   - Local dev: `http://localhost:3000/api/oauth2callback`
   - Production: `https://health.hamidullah.net/api/oauth2callback`
5. Copy the Client ID and Client Secret into `.env` (see `.env.example`).
6. On the OAuth consent screen's **Audience** page, add yourself as a test
   user while the app is in "Testing" status (refresh tokens expire after 7
   days in Testing; move to "In Production" for tokens that don't expire).
7. On the **Data access** page, add the Google Health API scopes for the
   categories you want (activity_and_fitness, health_metrics_and_measurements,
   sleep, nutrition — ecg/irn are optional, sensitive-data categories).

## Local development

The `db` service in `docker-compose.yml` isn't exposed to the host (same as
`football-draft-game`), so pick one of:

**Whole stack in Docker** (simplest — matches production):
```bash
docker compose up --build
```
Visit `http://localhost:3000`.

**App on host, Postgres in Docker** (faster iteration): add a temporary
`ports: ["5433:5432"]` under the `db` service, then:
```bash
npm install
docker compose up db -d
DATABASE_URL="postgresql://postgres:password@localhost:5433/health_tracker" npx prisma db push
npm run dev
```

Either way, click "Connect Google account", then "Sync now".

## Deploying (Dokploy)

Same as `football-draft-game`: push this repo, point Dokploy at it, set env
vars (`DATABASE_URL`, `NEXT_PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`) in the Dokploy dashboard, and let it build the
`Dockerfile`. `start.sh` runs `prisma db push` on every boot before starting
the server.

## Notes / caveats

- "Live" heart rate is bounded by how often your Fitbit Air actually syncs
  to Google's cloud — this is not a sub-second live feed, just however fresh
  the last sync was. A true live view would need to poll `/api/sync` +
  `/api/heart-rate` on an interval and accept that latency.
- `heart-rate` queries are capped at 14 days per request server-side; other
  data types use the same conservative window until proven otherwise.
- This is a single-user app: connecting a new Google account replaces the
  stored tokens rather than supporting multiple accounts.
