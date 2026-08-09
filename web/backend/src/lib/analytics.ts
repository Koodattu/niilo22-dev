import type { PoolClient, QueryResultRow } from "pg";

import { pool, query } from "../db.js";
import { normalizeSearchText } from "./normalize.js";

const ANALYTICS_LOCK_NAMESPACE = 22;
const ANALYTICS_LOCK_KEY = 201;
const SNAPSHOT_KEY = "default";
const SNAPSHOT_FORMAT_VERSION = 2;
const SNAPSHOT_LIMIT = 500;
const SNAPSHOT_LIST_LIMIT = 25;
const MIN_DISTINCTIVE_PHRASE_OCCURRENCES = 5;

interface QuerySummaryRow extends QueryResultRow {
  unique_queries: number | string;
  total_queries: number | string;
  measured_queries: number | string;
  zero_result_queries: number | string;
  total_result_count: number | string;
  total_duration_ms: number | string;
}

interface QueryRow extends QueryResultRow {
  normalized_query: string;
  query_count: number | string;
}

interface FailedQueryRow extends QueryResultRow {
  normalized_query: string;
  zero_result_count: number | string;
}

interface RefreshSummaryRow extends QueryResultRow {
  total_videos: number | string;
  total_chunks: number | string;
  total_transcript_words: number | string;
  ready_videos: number | string;
  ambient_videos: number | string;
  missing_videos: number | string;
  total_transcript_duration_ms: number | string;
  average_words_per_transcribed_video: number | string;
  median_words_per_transcribed_video: number | string;
  p90_words_per_transcribed_video: number | string;
  unique_words: number | string;
  unique_bigrams: number | string;
  unique_trigrams: number | string;
}

interface RefreshVideoRow extends QueryResultRow {
  video_id: string;
  title: string;
  transcript_word_count: number | string;
}

interface RefreshYearRow extends QueryResultRow {
  published_year: number | string;
  video_count: number | string;
  transcript_word_count: number | string;
  transcript_duration_ms: number | string;
}

interface SnapshotMetrics {
  totalVideos: number;
  totalTranscriptChunks: number;
  totalTranscriptWords: number;
  readyVideos: number;
  ambientVideos: number;
  missingVideos: number;
  transcriptCoveragePercent: number;
  approximateTranscriptHours: number;
  averageWordsPerTranscribedVideo: number;
  medianWordsPerTranscribedVideo: number;
  p90WordsPerTranscribedVideo: number;
  uniqueWords: number;
  uniqueBigrams: number;
  uniqueTrigrams: number;
  topTranscriptVideos: AnalyticsVideoEntry[];
  yearlyActivity: AnalyticsYearEntry[];
}

interface SummaryRow extends QueryResultRow {
  metrics: SnapshotMetrics;
  refreshed_at: string;
}

interface TermRow extends QueryResultRow {
  category: "word" | "bigram" | "trigram";
  term: string;
  occurrence_count: number | string;
}

interface DistinctivePhraseRow extends QueryResultRow {
  category: "bigram" | "trigram";
  term: string;
  occurrence_count: number | string;
}

export interface AnalyticsMetricEntry {
  label: string;
  count: number;
}

export interface AnalyticsVideoEntry {
  videoId: string;
  title: string;
  wordCount: number;
}

export interface AnalyticsYearEntry {
  year: number;
  videoCount: number;
  wordCount: number;
  transcriptHours: number;
}

export interface AnalyticsSummary {
  totalVideos: number;
  totalTranscriptChunks: number;
  totalTranscriptWords: number;
  readyVideos: number;
  ambientVideos: number;
  missingVideos: number;
  transcriptCoveragePercent: number;
  approximateTranscriptHours: number;
  averageWordsPerTranscribedVideo: number;
  medianWordsPerTranscribedVideo: number;
  p90WordsPerTranscribedVideo: number;
  uniqueWords: number;
  uniqueBigrams: number;
  uniqueTrigrams: number;
  uniqueTrackedQueries: number;
  totalTrackedQueries: number;
  measuredTrackedQueries: number;
  zeroResultQueries: number;
  searchSuccessRate: number;
  averageSearchResultCount: number;
  averageSearchDurationMs: number;
  refreshedAt: string;
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  queries: AnalyticsMetricEntry[];
  failedQueries: AnalyticsMetricEntry[];
  words: AnalyticsMetricEntry[];
  bigrams: AnalyticsMetricEntry[];
  trigrams: AnalyticsMetricEntry[];
  distinctiveBigrams: AnalyticsMetricEntry[];
  distinctiveTrigrams: AnalyticsMetricEntry[];
  topTranscriptVideos: AnalyticsVideoEntry[];
  yearlyActivity: AnalyticsYearEntry[];
}

