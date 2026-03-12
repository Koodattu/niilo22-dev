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

interface SourceSummaryRow extends QueryResultRow {
  total_videos: number | string;
  total_chunks: number | string;
  total_transcript_words: number | string;
  max_video_updated_at: string | null;
  max_chunk_created_at: string | null;
}

interface ImportStateRow extends QueryResultRow {
  source_signature: string;
}

interface SummaryRow extends QueryResultRow {
  metrics: AnalyticsSummary;
  refreshed_at: string;
}

interface TermRow extends QueryResultRow {
  term: string;
  occurrence_count: number | string;
}

interface NormalizedChunkRow extends QueryResultRow {
  normalized_text: string;
}

interface SourceSummary {
  signature: string;
  totalVideos: number;
  totalChunks: number;
  totalTranscriptWords: number;
}

interface AggregatedTermSet {
  uniqueWords: number;
  uniqueBigrams: number;
  uniqueTrigrams: number;
  words: AnalyticsMetricEntry[];
  bigrams: AnalyticsMetricEntry[];
  trigrams: AnalyticsMetricEntry[];
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

function buildSourceSignature(row: SourceSummaryRow): string {
  return [
    toNumber(row.total_videos),
    toNumber(row.total_chunks),
    toNumber(row.total_transcript_words),
    row.max_video_updated_at ?? "epoch",
    row.max_chunk_created_at ?? "epoch",
  ].join(":");
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function buildTopEntries(counts: Map<string, number>, limit: number): AnalyticsMetricEntry[] {
  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
    }));
}

async function loadSourceSummary(client: PoolClient): Promise<SourceSummary> {
  const importStateResult = await client.query<ImportStateRow>(
    `
      SELECT source_signature
      FROM import_state
      WHERE job_name = 'full-import'
      LIMIT 1
    `,
  );

  const { rows } = await client.query<SourceSummaryRow>(`
    SELECT
      (SELECT COUNT(*) FROM videos) AS total_videos,
      (SELECT COUNT(*) FROM transcript_chunks) AS total_chunks,
      (SELECT COALESCE(SUM(transcript_word_count), 0) FROM videos) AS total_transcript_words,
      (SELECT COALESCE(MAX(updated_at), 'epoch'::timestamptz)::text FROM videos) AS max_video_updated_at,
      (SELECT COALESCE(MAX(created_at), 'epoch'::timestamptz)::text FROM transcript_chunks) AS max_chunk_created_at
  `);

  const row = rows[0];

  if (!row) {
    return {
      signature: "0:0:0:epoch:epoch",
      totalVideos: 0,
      totalChunks: 0,
      totalTranscriptWords: 0,
    };
  }

  return {
    signature: importStateResult.rows[0]?.source_signature ?? buildSourceSignature(row),
    totalVideos: toNumber(row.total_videos),
    totalChunks: toNumber(row.total_chunks),
    totalTranscriptWords: toNumber(row.total_transcript_words),
  };
}

async function collectCorpusAnalytics(client: PoolClient): Promise<AggregatedTermSet> {
  const { rows } = await client.query<NormalizedChunkRow>(`
    SELECT normalized_text
    FROM transcript_chunks
    WHERE normalized_text <> ''
  `);

  const wordCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();
  const trigramCounts = new Map<string, number>();

  for (const row of rows) {
    const tokens = row.normalized_text
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean);

    for (let index = 0; index < tokens.length; index += 1) {
      const firstToken = tokens[index];

      if (!firstToken) {
        continue;
      }

      incrementCount(wordCounts, firstToken);

      const secondToken = tokens[index + 1];
      if (secondToken) {
        incrementCount(bigramCounts, `${firstToken} ${secondToken}`);
      }

      const thirdToken = tokens[index + 2];
      if (secondToken && thirdToken) {
        incrementCount(trigramCounts, `${firstToken} ${secondToken} ${thirdToken}`);
      }
    }
  }

  return {
    uniqueWords: wordCounts.size,
    uniqueBigrams: bigramCounts.size,
    uniqueTrigrams: trigramCounts.size,
    words: buildTopEntries(wordCounts, SNAPSHOT_LIMIT),
    bigrams: buildTopEntries(bigramCounts, SNAPSHOT_LIMIT),
    trigrams: buildTopEntries(trigramCounts, SNAPSHOT_LIMIT),
  };
}

async function insertSnapshotEntries(client: PoolClient, category: "word" | "bigram" | "trigram", entries: AnalyticsMetricEntry[], sourceSignature: string): Promise<void> {
  for (const entry of entries) {
    await client.query(
      `
        INSERT INTO analytics_term_frequencies (
          category,
          term,
          occurrence_count,
          source_signature,
          refreshed_at
        )
        VALUES ($1, $2, $3, $4, NOW())
      `,
      [category, entry.label, entry.count, sourceSignature],
    );
  }
}

async function ensureAnalyticsSnapshot(): Promise<void> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [ANALYTICS_LOCK_NAMESPACE, ANALYTICS_LOCK_KEY]);

    const sourceSummary = await loadSourceSummary(client);
    const existingSummary = await client.query<{ source_signature: string }>(
      `
        SELECT source_signature
        FROM analytics_summary
        WHERE snapshot_key = $1
        LIMIT 1
      `,
      [SNAPSHOT_KEY],
    );

    if (existingSummary.rows[0]?.source_signature === sourceSummary.signature) {
      return;
    }

    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("DELETE FROM analytics_term_frequencies");

    const aggregatedTerms = await collectCorpusAnalytics(client);

    await insertSnapshotEntries(client, "word", aggregatedTerms.words, sourceSummary.signature);
    await insertSnapshotEntries(client, "bigram", aggregatedTerms.bigrams, sourceSummary.signature);
    await insertSnapshotEntries(client, "trigram", aggregatedTerms.trigrams, sourceSummary.signature);

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
          totalVideos: sourceSummary.totalVideos,
          totalTranscriptChunks: sourceSummary.totalChunks,
          totalTranscriptWords: sourceSummary.totalTranscriptWords,
          uniqueWords: aggregatedTerms.uniqueWords,
          uniqueBigrams: aggregatedTerms.uniqueBigrams,
          uniqueTrigrams: aggregatedTerms.uniqueTrigrams,
        }),
        sourceSummary.signature,
      ],
    );

    await client.query("COMMIT");
    transactionStarted = false;
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
  await ensureAnalyticsSnapshot();

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
