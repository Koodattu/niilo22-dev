import type { PoolClient, QueryResultRow } from "pg";

import { pool, query } from "../db.js";
import { normalizeSearchText } from "./normalize.js";

const ANALYTICS_LOCK_NAMESPACE = 22;
const ANALYTICS_LOCK_KEY = 201;
const SNAPSHOT_KEY = "default";
const SNAPSHOT_LIMIT = 500;

interface QuerySummaryRow extends QueryResultRow {
  unique_queries: number | string;
  total_queries: number | string;
}

interface QueryRow extends QueryResultRow {
  normalized_query: string;
  query_count: number | string;
}

interface RefreshSummaryRow extends QueryResultRow {
  total_videos: number | string;
  total_chunks: number | string;
  total_transcript_words: number | string;
  unique_words: number | string;
  unique_bigrams: number | string;
  unique_trigrams: number | string;
}

interface SummaryRow extends QueryResultRow {
  metrics: AnalyticsSummary;
  refreshed_at: string;
}

interface TermRow extends QueryResultRow {
  term: string;
  occurrence_count: number | string;
}

export interface AnalyticsMetricEntry {
  label: string;
  count: number;
}

export interface AnalyticsSummary {
  totalVideos: number;
  totalTranscriptChunks: number;
  totalTranscriptWords: number;
  uniqueWords: number;
  uniqueBigrams: number;
  uniqueTrigrams: number;
  uniqueTrackedQueries: number;
  totalTrackedQueries: number;
  refreshedAt: string;
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  queries: AnalyticsMetricEntry[];
  words: AnalyticsMetricEntry[];
  bigrams: AnalyticsMetricEntry[];
  trigrams: AnalyticsMetricEntry[];
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function loadSnapshotSignature(client: PoolClient): Promise<string | null> {
  const { rows } = await client.query<{ source_signature: string }>(
    `
      SELECT source_signature
      FROM analytics_summary
      WHERE snapshot_key = $1
      LIMIT 1
    `,
    [SNAPSHOT_KEY],
  );

  return rows[0]?.source_signature ?? null;
}

async function populateRefreshTermCounts(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE analytics_refresh_term_counts (
      category TEXT NOT NULL,
      term TEXT NOT NULL,
      occurrence_count BIGINT NOT NULL
    ) ON COMMIT DROP
  `);

  await client.query(`
    WITH chunk_tokens AS MATERIALIZED (
      SELECT string_to_array(normalized_text, ' ') AS tokens
      FROM transcript_chunks
      WHERE normalized_text <> ''
    ),
    ngrams AS (
      SELECT
        'word'::text AS category,
        chunk.tokens[token_position.value] AS term
      FROM chunk_tokens AS chunk
      CROSS JOIN LATERAL generate_subscripts(chunk.tokens, 1) AS token_position(value)

      UNION ALL

      SELECT
        'bigram'::text AS category,
        chunk.tokens[token_position.value] || ' ' || chunk.tokens[token_position.value + 1] AS term
      FROM chunk_tokens AS chunk
      CROSS JOIN LATERAL generate_subscripts(chunk.tokens, 1) AS token_position(value)
      WHERE token_position.value < cardinality(chunk.tokens)

      UNION ALL

      SELECT
        'trigram'::text AS category,
        chunk.tokens[token_position.value] || ' ' || chunk.tokens[token_position.value + 1] || ' ' || chunk.tokens[token_position.value + 2] AS term
      FROM chunk_tokens AS chunk
      CROSS JOIN LATERAL generate_subscripts(chunk.tokens, 1) AS token_position(value)
      WHERE token_position.value + 2 <= cardinality(chunk.tokens)
    )
    INSERT INTO analytics_refresh_term_counts (
      category,
      term,
      occurrence_count
    )
    SELECT
      category,
      term,
      COUNT(*) AS occurrence_count
    FROM ngrams
    GROUP BY category, term
  `);
}

async function replaceSnapshotEntries(client: PoolClient, sourceSignature: string): Promise<void> {
  await client.query("DELETE FROM analytics_term_frequencies");

  await client.query(
    `
      WITH ranked_terms AS (
        SELECT
          category,
          term,
          occurrence_count,
          ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY occurrence_count DESC, term ASC
          ) AS term_rank
        FROM analytics_refresh_term_counts
      )
      INSERT INTO analytics_term_frequencies (
        category,
        term,
        occurrence_count,
        source_signature,
        refreshed_at
      )
      SELECT
        category,
        term,
        occurrence_count,
        $2,
        NOW()
      FROM ranked_terms
      WHERE term_rank <= $1
    `,
    [SNAPSHOT_LIMIT, sourceSignature],
  );
}

async function loadRefreshSummary(client: PoolClient): Promise<RefreshSummaryRow> {
  const { rows } = await client.query<RefreshSummaryRow>(`
    SELECT
      (SELECT COUNT(*) FROM videos) AS total_videos,
      (SELECT COUNT(*) FROM transcript_chunks) AS total_chunks,
      (SELECT COALESCE(SUM(transcript_word_count), 0) FROM videos) AS total_transcript_words,
      COUNT(*) FILTER (WHERE category = 'word') AS unique_words,
      COUNT(*) FILTER (WHERE category = 'bigram') AS unique_bigrams,
      COUNT(*) FILTER (WHERE category = 'trigram') AS unique_trigrams
    FROM analytics_refresh_term_counts
  `);

  return (
    rows[0] ?? {
      total_videos: 0,
      total_chunks: 0,
      total_transcript_words: 0,
      unique_words: 0,
      unique_bigrams: 0,
      unique_trigrams: 0,
    }
  );
}

async function writeSnapshotSummary(client: PoolClient, sourceSignature: string, summary: RefreshSummaryRow): Promise<void> {
  await client.query(
    `
      INSERT INTO analytics_summary (
        snapshot_key,
        metrics,
        source_signature,
        refreshed_at
      )
      VALUES ($1, $2::jsonb, $3, NOW())
      ON CONFLICT (snapshot_key) DO UPDATE
      SET metrics = EXCLUDED.metrics,
          source_signature = EXCLUDED.source_signature,
          refreshed_at = EXCLUDED.refreshed_at
    `,
    [
      SNAPSHOT_KEY,
      JSON.stringify({
        totalVideos: toNumber(summary.total_videos),
        totalTranscriptChunks: toNumber(summary.total_chunks),
        totalTranscriptWords: toNumber(summary.total_transcript_words),
        uniqueWords: toNumber(summary.unique_words),
        uniqueBigrams: toNumber(summary.unique_bigrams),
        uniqueTrigrams: toNumber(summary.unique_trigrams),
      }),
      sourceSignature,
    ],
  );
}

export async function refreshAnalyticsSnapshot(sourceSignature: string): Promise<boolean> {
  const normalizedSourceSignature = sourceSignature.trim();
  if (!normalizedSourceSignature) {
    throw new Error("Analytics source signature is required");
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [ANALYTICS_LOCK_NAMESPACE, ANALYTICS_LOCK_KEY]);

    if ((await loadSnapshotSignature(client)) === normalizedSourceSignature) {
      return false;
    }

    await client.query("BEGIN");
    transactionStarted = true;

    await populateRefreshTermCounts(client);
    await replaceSnapshotEntries(client, normalizedSourceSignature);
    const summary = await loadRefreshSummary(client);
    await writeSnapshotSummary(client, normalizedSourceSignature, summary);

    await client.query("COMMIT");
    transactionStarted = false;
    return true;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [ANALYTICS_LOCK_NAMESPACE, ANALYTICS_LOCK_KEY]);
    client.release();
  }
}

async function loadTopQueries(limit: number): Promise<AnalyticsMetricEntry[]> {
  const { rows } = await query<QueryRow>(
    `
      SELECT normalized_query, query_count
      FROM search_queries
      ORDER BY query_count DESC, normalized_query ASC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map((row) => ({
    label: row.normalized_query,
    count: toNumber(row.query_count),
  }));
}