interface TermGroups {
  words: AnalyticsMetricEntry[];
  bigrams: AnalyticsMetricEntry[];
  trigrams: AnalyticsMetricEntry[];
}

interface DistinctivePhraseGroups {
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

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
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

async function populateRefreshVideoDurations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE analytics_refresh_video_durations
    ON COMMIT DROP
    AS
    SELECT
      video_id,
      COUNT(*) AS chunk_count,
      MAX(end_ms) AS transcript_duration_ms
    FROM transcript_chunks
    GROUP BY video_id
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

async function replaceDistinctivePhraseEntries(client: PoolClient, sourceSignature: string): Promise<void> {
  await client.query("DELETE FROM analytics_distinctive_phrases");

  await client.query(
    `
      WITH totals AS (
        SELECT
          SUM(occurrence_count) FILTER (WHERE category = 'word')::double precision AS word_total,
          SUM(occurrence_count) FILTER (WHERE category = 'bigram')::double precision AS bigram_total,
          SUM(occurrence_count) FILTER (WHERE category = 'trigram')::double precision AS trigram_total
        FROM analytics_refresh_term_counts
      ),
      word_counts AS MATERIALIZED (
        SELECT term, occurrence_count
        FROM analytics_refresh_term_counts
        WHERE category = 'word'
      ),
      phrase_counts AS MATERIALIZED (
        SELECT category, term, occurrence_count
        FROM analytics_refresh_term_counts
        WHERE category IN ('bigram', 'trigram')
          AND occurrence_count >= $1
      ),
      phrase_scores AS (
        SELECT
          phrase.category,
          phrase.term,
          phrase.occurrence_count,
          CASE phrase.category
            WHEN 'bigram' THEN
              LN(
                (phrase.occurrence_count::double precision * POWER(totals.word_total, 2)) /
                NULLIF(totals.bigram_total * first_word.occurrence_count::double precision * second_word.occurrence_count::double precision, 0)
              )
            ELSE
              LN(
                (phrase.occurrence_count::double precision * POWER(totals.word_total, 3)) /
                NULLIF(
                  totals.trigram_total * first_word.occurrence_count::double precision * second_word.occurrence_count::double precision * third_word.occurrence_count::double precision,
                  0
                )
              )
          END * LN(phrase.occurrence_count::double precision + 1) AS distinctiveness_score
        FROM phrase_counts AS phrase
        CROSS JOIN totals
        JOIN word_counts AS first_word
          ON first_word.term = split_part(phrase.term, ' ', 1)
        JOIN word_counts AS second_word
          ON second_word.term = split_part(phrase.term, ' ', 2)
        LEFT JOIN word_counts AS third_word
          ON phrase.category = 'trigram'
         AND third_word.term = split_part(phrase.term, ' ', 3)
        WHERE phrase.category = 'bigram' OR third_word.term IS NOT NULL
      ),
      ranked_phrases AS (
        SELECT
          category,
          term,
          occurrence_count,
          distinctiveness_score,
          ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY distinctiveness_score DESC, occurrence_count DESC, term ASC
          ) AS phrase_rank
        FROM phrase_scores
        WHERE distinctiveness_score > 0
      )
      INSERT INTO analytics_distinctive_phrases (
        category,
        term,
        occurrence_count,
        distinctiveness_score,
        source_signature,
        refreshed_at
      )
      SELECT
        category,
        term,
        occurrence_count,
        distinctiveness_score,
        $3,
        NOW()
      FROM ranked_phrases
      WHERE phrase_rank <= $2
    `,
    [MIN_DISTINCTIVE_PHRASE_OCCURRENCES, SNAPSHOT_LIMIT, sourceSignature],
  );
}

async function loadRefreshSummary(client: PoolClient): Promise<RefreshSummaryRow> {
  const { rows } = await client.query<RefreshSummaryRow>(`
    WITH video_stats AS (
      SELECT
        COUNT(*) AS total_videos,
        COALESCE(SUM(transcript_word_count), 0) AS total_transcript_words,
        COUNT(*) FILTER (WHERE transcript_status = 'ready') AS ready_videos,
        COUNT(*) FILTER (WHERE transcript_status = 'ambient') AS ambient_videos,
        COUNT(*) FILTER (WHERE transcript_status = 'missing') AS missing_videos
      FROM videos
    ),
    word_stats AS (
      SELECT
        COALESCE(AVG(transcript_word_count), 0)::double precision AS average_words_per_transcribed_video,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY transcript_word_count), 0)::double precision AS median_words_per_transcribed_video,
        COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY transcript_word_count), 0)::double precision AS p90_words_per_transcribed_video
      FROM videos
      WHERE transcript_word_count > 0
    ),
    transcript_stats AS (
      SELECT
        COALESCE(SUM(chunk_count), 0) AS total_chunks,
        COALESCE(SUM(transcript_duration_ms), 0)::double precision AS total_transcript_duration_ms
      FROM analytics_refresh_video_durations
    ),
    term_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE category = 'word') AS unique_words,
        COUNT(*) FILTER (WHERE category = 'bigram') AS unique_bigrams,
        COUNT(*) FILTER (WHERE category = 'trigram') AS unique_trigrams
      FROM analytics_refresh_term_counts
    )
    SELECT
      video_stats.total_videos,
      transcript_stats.total_chunks,
      video_stats.total_transcript_words,
      video_stats.ready_videos,
      video_stats.ambient_videos,
      video_stats.missing_videos,
      transcript_stats.total_transcript_duration_ms,
      word_stats.average_words_per_transcribed_video,
      word_stats.median_words_per_transcribed_video,
      word_stats.p90_words_per_transcribed_video,
      term_stats.unique_words,
      term_stats.unique_bigrams,
      term_stats.unique_trigrams
    FROM video_stats
    CROSS JOIN word_stats
    CROSS JOIN transcript_stats
    CROSS JOIN term_stats
  `);

  return (
    rows[0] ?? {
      total_videos: 0,
      total_chunks: 0,
      total_transcript_words: 0,
      ready_videos: 0,
      ambient_videos: 0,
      missing_videos: 0,
      total_transcript_duration_ms: 0,
      average_words_per_transcribed_video: 0,
      median_words_per_transcribed_video: 0,
      p90_words_per_transcribed_video: 0,
      unique_words: 0,
      unique_bigrams: 0,
      unique_trigrams: 0,
    }
  );
}

async function loadRefreshTopVideos(client: PoolClient): Promise<AnalyticsVideoEntry[]> {
  const { rows } = await client.query<RefreshVideoRow>(
    `
      SELECT
        youtube_id AS video_id,
        title,
        transcript_word_count
      FROM videos
      WHERE transcript_word_count > 0
      ORDER BY transcript_word_count DESC, published_at DESC, youtube_id ASC
      LIMIT $1
    `,
    [SNAPSHOT_LIST_LIMIT],
  );

  return rows.map((row) => ({
    videoId: row.video_id,
    title: row.title,
    wordCount: toNumber(row.transcript_word_count),
  }));
}

async function loadRefreshYearlyActivity(client: PoolClient): Promise<AnalyticsYearEntry[]> {
  const { rows } = await client.query<RefreshYearRow>(`
    SELECT
      EXTRACT(YEAR FROM videos.published_at)::integer AS published_year,
      COUNT(*) AS video_count,
      COALESCE(SUM(videos.transcript_word_count), 0) AS transcript_word_count,
      COALESCE(SUM(video_durations.transcript_duration_ms), 0) AS transcript_duration_ms
    FROM videos
    LEFT JOIN analytics_refresh_video_durations AS video_durations ON video_durations.video_id = videos.youtube_id
    GROUP BY published_year
    ORDER BY published_year ASC
  `);

  return rows.map((row) => ({
    year: toNumber(row.published_year),
    videoCount: toNumber(row.video_count),
    wordCount: toNumber(row.transcript_word_count),
    transcriptHours: toNumber(row.transcript_duration_ms) / 3_600_000,
  }));
}

async function writeSnapshotSummary(
  client: PoolClient,
  sourceSignature: string,
  summary: RefreshSummaryRow,
  topTranscriptVideos: AnalyticsVideoEntry[],
  yearlyActivity: AnalyticsYearEntry[],
): Promise<void> {
  const totalVideos = toNumber(summary.total_videos);
  const readyVideos = toNumber(summary.ready_videos);
  const ambientVideos = toNumber(summary.ambient_videos);

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
        totalVideos,
        totalTranscriptChunks: toNumber(summary.total_chunks),
        totalTranscriptWords: toNumber(summary.total_transcript_words),
        readyVideos,
        ambientVideos,
        missingVideos: toNumber(summary.missing_videos),
        transcriptCoveragePercent: ratio(readyVideos + ambientVideos, totalVideos) * 100,
        approximateTranscriptHours: toNumber(summary.total_transcript_duration_ms) / 3_600_000,
        averageWordsPerTranscribedVideo: toNumber(summary.average_words_per_transcribed_video),
        medianWordsPerTranscribedVideo: toNumber(summary.median_words_per_transcribed_video),
        p90WordsPerTranscribedVideo: toNumber(summary.p90_words_per_transcribed_video),
        uniqueWords: toNumber(summary.unique_words),
        uniqueBigrams: toNumber(summary.unique_bigrams),
        uniqueTrigrams: toNumber(summary.unique_trigrams),
        topTranscriptVideos,
        yearlyActivity,
      } satisfies SnapshotMetrics),
      sourceSignature,
    ],
  );
}

