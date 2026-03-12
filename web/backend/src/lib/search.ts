import { performance } from "node:perf_hooks";

import { config } from "../config.js";
import { query } from "../db.js";
import { clipText, normalizeSearchText } from "./normalize.js";
import { readSearchDataVersion } from "./search-data-version.js";

interface TopVideoRow {
  video_id: string;
  match_count: number;
  phrase_count: number;
}

interface ChunkRow {
  chunk_id: number;
  video_id: string;
  title: string;
  published_at: string;
  transcript_word_count: number;
  start_ms: number;
  end_ms: number;
  text: string;
  lexical_score: number;
  phrase_match: number;
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

function buildEmbedUrl(videoId: string, startMs: number): string {
  const startSeconds = Math.max(0, Math.floor(startMs / 1_000));
  return `https://www.youtube.com/embed/${videoId}?start=${startSeconds}&rel=0`;
}

function buildSnippet(videoId: string, row: Pick<ChunkRow, "chunk_id" | "start_ms" | "end_ms" | "text">, score: number): SearchSnippet {
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

// Two-phase search: find top videos by FTS match count, then fetch their matching chunks.
// Uses Finnish Snowball stemmer for morphology-aware full-text search.
// For multi-word queries, uses phrase proximity matching to prefer exact phrase matches.
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

  const wordCount = normalizedQuery.split(" ").length;
  const usePhrase = wordCount >= 2;

  // Phase 1: Find top videos.
  // For multi-word queries, rank by phrase match count first (proximity-aware),
  // then by total word-level match count.
  const topVideosSql = usePhrase
    ? `
      SELECT
        video_id,
        COUNT(*) AS match_count,
        COUNT(*) FILTER (WHERE search_vector @@ phraseto_tsquery('finnish', $1)) AS phrase_count
      FROM transcript_chunks
      WHERE search_vector @@ websearch_to_tsquery('finnish', $1)
      GROUP BY video_id
      ORDER BY phrase_count DESC, match_count DESC
      LIMIT $2
    `
    : `
      SELECT video_id, COUNT(*) AS match_count, 0 AS phrase_count
      FROM transcript_chunks
      WHERE search_vector @@ websearch_to_tsquery('finnish', $1)
      GROUP BY video_id
      ORDER BY match_count DESC
      LIMIT $2
    `;

  const { rows: topVideos } = await query<TopVideoRow>(topVideosSql, [normalizedQuery, limit]);

  if (topVideos.length === 0) {
    return {
      query: rawQuery,
      normalizedQuery,
      tookMs: roundDuration(startedAt),
      resultCount: 0,
      results: [],
    };
  }

  // Phase 2: Get matching chunks for the top videos only.
  // For multi-word queries, chunks matching the phrase query rank above word-only matches.
  const videoIds = topVideos.map((row) => row.video_id);
  const chunksSql = usePhrase
    ? `
      SELECT
        c.id AS chunk_id,
        c.video_id,
        v.title,
        v.published_at,
        v.transcript_word_count,
        c.start_ms,
        c.end_ms,
        c.text,
        ts_rank_cd(c.search_vector, websearch_to_tsquery('finnish', $1))::double precision AS lexical_score,
        CASE WHEN c.search_vector @@ phraseto_tsquery('finnish', $1) THEN 1.0 ELSE 0.0 END AS phrase_match
      FROM transcript_chunks c
      JOIN videos v ON v.youtube_id = c.video_id
      WHERE c.video_id = ANY($2)
        AND c.search_vector @@ websearch_to_tsquery('finnish', $1)
      ORDER BY phrase_match DESC, lexical_score DESC, c.start_ms ASC
    `
    : `
      SELECT
        c.id AS chunk_id,
        c.video_id,
        v.title,
        v.published_at,
        v.transcript_word_count,
        c.start_ms,
        c.end_ms,
        c.text,
        ts_rank_cd(c.search_vector, websearch_to_tsquery('finnish', $1))::double precision AS lexical_score,
        0.0 AS phrase_match
      FROM transcript_chunks c
      JOIN videos v ON v.youtube_id = c.video_id
      WHERE c.video_id = ANY($2)
        AND c.search_vector @@ websearch_to_tsquery('finnish', $1)
      ORDER BY lexical_score DESC, c.start_ms ASC
    `;

  const { rows: chunkRows } = await query<ChunkRow>(chunksSql, [normalizedQuery, videoIds]);

  // Build a lookup for video ranking signals
  const matchCountByVideo = new Map<string, number>();
  const phraseCountByVideo = new Map<string, number>();
  for (const row of topVideos) {
    matchCountByVideo.set(row.video_id, Number(row.match_count));
    phraseCountByVideo.set(row.video_id, Number(row.phrase_count));
  }

  // Group chunks by video and select top snippets per video
  const grouped = new Map<string, SearchVideoResult>();

  for (const row of chunkRows) {
    const phraseMatch = toNumber(row.phrase_match);
    const snippetScore = toNumber(row.lexical_score) + phraseMatch;
    const snippet = buildSnippet(row.video_id, row, snippetScore);

    const existing = grouped.get(row.video_id);
    if (!existing) {
      const videoMatchCount = matchCountByVideo.get(row.video_id) ?? 0;
      const videoPhraseCount = phraseCountByVideo.get(row.video_id) ?? 0;
      grouped.set(row.video_id, {
        videoId: row.video_id,
        title: row.title,
        publishedAt: row.published_at,
        transcriptWordCount: row.transcript_word_count,
        score: videoPhraseCount * 1000 + videoMatchCount,
        snippets: [snippet],
        primaryEmbedUrl: snippet.embedUrl,
      });
      continue;
    }

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
