-- Switch search_vector from 'simple' to 'finnish' text search config
-- Finnish Snowball stemmer handles morphology: kahvia/kahvin/kahvit → kahv
-- This eliminates the need for expensive trigram word_similarity in WHERE clauses

-- Drop dependent index
DROP INDEX IF EXISTS transcript_chunks_search_vector_idx;

-- Recreate the column with Finnish config
ALTER TABLE transcript_chunks DROP COLUMN search_vector;
ALTER TABLE transcript_chunks
  ADD COLUMN search_vector TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('finnish', coalesce(normalized_text, ''))) STORED;

-- Recreate the GIN index
CREATE INDEX transcript_chunks_search_vector_idx
  ON transcript_chunks USING GIN (search_vector);

-- Drop the trigram index on normalized_text — no longer used in WHERE clauses
DROP INDEX IF EXISTS transcript_chunks_normalized_text_trgm_idx;

-- Drop the trigram index on video titles — no longer used for search
DROP INDEX IF EXISTS videos_normalized_title_trgm_idx;

-- Performance tuning for search workload
ALTER SYSTEM SET jit = off;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET work_mem = '16MB';
SELECT pg_reload_conf();
