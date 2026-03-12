import { performance } from "node:perf_hooks";

import { config } from "../config.js";
import { query } from "../db.js";
import { clipText, normalizeSearchText } from "./normalize.js";
import { readSearchDataVersion } from "./search-data-version.js";

interface SearchRow {
  chunk_id: number;
  video_id: string;
  title: string;
  published_at: string;
  transcript_word_count: number;
  start_ms: number;
  end_ms: number;
  text: string;
  lexical_score: number;
  chunk_similarity: number;
  chunk_word_similarity: number;
  title_similarity: number;
  chunk_substring_boost: number;
  title_substring_boost: number;
}

interface VideoRow {
  video_id: string;
  title: string;
  published_at: string;
  transcript_word_count: number;
}

interface VideoSnippetRow {
  chunk_id: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface SearchSnippet {
  chunkId: number;
  startMs: number;
  endMs: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  embedUrl: string;
  score: number;
}

export interface SearchVideoResult {
  videoId: string;
  title: string;
  publishedAt: string;
  transcriptWordCount: number;
  score: number;
  snippets: SearchSnippet[];
  primaryEmbedUrl: string;
}

export interface SearchResponse {
  query: string;
  normalizedQuery: string;
  tookMs: number;
  resultCount: number;
  results: SearchVideoResult[];
}

const searchResultCache = new Map<string, SearchResponse>();
const inFlightSearches = new Map<string, Promise<SearchResponse>>();

let activeSearchDataVersion: string | null = null;

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

function scoreRow(row: SearchRow): number {
  const lexicalScore = toNumber(row.lexical_score);
  const chunkWordSimilarity = toNumber(row.chunk_word_similarity);
  const chunkSimilarity = toNumber(row.chunk_similarity);
  const titleSimilarity = toNumber(row.title_similarity);
  const chunkSubstringBoost = toNumber(row.chunk_substring_boost);
  const titleSubstringBoost = toNumber(row.title_substring_boost);

  return lexicalScore * 4 + chunkWordSimilarity * 2.5 + chunkSimilarity * 1.5 + titleSimilarity * 2.25 + chunkSubstringBoost + titleSubstringBoost;
}

function buildEmbedUrl(videoId: string, startMs: number): string {
  const startSeconds = Math.max(0, Math.floor(startMs / 1_000));
  return `https://www.youtube.com/embed/${videoId}?start=${startSeconds}&rel=0`;
}

function buildSnippet(videoId: string, row: Pick<SearchRow, "chunk_id" | "start_ms" | "end_ms" | "text">, score: number): SearchSnippet {
  return {
    chunkId: row.chunk_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    startSeconds: Math.floor(row.start_ms / 1_000),
    endSeconds: Math.floor(row.end_ms / 1_000),
    text: clipText(row.text),
    embedUrl: buildEmbedUrl(videoId, row.start_ms),
    score,
  };
}

function roundDuration(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function buildCacheKey(rawQuery: string, limit: number, snippetsPerVideo: number): string {
  return [rawQuery, limit, snippetsPerVideo].join("\u0000");
}

function reuseCachedResponse(cacheKey: string, startedAt: number): SearchResponse | null {
  const cachedResponse = searchResultCache.get(cacheKey);
  if (!cachedResponse) {
    return null;
  }

  searchResultCache.delete(cacheKey);
  searchResultCache.set(cacheKey, cachedResponse);

  return {
    ...cachedResponse,
    tookMs: roundDuration(startedAt),
  };
}

function rememberCachedResponse(cacheKey: string, response: SearchResponse): void {
  if (config.searchCacheMaxEntries <= 0) {
    return;
  }

  if (searchResultCache.has(cacheKey)) {
    searchResultCache.delete(cacheKey);
  }

  searchResultCache.set(cacheKey, response);

  while (searchResultCache.size > config.searchCacheMaxEntries) {
    const oldestCacheKey = searchResultCache.keys().next().value;
    if (!oldestCacheKey) {
      break;
    }

    searchResultCache.delete(oldestCacheKey);
  }
}

async function synchronizeSearchCache(): Promise<string> {
  const nextVersion = await readSearchDataVersion();

  if (nextVersion !== activeSearchDataVersion) {
    searchResultCache.clear();
    inFlightSearches.clear();
    activeSearchDataVersion = nextVersion;
  }

  return nextVersion;
}

async function executeSearch(rawQuery: string, limit: number, snippetsPerVideo: number): Promise<SearchResponse> {
  const startedAt = performance.now();
  const normalizedQuery = normalizeSearchText(rawQuery);

  if (normalizedQuery.length < 2) {
    return {
      query: rawQuery,
      normalizedQuery,
      tookMs: 0,
      resultCount: 0,
      results: [],
    };
  }

  const candidateLimit = Math.max(limit * snippetsPerVideo * 8, 60);
  const sql = `
    WITH prepared AS (
      SELECT
        $1::text AS raw_query,
        $2::text AS normalized_query,
        websearch_to_tsquery('simple', regexp_replace($2, '\\s+', ' ', 'g')) AS ts_query
    )
    SELECT
      c.id AS chunk_id,
      c.video_id,
      v.title,
      v.published_at,
      v.transcript_word_count,
      c.start_ms,
      c.end_ms,
      c.text,
      ts_rank_cd(c.search_vector, prepared.ts_query)::double precision AS lexical_score,
      similarity(c.normalized_text, prepared.normalized_query)::double precision AS chunk_similarity,
      word_similarity(prepared.normalized_query, c.normalized_text)::double precision AS chunk_word_similarity,
      similarity(v.normalized_title, prepared.normalized_query)::double precision AS title_similarity,
      CASE WHEN c.normalized_text LIKE '%' || prepared.normalized_query || '%' THEN 0.45::double precision ELSE 0::double precision END AS chunk_substring_boost,
      CASE WHEN v.normalized_title LIKE '%' || prepared.normalized_query || '%' THEN 0.75::double precision ELSE 0::double precision END AS title_substring_boost
    FROM prepared
    JOIN transcript_chunks c ON true
    JOIN videos v ON v.youtube_id = c.video_id
    WHERE
      c.search_vector @@ prepared.ts_query
      OR c.normalized_text % prepared.normalized_query
      OR v.normalized_title % prepared.normalized_query
      OR c.normalized_text LIKE '%' || prepared.normalized_query || '%'
      OR v.normalized_title LIKE '%' || prepared.normalized_query || '%'
    ORDER BY
      (
        ts_rank_cd(c.search_vector, prepared.ts_query) * 4 +
        word_similarity(prepared.normalized_query, c.normalized_text) * 2.5 +
        similarity(c.normalized_text, prepared.normalized_query) * 1.5 +
        similarity(v.normalized_title, prepared.normalized_query) * 2.25 +
        CASE WHEN c.normalized_text LIKE '%' || prepared.normalized_query || '%' THEN 0.45 ELSE 0 END +
        CASE WHEN v.normalized_title LIKE '%' || prepared.normalized_query || '%' THEN 0.75 ELSE 0 END
      ) DESC,
      c.start_ms ASC
    LIMIT $3
  `;

  const { rows } = await query<SearchRow>(sql, [rawQuery, normalizedQuery, candidateLimit]);
  const grouped = new Map<string, SearchVideoResult>();

  for (const row of rows) {
    const snippetScore = scoreRow(row);
    const snippet = buildSnippet(row.video_id, row, snippetScore);

    const existing = grouped.get(row.video_id);
    if (!existing) {
      grouped.set(row.video_id, {
        videoId: row.video_id,
        title: row.title,
        publishedAt: row.published_at,
        transcriptWordCount: row.transcript_word_count,
        score: snippetScore,
        snippets: [snippet],
        primaryEmbedUrl: snippet.embedUrl,
      });
      continue;
    }

    existing.score = Math.max(existing.score, snippetScore);

    const isNearExistingSnippet = existing.snippets.some((currentSnippet) => Math.abs(currentSnippet.startMs - snippet.startMs) < 5_000);

    if (!isNearExistingSnippet && existing.snippets.length < snippetsPerVideo) {
      existing.snippets.push(snippet);
    }
  }

  const results = [...grouped.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((result) => ({
      ...result,
      snippets: result.snippets.sort((left, right) => left.startMs - right.startMs),
      primaryEmbedUrl: result.snippets[0]?.embedUrl ?? buildEmbedUrl(result.videoId, 0),
    }));

  return {
    query: rawQuery,
    normalizedQuery,
    tookMs: roundDuration(startedAt),
    resultCount: results.length,
    results,
  };
}

export async function loadSharedVideo(videoId: string, snippetId: number | null = null): Promise<SearchResponse | null> {
  const startedAt = performance.now();
  const normalizedVideoId = videoId.trim();

  if (!normalizedVideoId) {
    return null;
  }

  const videoSql = `
    SELECT
      v.youtube_id AS video_id,
      v.title,
      v.published_at,
      v.transcript_word_count
    FROM videos v
    WHERE v.youtube_id = $1
    LIMIT 1
  `;

  const { rows: videoRows } = await query<VideoRow>(videoSql, [normalizedVideoId]);
  const video = videoRows[0];

  if (!video) {
    return null;
  }

  let snippet: SearchSnippet | null = null;

  if (snippetId !== null) {
    const selectedSnippetSql = `
      SELECT
        c.id AS chunk_id,
        c.start_ms,
        c.end_ms,
        c.text
      FROM transcript_chunks c
      WHERE c.video_id = $1 AND c.id = $2
      LIMIT 1
    `;

    const { rows: selectedSnippetRows } = await query<VideoSnippetRow>(selectedSnippetSql, [normalizedVideoId, snippetId]);
    const selectedSnippet = selectedSnippetRows[0];

    if (selectedSnippet) {
      snippet = buildSnippet(normalizedVideoId, selectedSnippet, 0);
    }
  }

  if (!snippet) {
    const fallbackSnippetSql = `
      SELECT
        c.id AS chunk_id,
        c.start_ms,
        c.end_ms,
        c.text
      FROM transcript_chunks c
      WHERE c.video_id = $1
      ORDER BY c.start_ms ASC
      LIMIT 1
    `;

    const { rows: fallbackSnippetRows } = await query<VideoSnippetRow>(fallbackSnippetSql, [normalizedVideoId]);
    const fallbackSnippet = fallbackSnippetRows[0];

    if (fallbackSnippet) {
      snippet = buildSnippet(normalizedVideoId, fallbackSnippet, 0);
    }
  }

  const result: SearchVideoResult = {
    videoId: video.video_id,
    title: video.title,
    publishedAt: video.published_at,
    transcriptWordCount: video.transcript_word_count,
    score: 0,
    snippets: snippet ? [snippet] : [],
    primaryEmbedUrl: snippet?.embedUrl ?? buildEmbedUrl(video.video_id, 0),
  };

  return {
    query: "",
    normalizedQuery: "",
    tookMs: roundDuration(startedAt),
    resultCount: 1,
    results: [result],
  };
}

export async function searchVideos(rawQuery: string, limit = config.searchResultLimit, snippetsPerVideo = config.snippetLimitPerVideo): Promise<SearchResponse> {
  const startedAt = performance.now();
  const cacheKey = buildCacheKey(rawQuery, limit, snippetsPerVideo);
  const versionAtStart = await synchronizeSearchCache();
  const cachedResponse = reuseCachedResponse(cacheKey, startedAt);

  if (cachedResponse) {
    return cachedResponse;
  }

  const sharedSearch = inFlightSearches.get(cacheKey);
  if (sharedSearch) {
    const sharedResponse = await sharedSearch;
    return {
      ...sharedResponse,
      tookMs: roundDuration(startedAt),
    };
  }

  const searchPromise = executeSearch(rawQuery, limit, snippetsPerVideo);
  inFlightSearches.set(cacheKey, searchPromise);

  try {
    const response = await searchPromise;
    const versionAtEnd = await synchronizeSearchCache();

    if (response.normalizedQuery.length >= 2 && versionAtStart === versionAtEnd) {
      rememberCachedResponse(cacheKey, response);
    }

    return {
      ...response,
      tookMs: roundDuration(startedAt),
    };
  } finally {
    inFlightSearches.delete(cacheKey);
  }
}
