CREATE TABLE IF NOT EXISTS import_state (
  job_name TEXT PRIMARY KEY,
  source_signature TEXT NOT NULL,
  video_count INTEGER NOT NULL,
  transcript_file_count INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);