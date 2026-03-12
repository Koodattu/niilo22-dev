"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { SearchResponse, SearchSnippet, SearchVideoResult } from "./search-types";

const MATCH_LEAD_SECONDS = 5;
const MATCH_TAIL_SECONDS = 5;
const MIN_PLAYBACK_WINDOW_SECONDS = 10;

function formatTimestamp(startSeconds: number): string {
  const hours = Math.floor(startSeconds / 3600);
  const minutes = Math.floor((startSeconds % 3600) / 60);
  const seconds = startSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fi-FI", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function withPlaybackWindow(videoId: string, snippet: SearchSnippet): string {
  const playbackStartSeconds = Math.max(0, snippet.startSeconds - MATCH_LEAD_SECONDS);
  const playbackEndSeconds = Math.max(playbackStartSeconds + MIN_PLAYBACK_WINDOW_SECONDS, snippet.endSeconds + MATCH_TAIL_SECONDS);
  const url = new URL(`https://www.youtube.com/embed/${videoId}`);

  url.searchParams.set("start", String(playbackStartSeconds));
  url.searchParams.set("end", String(playbackEndSeconds));
  url.searchParams.set("autoplay", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  return url.toString();
}

function getPlaybackWindow(snippet: SearchSnippet): { startSeconds: number; endSeconds: number; durationMs: number } {
  const startSeconds = Math.max(0, snippet.startSeconds - MATCH_LEAD_SECONDS);
  const endSeconds = Math.max(startSeconds + MIN_PLAYBACK_WINDOW_SECONDS, snippet.endSeconds + MATCH_TAIL_SECONDS);

  return {
    startSeconds,
    endSeconds,
    durationMs: (endSeconds - startSeconds) * 1_000,
  };
}

export function SearchExperience() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialAutoplayEnabled = searchParams.get("autoplay") !== "0";

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchVideoResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [tookMs, setTookMs] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeSnippetId, setActiveSnippetId] = useState<number | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(initialAutoplayEnabled);

  const deferredResults = useDeferredValue(results);
  const activeResult = deferredResults.find((result) => result.videoId === activeVideoId) ?? deferredResults[0] ?? null;
  const activeSnippet = activeResult ? (activeResult.snippets.find((snippet) => snippet.chunkId === activeSnippetId) ?? activeResult.snippets[0] ?? null) : null;
  const playbackWindow = useMemo(() => (activeSnippet ? getPlaybackWindow(activeSnippet) : null), [activeSnippet]);

  function replaceSearchParams(nextQuery?: string, nextAutoplayEnabled?: boolean): void {
    const params = new URLSearchParams(searchParams.toString());

    if (nextQuery !== undefined) {
      const trimmedQuery = nextQuery.trim();

      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      } else {
        params.delete("q");
      }
    }

    if (nextAutoplayEnabled !== undefined) {
      params.set("autoplay", nextAutoplayEnabled ? "1" : "0");
    }

    const nextSearch = params.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname);
  }

  function updateAutoplayEnabled(nextAutoplayEnabled: boolean): void {
    setAutoplayEnabled(nextAutoplayEnabled);
    replaceSearchParams(undefined, nextAutoplayEnabled);
  }

  useEffect(() => {
    if (!initialQuery.trim()) {
      return;
    }

    void runSearch(initialQuery, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAutoplayEnabled(initialAutoplayEnabled);
  }, [initialAutoplayEnabled]);

  useEffect(() => {
    if (!autoplayEnabled || !activeResult || !activeSnippet || deferredResults.length === 0 || !playbackWindow) {
      return;
    }

    const currentVideoIndex = deferredResults.findIndex((result) => result.videoId === activeResult.videoId);
    const currentSnippetIndex = activeResult.snippets.findIndex((snippet) => snippet.chunkId === activeSnippet.chunkId);

    if (currentVideoIndex === -1 || currentSnippetIndex === -1) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const nextSnippet = activeResult.snippets[currentSnippetIndex + 1];
      if (nextSnippet) {
        setActiveSnippetId(nextSnippet.chunkId);
        return;
      }

      const nextResult = deferredResults[currentVideoIndex + 1];
      if (nextResult) {
        selectVideo(nextResult);
        return;
      }

      updateAutoplayEnabled(false);
    }, playbackWindow.durationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeResult, activeSnippet, autoplayEnabled, deferredResults, playbackWindow]);

  async function runSearch(nextQuery: string, updateUrl: boolean): Promise<void> {
    if (isLoading) {
      return;
    }

    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      setResultCount(0);
      setTookMs(0);
      setHasSearched(false);
      setError(null);
      updateAutoplayEnabled(false);

      if (updateUrl) {
        replaceSearchParams("", false);
      }

      return;
    }

    if (updateUrl) {
      replaceSearchParams(trimmedQuery, autoplayEnabled);
    }

    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Search request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as SearchResponse;
      startTransition(() => {
        setResults(payload.results);
        setResultCount(payload.resultCount);
        setTookMs(payload.tookMs);
        setActiveVideoId(payload.results[0]?.videoId ?? null);
        setActiveSnippetId(payload.results[0]?.snippets[0]?.chunkId ?? null);
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Search request failed unexpectedly.");
      setResults([]);
      setResultCount(0);
      setTookMs(0);
      setActiveVideoId(null);
      setActiveSnippetId(null);
      updateAutoplayEnabled(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runSearch(query, true);
  }

  function selectVideo(result: SearchVideoResult, snippet?: SearchSnippet): void {
    setActiveVideoId(result.videoId);
    setActiveSnippetId(snippet?.chunkId ?? result.snippets[0]?.chunkId ?? null);
  }

  function handleResultCardKeyDown(event: React.KeyboardEvent<HTMLElement>, result: SearchVideoResult): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    selectVideo(result);
  }

  return (
    <main className="page-shell">
      <section className="workspace-shell">
        <section className="stage-panel">
          <div className="stage-bar stage-bar--top">
            <div className="stage-bar__header">
              <div className="stage-bar__meta">
                <p className="stage-bar__eyebrow stage-bar__eyebrow--inline">{activeResult ? formatDate(activeResult.publishedAt) : "Hakutulokset"}</p>
                {activeResult && activeSnippet ? (
                  <a
                    className="stage-link"
                    href={`https://www.youtube.com/watch?v=${activeResult.videoId}&t=${playbackWindow?.startSeconds ?? activeSnippet.startSeconds}s`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Avaa YouTubessa
                  </a>
                ) : null}
              </div>
              <h1>{activeResult?.title ?? "Valitse haku oikealta"}</h1>
            </div>
          </div>

          <div className="stage-video-shell">
            {activeResult && activeSnippet ? (
              <iframe
                key={`${activeResult.videoId}-${activeSnippet.chunkId}`}
                className="stage-video"
                src={withPlaybackWindow(activeResult.videoId, activeSnippet)}
                title={activeResult.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="stage-empty">
                <h2>Kirjoita oikealle haku.</h2>
              </div>
            )}
          </div>

          <div className="stage-bar stage-bar--bottom">
            <div className="stage-snippets">
              {activeResult?.snippets.map((snippet) => {
                const isActive = snippet.chunkId === activeSnippet?.chunkId;
                return (
                  <button
                    key={snippet.chunkId}
                    type="button"
                    className={`stage-snippet${isActive ? " stage-snippet--active" : ""}`}
                    onClick={() => setActiveSnippetId(snippet.chunkId)}
                  >
                    <span className="stage-snippet__time">{formatTimestamp(snippet.startSeconds)}</span>
                    <span className="stage-snippet__text">{snippet.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="sidebar-panel">
          <form className="search-form" onSubmit={handleSubmit} aria-busy={isLoading}>
            <div className="search-form__row search-form__row--stacked">
              <input
                id="search-query"
                className="search-form__input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="aamukahvi, pyöräily, tuju"
                autoComplete="off"
              />
              <button className="search-form__button" type="submit" disabled={isLoading} aria-label={isLoading ? "Haku käynnissä" : "Hae"}>
                {isLoading ? <span className="search-form__spinner" aria-hidden="true" /> : "Hae"}
              </button>
            </div>
          </form>

          <div className="sidebar-panel__utility-row">
            <div className="playback-controls">
              <button
                className={`autoplay-toggle${autoplayEnabled ? " autoplay-toggle--active" : ""}`}
                type="button"
                onClick={() => updateAutoplayEnabled(!autoplayEnabled)}
                disabled={!activeResult || !activeSnippet || deferredResults.length === 0}
              >
                {autoplayEnabled ? "Autoplay päällä" : "Autoplay pois"}
              </button>
            </div>

            {hasSearched ? (
              <div className="sidebar-panel__stats">
                <span>{`${resultCount} osumaa`}</span>
                <span>{`${tookMs} ms`}</span>
              </div>
            ) : null}
          </div>

          {error ? <p className="status-banner status-banner--error">{error}</p> : null}

          <div className="results-rail-shell">
            <div className="results-rail">
              {deferredResults.map((result) => {
                const isActive = result.videoId === activeResult?.videoId;
                return (
                  <article
                    key={result.videoId}
                    className={`result-rail-card${isActive ? " result-rail-card--active" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    onClick={() => selectVideo(result)}
                    onKeyDown={(event) => handleResultCardKeyDown(event, result)}
                  >
                    <div className="result-rail-card__header">
                      <h3>{result.title}</h3>
                      <p className="result-rail-card__date">{formatDate(result.publishedAt)}</p>
                    </div>

                    <div className="result-rail-card__snippet-list">
                      {result.snippets.slice(0, 3).map((snippet) => (
                        <button
                          key={snippet.chunkId}
                          type="button"
                          className="result-rail-snippet"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectVideo(result, snippet);
                          }}
                        >
                          <span className="result-rail-snippet__time">{formatTimestamp(snippet.startSeconds)}</span>
                          <span className="result-rail-snippet__text">{snippet.text}</span>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}

              {!isLoading && hasSearched && deferredResults.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <h2>Ei osumia.</h2>
                  <p>Kokeile lyhyempää hakua tai eri kirjoitusasua.</p>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
