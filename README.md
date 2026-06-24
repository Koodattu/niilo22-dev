# niilo22-dev

![Niilo22.dev search interface](niilo22_dev.PNG)

`niilo22-dev` is a toolkit and web application for building a searchable archive of Niilo22 YouTube videos from downloaded audio and generated Finnish transcripts.

The repository has two main parts:

- A Python data pipeline that collects video metadata, downloads media, transcribes speech, searches transcript JSON files, and prepares text for model fine-tuning experiments.
- A web stack that imports the transcript data into PostgreSQL and serves a searchable Next.js UI backed by a Fastify API.

## What It Does

The project turns Niilo22 videos into timestamped, searchable transcript data:

1. Fetches video metadata from YouTube into `videos.json`.
2. Downloads video audio or video files into `videos/` with `yt-dlp`.
3. Transcribes Finnish audio with `faster-whisper` into word-level timestamp JSON files in `output/`.
4. Supports local fuzzy word search across transcript JSON files.
5. Imports videos and transcript chunks into PostgreSQL for the web app.
6. Provides a browser search interface with timestamped snippets and shareable video result pages.

There are also experimental scripts for combining transcript text and fine-tuning a Finnish language model from the generated corpus.

## Repository Layout

```text
.
|-- download.py              # Fetch YouTube metadata and download MP3/MP4 files
|-- transcribe.py            # Batch transcribe downloaded MP3 files with faster-whisper
|-- search.py                # Local fuzzy search over transcript JSON files
|-- concat.py                # Combine transcript words into a training text file
|-- finetune.py              # Experimental Unsloth fine-tuning script
|-- measure.py               # Whisper memory/performance measurement helper
|-- videos.json              # Video metadata and download state
|-- videos/                  # Downloaded media files
|-- output/                  # Generated transcript JSON files
`-- web/                     # Search web app, API, database migrations, Docker setup
```

See [web/README.md](web/README.md) for the detailed web stack setup and Docker workflow.

## Data Pipeline

Create a local environment file from `example.env`:

```powershell
Copy-Item example.env .env
```

The root scripts use these values:

```text
YT_API_KEY=
YT_CHANNEL=niilo22
DOWNLOAD_FOLDER=videos
```

Install the Python requirements in a suitable environment. Transcription and fine-tuning are GPU-oriented workflows and currently assume CUDA-friendly packages.

Download metadata and media:

```powershell
python download.py mp3
```

Transcribe downloaded MP3 files:

```powershell
python transcribe.py
```

Search generated transcript JSON files locally:

```powershell
python search.py
```

Create a combined text corpus for experiments:

```powershell
python concat.py
```

## Web Application

The web app lives under `web/` and consists of:

- `web/frontend`: Next.js search interface
- `web/backend`: Fastify API, importer, search routes, and analytics routes
- `web/db`: ordered PostgreSQL migrations
- `web/docker-compose.dev.yml`: local development database
- `web/docker-compose.yml`: production-style stack

For local web development, start PostgreSQL, install frontend/backend dependencies, import the transcript data, and run both servers as documented in [web/README.md](web/README.md).

By default, the local development frontend runs on `http://localhost:3000` and the backend on `http://localhost:4000`. The production-style Docker Compose setup uses project-specific host ports to avoid common local port conflicts.

## Notes

- `videos.json`, `videos/`, `output/`, and `transcription_progress.txt` are generated or updated by the data pipeline.
- Some transcript outputs may be empty when a source video has no useful speech.
- Re-running the importer is safe: it upserts videos and replaces transcript chunks per video.
- `.env` should contain local credentials only and should not be committed.