export async function refreshAnalyticsSnapshot(sourceSignature: string): Promise<boolean> {
  const normalizedSourceSignature = sourceSignature.trim();
  if (!normalizedSourceSignature) {
    throw new Error("Analytics source signature is required");
  }

  const snapshotSignature = `v${SNAPSHOT_FORMAT_VERSION}:${normalizedSourceSignature}`;

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [ANALYTICS_LOCK_NAMESPACE, ANALYTICS_LOCK_KEY]);

    if ((await loadSnapshotSignature(client)) === snapshotSignature) {
      return false;
    }

    await client.query("BEGIN");
    transactionStarted = true;

    await populateRefreshTermCounts(client);
    await populateRefreshVideoDurations(client);
    await replaceSnapshotEntries(client, snapshotSignature);
    await replaceDistinctivePhraseEntries(client, snapshotSignature);
    const summary = await loadRefreshSummary(client);
    const topTranscriptVideos = await loadRefreshTopVideos(client);
    const yearlyActivity = await loadRefreshYearlyActivity(client);
    await writeSnapshotSummary(client, snapshotSignature, summary, topTranscriptVideos, yearlyActivity);

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

async function loadTopFailedQueries(limit: number): Promise<AnalyticsMetricEntry[]> {
  const { rows } = await query<FailedQueryRow>(
    `
      SELECT normalized_query, zero_result_count
      FROM search_queries
      WHERE zero_result_count > 0
      ORDER BY zero_result_count DESC, normalized_query ASC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map((row) => ({
    label: row.normalized_query,
    count: toNumber(row.zero_result_count),
  }));
}

async function loadTopTerms(limit: number): Promise<TermGroups> {
  const { rows } = await query<TermRow>(
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
        FROM analytics_term_frequencies
      )
      SELECT category, term, occurrence_count
      FROM ranked_terms
      WHERE term_rank <= $1
      ORDER BY category ASC, term_rank ASC
    `,
    [limit],
  );

  const groups: TermGroups = {
    words: [],
    bigrams: [],
    trigrams: [],
  };

  for (const row of rows) {
    const entry = {
      label: row.term,
      count: toNumber(row.occurrence_count),
    };

    if (row.category === "word") {
      groups.words.push(entry);
    } else if (row.category === "bigram") {
      groups.bigrams.push(entry);
    } else {
      groups.trigrams.push(entry);
    }
  }

  return groups;
}

