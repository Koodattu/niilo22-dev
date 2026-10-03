# Niilo22 Search Web Stack

This directory contains the web application stack for searching Niilo22 videos by transcript.

## Stack

- `frontend/`: Next.js search UI
- `backend/`: Fastify API + PostgreSQL search queries + import script
- `db/`: ordered PostgreSQL migration SQL
- `docker-compose.dev.yml`: local development database only
- `docker-compose.yml`: production-style full stack

## Development workflow

1. Start PostgreSQL only:

```powershell
cd web
docker compose -f docker-compose.dev.yml up -d
```

PostgreSQL is published on host port `55422` by default. Override it with `POSTGRES_HOST_PORT` in `web/.env` if needed.
PostgreSQL binds to `127.0.0.1` by default in Docker-based workflows.

2. Install dependencies:

```powershell
cd frontend
npm ci
cd ..\backend
npm ci
```

3. Copy env files if needed:

- `frontend/.env.example` -> `frontend/.env.local`
- `backend/.env.example` -> `backend/.env`

Backend `dev` and `import:data` load `.env` when present (Node 24); explicit environment values take precedence. Check the database target before importing: the importer removes records absent from its input `videos.json`.

4. Import transcripts into PostgreSQL:

```powershell
cd backend
npm run import:data
```

5. Run backend locally:

```powershell
cd backend
npm run dev
```

6. Run frontend locally:

```powershell
cd frontend
npm run dev
```

Frontend will be on `http://localhost:3000` and backend on `http://localhost:4000`.
The frontend proxies `/api/search` to the backend using `BACKEND_URL`, so the browser stays on the frontend origin.

## Production-style Docker Compose

From `web/`:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

This starts:

- PostgreSQL
- Fastify backend
- Next.js frontend

The stack uses these host ports by default:

- frontend: `3222`
- backend: `4222`
- PostgreSQL: `55422`

These defaults are project-specific so they do not collide with the more typical `3000`, `4000`, and `5432` ports already used elsewhere on the host.

For nginx deployments on the same VM, the published Docker ports default to `127.0.0.1` only:

- `FRONTEND_BIND_IP=127.0.0.1`
- `BACKEND_BIND_IP=127.0.0.1`
- `POSTGRES_BIND_IP=127.0.0.1`

If you intentionally want direct remote access to one of those services, change the matching bind IP to `0.0.0.0`.

The backend applies the ordered SQL files in `db/migrations` on startup. The importer is an opt-in one-shot job and is not started by default on every `docker compose up`.

To run the import manually:

```powershell
docker compose --profile import up importer
```

The importer stores a content signature for each video in PostgreSQL. Re-running it reads the source files but only writes new or changed videos, replaces chunks only for those videos, and removes database rows for videos no longer present in `videos.json`. It also refreshes the stored analytics snapshot after changed data is imported, or repairs a missing snapshot without rewriting unchanged videos.

Search analytics keep per-query aggregate counts, result totals, and backend duration totals. They do not store user identities or a separate event row for every search.

To follow the initial import:

```powershell
docker compose logs -f importer
```

To re-run the import manually later:

```powershell
docker compose --profile import up importer
```

To connect to PostgreSQL from the VM host or another tool:

```text
Host: <vm-ip-or-hostname>
Port: 55422
Database: niilo22
User: niilo22
Password: niilo22
```

Replace those defaults in `web/.env` before starting the stack on the VM.

To stop the app without deleting data:

```powershell
docker compose down
```

To stop the app and wipe the PostgreSQL volume:

```powershell
docker compose down -v
```

## Search model

- Videos are stored in `videos`
- Transcript chunks are stored in `transcript_chunks`
- Search uses Finnish full-text search, preferring phrase matches for multi-word queries
- Results are grouped by video and returned with timestamped snippets

## Shared links and cache compatibility

New shared links include `t` (seconds), so the selected moment survives replacement of transcript chunk IDs. Existing `snippet` links still resolve when their chunk exists; deleted chunk IDs alone cannot recover the old timestamp. Queries require 2–200 characters including at least two letters or digits.

Migration `007_search_data_revision.sql` adds one revision row. Each changed-video or deletion transaction advances it, and API processes check it before using their bounded in-memory search cache. Changes committed before a later import failure become visible without sharing a filesystem. An invalid video's previous data stays intact.

Normal startup applies pending migrations. No existing rows are rewritten. Leave the additive table in place if rolling application code back; old processes still use their previous cache mechanism. `SEARCH_DATA_VERSION_PATH` is unused by the new code; existing deployment settings were not changed. Coordinate API/importer versions during rollout because an old importer does not update the new revision row.

## Regression checks

Follow [the verification workflow](../work/goal-improvement/VERIFICATION.md) for isolated PostgreSQL setup, synthetic fixtures, builds, browser tests, benchmarks and cleanup. Tests and seeding must use a dedicated disposable database. The [work log](../work/goal-improvement/STATE.md) and [coverage review](../work/goal-improvement/REVIEW.md) record verified scenarios and deferred findings.

## Notes

- Some transcript files are legitimately empty for ambient-only videos.
- Re-running the importer is safe: unchanged videos are skipped, while new or changed videos are upserted and have their chunks replaced.
