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
npm install
cd ..\backend
npm install
```

3. Copy env files if needed:

- `frontend/.env.example` -> `frontend/.env.local`
- `backend/.env.example` -> `backend/.env`

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
- importer job for `videos.json` and `output/*.json`
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

The importer stores a source signature in PostgreSQL and skips the expensive full import when the current `videos.json` plus transcript file metadata match the last successful import.

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
- Search combines PostgreSQL full-text search and trigram similarity
- Results are grouped by video and returned with timestamped snippets

## Notes

- Some transcript files are legitimately empty for ambient-only videos.
- Re-running the importer is safe: it upserts videos and replaces chunks per video.
