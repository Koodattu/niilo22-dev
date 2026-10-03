-- The search cache version must follow committed data across importer/API processes.
CREATE TABLE IF NOT EXISTS search_data_revision (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  revision BIGINT NOT NULL DEFAULT 0
);

INSERT INTO search_data_revision (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;
