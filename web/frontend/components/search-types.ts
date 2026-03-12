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
