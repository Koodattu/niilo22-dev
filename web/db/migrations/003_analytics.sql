CREATE TABLE IF NOT EXISTS search_queries (
  normalized_query TEXT PRIMARY KEY,
  sample_query TEXT NOT NULL,
  query_count BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_queries_query_count_idx
  ON search_queries (query_count DESC, normalized_query ASC);

CREATE TABLE IF NOT EXISTS analytics_term_frequencies (
  category TEXT NOT NULL CHECK (category IN ('word', 'bigram', 'trigram')),
  term TEXT NOT NULL,
  occurrence_count BIGINT NOT NULL,
  source_signature TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category, term)
);

CREATE INDEX IF NOT EXISTS analytics_term_frequencies_category_count_idx
  ON analytics_term_frequencies (category, occurrence_count DESC, term ASC);

CREATE TABLE IF NOT EXISTS analytics_summary (
  snapshot_key TEXT PRIMARY KEY,
  metrics JSONB NOT NULL,
  source_signature TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);