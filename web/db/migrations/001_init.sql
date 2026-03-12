CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS videos (
  youtube_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  downloaded BOOLEAN NOT NULL DEFAULT FALSE,
  local_file_name TEXT,
  transcript_word_count INTEGER NOT NULL DEFAULT 0,
  transcript_status TEXT NOT NULL DEFAULT 'missing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcript_chunks (
  id BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(youtube_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  words_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(normalized_text, ''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS videos_published_at_idx ON videos (published_at DESC);
CREATE INDEX IF NOT EXISTS videos_transcript_status_idx ON videos (transcript_status);
CREATE INDEX IF NOT EXISTS videos_normalized_title_trgm_idx ON videos USING GIN (normalized_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS transcript_chunks_video_start_idx ON transcript_chunks (video_id, start_ms);
CREATE INDEX IF NOT EXISTS transcript_chunks_search_vector_idx ON transcript_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS transcript_chunks_normalized_text_trgm_idx ON transcript_chunks USING GIN (normalized_text gin_trgm_ops);
