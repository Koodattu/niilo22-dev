# niilo22-dev

![Niilo22.dev search interface](niilo22_dev.PNG)

`niilo22-dev` is a data pipeline and web application for building a searchable archive of Niilo22 YouTube videos. It downloads video metadata and media, transcribes Finnish speech into timestamped JSON, imports that data into PostgreSQL, and serves a browser search interface for finding exact moments in videos.

## What This Repo Does

The project turns Niilo22 videos into timestamped, searchable transcript data:

1. Fetches YouTube video metadata into `videos.json`.
2. Downloads audio or video files into `videos/` with `yt-dlp`.
3. Transcribes Finnish audio with `faster-whisper`.
4. Writes word-level timestamp JSON files into `output/`.
5. Supports local fuzzy word search over transcript JSON files.
6. Imports videos and transcript chunks into PostgreSQL.
7. Serves a Next.js search UI backed by a Fastify API.
8. Includes experimental scripts for transcript corpus creation and language-model fine-tuning.

## Repository Layout

```text
.
|-- README.md
|-- example.env              # Root pipeline environment template
|-- requirements.txt         # Python pipeline dependencies
|-- download.py              # Fetch YouTube metadata and download MP3/MP4 files
|-- transcribe.py            # Batch transcribe downloaded MP3 files
|-- search.py                # Local fuzzy search over transcript JSON files
|-- concat.py                # Combine transcript words into a text corpus
|-- finetune.py              # Experimental Unsloth fine-tuning script
|-- measure.py               # Whisper memory/performance measurement helper
|-- videos.json              # Video metadata and download state
|-- videos/                  # Downloaded media files
|-- output/                  # Generated transcript JSON files
`-- web/
    |-- docker-compose.dev.yml
    |-- docker-compose.yml
    |-- .env.example
    |-- db/migrations/       # Ordered PostgreSQL migrations
    |-- backend/             # Fastify API, importer, search, analytics
    `-- frontend/            # Next.js search UI
```

## Requirements

For the root data pipeline:

- Python environment with the packages in `requirements.txt`
- YouTube Data API key for metadata fetching
- `yt-dlp` available in the repo root or on `PATH`
- CUDA-capable setup for the default transcription workflow

For the web application:

- Node.js and npm for local frontend/backend development
- Docker Compose for the PostgreSQL development database or full production-style stack
- Existing `videos.json` and `output/*.json` data when importing transcripts

## Root Pipeline Setup

Create the root `.env` file:

```powershell
Copy-Item example.env .env
```

Root environment values:

```text
YT_API_KEY=
YT_CHANNEL=niilo22
DOWNLOAD_FOLDER=videos
```

Install Python dependencies in your preferred environment:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

The transcription dependency set is GPU-oriented. The default `transcribe.py` configuration uses `device="cuda"` and `compute_type="float16"`.

## Download Videos

Fetch new YouTube metadata and download media:

```powershell
python download.py mp3
```

Use `mp4` instead of `mp3` if you want video files:

```powershell
python download.py mp4
```

`download.py` stores metadata in `videos.json`, downloads files into `videos/`, skips already downloaded files, and marks successful downloads in `videos.json`.

The generated media filenames include:

```text
unix_timestamp_upload_date_youtube_id_video_title.ext
```

If `cookies.txt` exists in the repo root, `download.py` passes it to `yt-dlp` automatically.

## Transcribe Audio

Transcribe downloaded MP3 files:

```powershell
python transcribe.py
```

By default, this reads MP3 files from `videos/`, writes transcript JSON files to `output/`, and tracks completed files in `transcription_progress.txt`.

Each transcript JSON contains the source file name, YouTube ID, and word-level timestamps:

```json
{
  "file_name": "example.mp3",
  "youtube_id": "exampleVideoId",
  "words": [
    {
      "word": "example",
      "start": 1.23,
      "end": 1.56
    }
  ]
}
```

## Local Transcript Search

Run fuzzy word search directly against `output/*.json`:

```powershell
python search.py
```

The script prompts for a word, searches transcript files with `rapidfuzz`, and prints matching video IDs, video names, timestamps, similarity scores, and YouTube timestamp links.

## Corpus And Fine-Tuning Experiments

Create a plain-text corpus from generated transcript JSON:

```powershell
python concat.py
```

This writes `combined_words.txt`, with one transcript-derived sentence per line.

Run the experimental fine-tuning script:

```powershell
python finetune.py
```

`finetune.py` loads `Finnish-NLP/Ahma-7B` with Unsloth, applies a LoRA configuration, and trains on `combined_words.txt`. This is experimental and assumes a compatible GPU environment.

Use `measure.py` to inspect faster-whisper memory behavior on sample audio files:

```powershell
python measure.py
```

## Web Stack

The web app is split into three parts:

