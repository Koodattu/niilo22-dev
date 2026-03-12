import type { Metadata } from "next";

type SearchParamValue = string | string[] | undefined;

interface ShareSnippet {
  chunkId: number | string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface ShareVideoResult {
  videoId: string;
  title: string;
  publishedAt: string;
  snippets: ShareSnippet[];
}

interface SearchResponseLike {
  results: ShareVideoResult[];
}

export interface SearchParams {
  [key: string]: SearchParamValue;
}

export interface PreviewCardData {
  title: string;
  description: string;
  urlPath: string;
  imagePath: string;
  imageAlt: string;
  kicker: string;
  snippetText: string;
  videoId?: string;
}

export const SITE_NAME = "Niilo22 Search";
export const DEFAULT_DESCRIPTION = "Search Niilo22 videos by transcript, phrases, and fuzzy matches.";
export const DEFAULT_OG_IMAGE_PATH = "/api/og";
export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

const DEFAULT_SITE_URL = "http://localhost:3000";
const DEFAULT_BACKEND_URL = "http://localhost:4000";

function parseAbsoluteUrl(value: string | undefined): URL | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  try {
    return new URL(normalizedValue.startsWith("http") ? normalizedValue : `https://${normalizedValue}`);
  } catch {
    return null;
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalizedValue = collapseWhitespace(value);

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatTimestamp(startSeconds: number): string {
  const hours = Math.floor(startSeconds / 3600);
  const minutes = Math.floor((startSeconds % 3600) / 60);
  const seconds = startSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatPublishedLabel(value: string): string {
  try {
    return new Intl.DateTimeFormat("fi-FI", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function normalizeChunkId(value: number | string): string {
  return String(value);
}

function getBackendBaseUrl(): URL {
  const configuredUrl = parseAbsoluteUrl(process.env.BACKEND_URL);
  return configuredUrl ?? new URL(DEFAULT_BACKEND_URL);
}

export function getSiteUrl(): URL {
  const configuredUrl =
    parseAbsoluteUrl(process.env.SITE_URL) ??
    parseAbsoluteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    parseAbsoluteUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    parseAbsoluteUrl(process.env.VERCEL_URL);

  return configuredUrl ?? new URL(DEFAULT_SITE_URL);
}

export function getSearchParamValue(value: SearchParamValue): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

export function getDefaultPreviewData(): PreviewCardData {
  return {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    urlPath: "/",
    imagePath: DEFAULT_OG_IMAGE_PATH,
    imageAlt: "Niilo22 Search preview image",
    kicker: "Transcript search",
    snippetText: "Search Niilo22 videos by transcript, phrases, and fuzzy matches.",
  };
}

export function getQueryPreviewData(rawQuery: string): PreviewCardData {
  const query = truncateText(rawQuery, 80);
  const urlParams = new URLSearchParams();

  urlParams.set("q", query);

  return {
    title: `Haku: ${query}`,
    description: `Etsi Niilo22-videoista hakusanalla \"${query}\".`,
    urlPath: `/?${urlParams.toString()}`,
    imagePath: `${DEFAULT_OG_IMAGE_PATH}?${urlParams.toString()}`,
    imageAlt: `Niilo22 Search results preview for ${query}`,
    kicker: "Search preview",
    snippetText: `Hakusana: ${query}`,
  };
}

export async function getSharedVideoPreviewData(videoId: string, snippetId?: string): Promise<PreviewCardData | null> {
  const endpoint = new URL(`/api/videos/${encodeURIComponent(videoId)}`, getBackendBaseUrl());

  if (snippetId) {
    endpoint.searchParams.set("snippet", snippetId);
  }

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as SearchResponseLike;
  const result = payload.results[0];

  if (!result) {
    return null;
  }

  const selectedSnippet = snippetId
    ? (result.snippets.find((snippet) => normalizeChunkId(snippet.chunkId) === snippetId) ?? result.snippets[0] ?? null)
    : (result.snippets[0] ?? null);
  const selectedSnippetId = selectedSnippet ? normalizeChunkId(selectedSnippet.chunkId) : undefined;
  const shareParams = new URLSearchParams();
  const imageParams = new URLSearchParams();

  shareParams.set("autoplay", "1");
  shareParams.set("result", result.videoId);
  imageParams.set("result", result.videoId);

  if (selectedSnippetId) {
    shareParams.set("snippet", selectedSnippetId);
    imageParams.set("snippet", selectedSnippetId);
  }

  const publishedLabel = formatPublishedLabel(result.publishedAt);
  const timestampLabel = selectedSnippet ? formatTimestamp(selectedSnippet.startSeconds) : "Katso osuma";
  const title = selectedSnippet ? `${result.title} @ ${timestampLabel}` : result.title;
  const description = selectedSnippet
    ? truncateText(`${selectedSnippet.text} Julkaistu ${publishedLabel}.`, 200)
    : truncateText(`Katso videon \"${result.title}\" osumat Niilo22 Searchissa. Julkaistu ${publishedLabel}.`, 200);

  return {
    title,
    description,
    urlPath: `/?${shareParams.toString()}`,
    imagePath: `${DEFAULT_OG_IMAGE_PATH}?${imageParams.toString()}`,
    imageAlt: `${result.title} preview image`,
    kicker: `${publishedLabel} · ${timestampLabel}`,
    snippetText: truncateText(selectedSnippet?.text ?? result.title, 180),
    videoId: result.videoId,
  };
}

export function createPreviewMetadata(preview: PreviewCardData): Metadata {
  return {
    title: preview.title,
    description: preview.description,
    alternates: {
      canonical: preview.urlPath,
    },
    openGraph: {
      title: preview.title,
      description: preview.description,
      url: preview.urlPath,
      siteName: SITE_NAME,
      locale: "fi_FI",
      type: "website",
      images: [
        {
          url: preview.imagePath,
          width: OG_IMAGE_SIZE.width,
          height: OG_IMAGE_SIZE.height,
          alt: preview.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: preview.title,
      description: preview.description,
      images: [preview.imagePath],
    },
  };
}