async function loadDistinctivePhrases(limit: number): Promise<DistinctivePhraseGroups> {
  const { rows } = await query<DistinctivePhraseRow>(
    `
      WITH ranked_phrases AS (
        SELECT
          category,
          term,
          occurrence_count,
          ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY distinctiveness_score DESC, occurrence_count DESC, term ASC
          ) AS phrase_rank
        FROM analytics_distinctive_phrases
      )
      SELECT category, term, occurrence_count
      FROM ranked_phrases
      WHERE phrase_rank <= $1
      ORDER BY category ASC, phrase_rank ASC
    `,
    [limit],
  );

  const groups: DistinctivePhraseGroups = {
    bigrams: [],
    trigrams: [],
  };

  for (const row of rows) {
    const entry = {
      label: row.term,
      count: toNumber(row.occurrence_count),
    };

    if (row.category === "bigram") {
      groups.bigrams.push(entry);
    } else {
      groups.trigrams.push(entry);
    }
  }

  return groups;
}

export async function recordSearchQuery(rawQuery: string, resultCount: number, durationMs: number): Promise<void> {
  const normalizedQuery = normalizeSearchText(rawQuery);
  const sampleQuery = rawQuery.replace(/\s+/g, " ").trim();

  if (normalizedQuery.length < 2 || sampleQuery.length === 0) {
    return;
  }

  const safeResultCount = Number.isFinite(resultCount) ? Math.max(0, Math.floor(resultCount)) : 0;
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const zeroResultCount = safeResultCount === 0 ? 1 : 0;

  await query(
    `
      INSERT INTO search_queries (
        normalized_query,
        sample_query,
        query_count,
        measured_query_count,
        zero_result_count,
        total_result_count,
        total_duration_ms,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 1, 1, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (normalized_query) DO UPDATE
      SET sample_query = EXCLUDED.sample_query,
          query_count = search_queries.query_count + 1,
          measured_query_count = search_queries.measured_query_count + 1,
          zero_result_count = search_queries.zero_result_count + EXCLUDED.zero_result_count,
          total_result_count = search_queries.total_result_count + EXCLUDED.total_result_count,
          total_duration_ms = search_queries.total_duration_ms + EXCLUDED.total_duration_ms,
          updated_at = NOW()
    `,
    [normalizedQuery, sampleQuery, zeroResultCount, safeResultCount, safeDurationMs],
  );
}