- `web/frontend`: Next.js search UI
- `web/backend`: Fastify API, PostgreSQL search queries, migrations, analytics, and importer
- `web/db`: PostgreSQL schema migrations

The backend applies ordered SQL migrations from `web/db/migrations`. The importer reads `videos.json` and `output/*.json`, chunks transcripts, and stores them in PostgreSQL.

## Local Web Development

Start only PostgreSQL:

```powershell
cd web
docker compose -f docker-compose.dev.yml up -d
```

The development database is published on host port `55422` by default and binds to `127.0.0.1`.

Install frontend and backend dependencies:

```powershell
cd frontend
npm install
cd ..\backend
npm install
```

Create local env files:

```powershell
cd ..\frontend
Copy-Item .env.example .env.local
cd ..\backend
Copy-Item .env.example .env
```

Frontend local env:

```text
BACKEND_URL=http://localhost:4000
```

Backend local env:

```text
HOST=0.0.0.0
PORT=4000
DATABASE_URL=postgresql://niilo22:niilo22@localhost:5432/niilo22
CORS_ORIGIN=http://localhost:3000
VIDEOS_JSON_PATH=../../videos.json
OUTPUT_DIR=../../output
MIGRATION_PATH=../db/migrations
```

If you started PostgreSQL with `web/docker-compose.dev.yml`, set the backend database URL to port `55422` unless your local environment maps PostgreSQL to `5432`:

```text
DATABASE_URL=postgresql://niilo22:niilo22@localhost:55422/niilo22
```

Import transcripts into PostgreSQL:

```powershell
cd web\backend
npm run import:data
```

Run the backend:

```powershell
cd web\backend
npm run dev
```

Run the frontend:

```powershell
cd web\frontend
npm run dev
```

Local services:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- PostgreSQL: `localhost:55422` when using `docker-compose.dev.yml`

The frontend proxies `/api/search` to the backend through `BACKEND_URL`, so browser requests stay on the frontend origin.

## Production-Style Docker Compose

From `web/`, create the Compose env file:

```powershell
cd web
Copy-Item .env.example .env
```

Default Compose env values:

```text
POSTGRES_DB=niilo22
POSTGRES_USER=niilo22
POSTGRES_PASSWORD=niilo22
POSTGRES_BIND_IP=127.0.0.1
POSTGRES_HOST_PORT=55422
BACKEND_BIND_IP=127.0.0.1
BACKEND_HOST_PORT=4222
FRONTEND_BIND_IP=127.0.0.1
FRONTEND_HOST_PORT=3222
BACKEND_URL=http://backend:4000
FRONTEND_ORIGIN=https://niilo22.koodattu.dev
```

Start the full stack:

```powershell
docker compose up --build -d
```

This starts:

- PostgreSQL
- Fastify backend
- Next.js frontend

The production-style stack uses these host ports by default:

- Frontend: `3222`
- Backend: `4222`
- PostgreSQL: `55422`

The published Docker ports default to `127.0.0.1`, which is suitable for nginx or another reverse proxy on the same VM. Change the relevant bind IP to `0.0.0.0` only if you intentionally want direct remote access.

The importer is opt-in and does not run on every `docker compose up`. Run it manually:

```powershell
docker compose --profile import up importer
```

Follow importer logs:

```powershell
docker compose logs -f importer
```

The importer stores a source signature and skips the expensive full import when the current `videos.json` plus transcript file metadata match the last successful import.

Connect to PostgreSQL from the host or another tool:

```text
Host: <vm-ip-or-hostname>
Port: 55422
Database: niilo22
User: niilo22
Password: niilo22
```

Replace default credentials in `web/.env` before running the stack in a real deployment.

Stop the stack without deleting data:

```powershell
docker compose down
```

Stop the stack and remove the PostgreSQL volume:

```powershell
docker compose down -v
```

## Search Model

PostgreSQL stores imported data in two main areas:

- `videos`: video metadata
- `transcript_chunks`: timestamped transcript chunks

Search combines PostgreSQL full-text search and trigram similarity. Results are grouped by video and returned with timestamped snippets so the UI can link directly to the relevant moment in a video.

The backend also exposes:

- `/api/search` for transcript search
- `/api/videos/:videoId` for shared video result pages
- health and analytics routes used by the web stack

## Generated Files And Data

These files and directories are produced or updated by the pipeline:

- `videos.json`
- `videos/`
- `output/`
- `transcription_progress.txt`
- `combined_words.txt`
- `outputs/` from fine-tuning experiments

Some transcript files may be empty when a source video has no useful speech.

## Safety Notes

- Do not commit `.env` files, API keys, cookies, credentials, or private deployment settings.
- Use local or least-privilege YouTube API credentials.
- Review `web/.env` before deployment; the included database credentials are development defaults.
- Re-running the web importer is safe: it upserts videos and replaces transcript chunks per video.