async function loadTopTerms(category: "word" | "bigram" | "trigram", limit: number): Promise<AnalyticsMetricEntry[]> {
  const { rows } = await query<TermRow>(
    `
      SELECT term, occurrence_count
      FROM analytics_term_frequencies
      WHERE category = $1
      ORDER BY occurrence_count DESC, term ASC
      LIMIT $2
    `,
    [category, limit],
  );

  return rows.map((row) => ({
    label: row.term,
    count: toNumber(row.occurrence_count),
  }));
}

export async function recordSearchQuery(rawQuery: string): Promise<void> {
  const normalizedQuery = normalizeSearchText(rawQuery);
  const sampleQuery = rawQuery.replace(/\s+/g, " ").trim();

  if (normalizedQuery.length < 2 || sampleQuery.length === 0) {
    return;
  }

  await query(
    `
      INSERT INTO search_queries (
        normalized_query,
        sample_query,
        query_count,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 1, NOW(), NOW())
      ON CONFLICT (normalized_query) DO UPDATE
      SET sample_query = EXCLUDED.sample_query,
          query_count = search_queries.query_count + 1,
          updated_at = NOW()
    `,
    [normalizedQuery, sampleQuery],
  );
}

export async function loadAnalytics(limit = 12): Promise<AnalyticsResponse> {
  const safeLimit = Math.max(1, Math.min(limit, 25));

  const [summaryResult, querySummaryResult, queries, words, bigrams, trigrams] = await Promise.all([
    query<SummaryRow>(
      `
        SELECT metrics, refreshed_at
        FROM analytics_summary
        WHERE snapshot_key = $1
        LIMIT 1
      `,
      [SNAPSHOT_KEY],
    ),
    query<QuerySummaryRow>(`
      SELECT
        COUNT(*) AS unique_queries,
        COALESCE(SUM(query_count), 0) AS total_queries
      FROM search_queries
    `),
    loadTopQueries(safeLimit),
    loadTopTerms("word", safeLimit),
    loadTopTerms("bigram", safeLimit),
    loadTopTerms("trigram", safeLimit),
  ]);

  const metrics = summaryResult.rows[0]?.metrics;
  const querySummary = querySummaryResult.rows[0];

  return {
    summary: {
      totalVideos: toNumber(metrics?.totalVideos),
      totalTranscriptChunks: toNumber(metrics?.totalTranscriptChunks),
      totalTranscriptWords: toNumber(metrics?.totalTranscriptWords),
      uniqueWords: toNumber(metrics?.uniqueWords),
      uniqueBigrams: toNumber(metrics?.uniqueBigrams),
      uniqueTrigrams: toNumber(metrics?.uniqueTrigrams),
      uniqueTrackedQueries: toNumber(querySummary?.unique_queries),
      totalTrackedQueries: toNumber(querySummary?.total_queries),
      refreshedAt: summaryResult.rows[0]?.refreshed_at ?? new Date(0).toISOString(),
    },
    queries,
    words,
    bigrams,
    trigrams,
  };
}