export async function loadAnalytics(limit = 12): Promise<AnalyticsResponse> {
  const safeLimit = Math.max(1, Math.min(limit, 25));

  const [summaryResult, querySummaryResult, queries, failedQueries, terms, distinctivePhrases] = await Promise.all([
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
        COALESCE(SUM(query_count), 0) AS total_queries,
        COALESCE(SUM(measured_query_count), 0) AS measured_queries,
        COALESCE(SUM(zero_result_count), 0) AS zero_result_queries,
        COALESCE(SUM(total_result_count), 0) AS total_result_count,
        COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms
      FROM search_queries
    `),
    loadTopQueries(safeLimit),
    loadTopFailedQueries(safeLimit),
    loadTopTerms(safeLimit),
    loadDistinctivePhrases(safeLimit),
  ]);

  const metrics = summaryResult.rows[0]?.metrics;
  const querySummary = querySummaryResult.rows[0];
  const measuredTrackedQueries = toNumber(querySummary?.measured_queries);
  const zeroResultQueries = toNumber(querySummary?.zero_result_queries);

  return {
    summary: {
      totalVideos: toNumber(metrics?.totalVideos),
      totalTranscriptChunks: toNumber(metrics?.totalTranscriptChunks),
      totalTranscriptWords: toNumber(metrics?.totalTranscriptWords),
      readyVideos: toNumber(metrics?.readyVideos),
      ambientVideos: toNumber(metrics?.ambientVideos),
      missingVideos: toNumber(metrics?.missingVideos),
      transcriptCoveragePercent: toNumber(metrics?.transcriptCoveragePercent),
      approximateTranscriptHours: toNumber(metrics?.approximateTranscriptHours),
      averageWordsPerTranscribedVideo: toNumber(metrics?.averageWordsPerTranscribedVideo),
      medianWordsPerTranscribedVideo: toNumber(metrics?.medianWordsPerTranscribedVideo),
      p90WordsPerTranscribedVideo: toNumber(metrics?.p90WordsPerTranscribedVideo),
      uniqueWords: toNumber(metrics?.uniqueWords),
      uniqueBigrams: toNumber(metrics?.uniqueBigrams),
      uniqueTrigrams: toNumber(metrics?.uniqueTrigrams),
      uniqueTrackedQueries: toNumber(querySummary?.unique_queries),
      totalTrackedQueries: toNumber(querySummary?.total_queries),
      measuredTrackedQueries,
      zeroResultQueries,
      searchSuccessRate: ratio(measuredTrackedQueries - zeroResultQueries, measuredTrackedQueries) * 100,
      averageSearchResultCount: ratio(toNumber(querySummary?.total_result_count), measuredTrackedQueries),
      averageSearchDurationMs: ratio(toNumber(querySummary?.total_duration_ms), measuredTrackedQueries),
      refreshedAt: summaryResult.rows[0]?.refreshed_at ?? new Date(0).toISOString(),
    },
    queries,
    failedQueries,
    words: terms.words,
    bigrams: terms.bigrams,
    trigrams: terms.trigrams,
    distinctiveBigrams: distinctivePhrases.bigrams,
    distinctiveTrigrams: distinctivePhrases.trigrams,
    topTranscriptVideos: metrics?.topTranscriptVideos.slice(0, safeLimit) ?? [],
    yearlyActivity: metrics?.yearlyActivity ?? [],
  };
}
