# Niilo22 Search Web Stack

This directory contains the web application stack for searching Niilo22 videos by transcript.

## Stack

- `frontend/`: Next.js search UI
- `backend/`: Fastify API + PostgreSQL search queries + import script
- `db/`: PostgreSQL migration SQL
- `docker-compose.dev.yml`: local development database only
- `docker-compose.yml`: production-style full stack

## Development workflow

1. Start PostgreSQL only:

```powershell
cd web
docker compose -f docker-compose.dev.yml up -d
```

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
docker compose up --build -d
```

This starts:

- PostgreSQL
- Fastify backend
- Next.js frontend

If you need to import data inside the backend container:

```powershell
docker compose exec backend node dist/scripts/import-data.js
```

## Search model

- Videos are stored in `videos`
- Transcript chunks are stored in `transcript_chunks`
- Search combines PostgreSQL full-text search and trigram similarity
- Results are grouped by video and returned with timestamped snippets

## Notes

- Some transcript files are legitimately empty for ambient-only videos.
- Re-running the importer is safe: it upserts videos and replaces chunks per video.
