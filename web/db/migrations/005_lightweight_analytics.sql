ALTER TABLE search_queries
  ADD COLUMN IF NOT EXISTS measured_query_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE search_queries
  ADD COLUMN IF NOT EXISTS zero_result_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE search_queries
  ADD COLUMN IF NOT EXISTS total_result_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE search_queries
  ADD COLUMN IF NOT EXISTS total_duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS search_queries_zero_result_count_idx
  ON search_queries (zero_result_count DESC, normalized_query ASC)
  WHERE zero_result_count > 0;

CREATE TABLE IF NOT EXISTS analytics_distinctive_phrases (
  category TEXT NOT NULL CHECK (category IN ('bigram', 'trigram')),
  term TEXT NOT NULL,
  occurrence_count BIGINT NOT NULL,
  distinctiveness_score DOUBLE PRECISION NOT NULL,
  source_signature TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category, term)
);

CREATE INDEX IF NOT EXISTS analytics_distinctive_phrases_category_score_idx
  ON analytics_distinctive_phrases (
    category,
    distinctiveness_score DESC,
    occurrence_count DESC,
    term ASC
  );
