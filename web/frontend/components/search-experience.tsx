"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { SearchResponse, SearchSnippet, SearchVideoResult } from "./search-types";

const MATCH_LEAD_SECONDS = 3;
const MATCH_TAIL_SECONDS = 6;
const MIN_PLAYBACK_WINDOW_SECONDS = 10;
const SHARE_FEEDBACK_TIMEOUT_MS = 2_000;

type ShareFeedbackState = "idle" | "copied" | "error";

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

function parseSnippetId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);
  return Number.isNaN(parsedValue) ? null : parsedValue;
}

function buildSharedClipHref(pathname: string, videoId: string, snippetId: number | null): string {
  const params = new URLSearchParams();

  params.set("autoplay", "1");
  params.set("result", videoId);

  if (snippetId !== null) {
    params.set("snippet", String(snippetId));
  }

  return `${pathname}?${params.toString()}`;
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }

  const fallbackInput = document.createElement("textarea");
  fallbackInput.value = value;
  fallbackInput.setAttribute("readonly", "true");
  fallbackInput.style.position = "absolute";
  fallbackInput.style.left = "-9999px";

  document.body.appendChild(fallbackInput);
  fallbackInput.select();

  const didCopy = document.execCommand("copy");

  document.body.removeChild(fallbackInput);

  if (!didCopy) {
    throw new Error("Clipboard copy failed.");
  }
}

function withPlaybackWindow(videoId: string, snippet: SearchSnippet, autoplayEnabled: boolean): string {
  const playbackStartSeconds = Math.max(0, snippet.startSeconds - MATCH_LEAD_SECONDS);
  const playbackEndSeconds = Math.max(playbackStartSeconds + MIN_PLAYBACK_WINDOW_SECONDS, snippet.endSeconds + MATCH_TAIL_SECONDS);
  const url = new URL(`https://www.youtube.com/embed/${videoId}`);

  url.searchParams.set("start", String(playbackStartSeconds));
  url.searchParams.set("end", String(playbackEndSeconds));
  url.searchParams.set("autoplay", autoplayEnabled ? "1" : "0");
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get("q") ?? "";
  const initialQuery = currentQuery;
  const initialAutoplayEnabled = searchParams.get("autoplay") !== "0";
  const selectedResultId = searchParams.get("result");
  const selectedSnippetId = parseSnippetId(searchParams.get("snippet"));
  const isSharedView = !currentQuery.trim() && Boolean(selectedResultId);

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
  const [manualAutoplaySelection, setManualAutoplaySelection] = useState<{ videoId: string; snippetId: number | null } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<ShareFeedbackState>("idle");
  const resultCardRefs = useRef(new Map<string, HTMLElement>());
  const shareFeedbackTimeoutRef = useRef<number | null>(null);

  const deferredResults = useDeferredValue(results);
  const activeResult = results.find((result) => result.videoId === activeVideoId) ?? results[0] ?? null;
  const activeSnippet = activeResult ? (activeResult.snippets.find((snippet) => snippet.chunkId === activeSnippetId) ?? activeResult.snippets[0] ?? null) : null;
  const shouldAutoplayActiveSelection =
    autoplayEnabled ||
    (manualAutoplaySelection !== null && manualAutoplaySelection.videoId === activeResult?.videoId && manualAutoplaySelection.snippetId === (activeSnippet?.chunkId ?? null));
  const playbackWindow = useMemo(() => (activeSnippet ? getPlaybackWindow(activeSnippet) : null), [activeSnippet]);
  const sharedClipHref = activeResult ? buildSharedClipHref(pathname, activeResult.videoId, activeSnippet?.chunkId ?? null) : null;

  function replaceSearchParams(nextQuery?: string, nextAutoplayEnabled?: boolean, nextResultId?: string | null, nextSnippetId?: number | null): void {
    if (typeof window === "undefined") {
      return;
    }

    const currentSearch = window.location.search;
    const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);

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

    if (nextResultId !== undefined) {
      if (nextResultId) {
        params.set("result", nextResultId);
      } else {
        params.delete("result");
      }
    }

    if (nextSnippetId !== undefined) {
      if (nextSnippetId !== null) {
        params.set("snippet", String(nextSnippetId));
      } else {
        params.delete("snippet");
      }
    }

    const nextSearch = params.toString();

    if (nextSearch === searchParams.toString()) {
      return;
    }

    const nextUrl = nextSearch ? `${pathname}?${nextSearch}` : pathname;
    window.history.replaceState(null, "", nextUrl);
  }

  function updateAutoplayEnabled(nextAutoplayEnabled: boolean): void {
    setAutoplayEnabled(nextAutoplayEnabled);
    replaceSearchParams(undefined, nextAutoplayEnabled);
  }

  useEffect(() => {
    async function bootstrapFromUrl(): Promise<void> {
      if (selectedResultId) {
        await loadSelectedVideo(selectedResultId, selectedSnippetId, {
          queryToKeep: initialQuery,
          syncUrl: !initialQuery.trim(),
        });
      }

      if (initialQuery.trim()) {
        await runSearch(initialQuery, false, selectedResultId, selectedSnippetId);
      }
    }

    void bootstrapFromUrl();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAutoplayEnabled(initialAutoplayEnabled);
  }, [initialAutoplayEnabled]);

  useEffect(() => {
    setShareFeedback("idle");
  }, [sharedClipHref]);

  useEffect(() => {
    return () => {
      if (shareFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(shareFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeResult) {
      return;
    }

    const activeCard = resultCardRefs.current.get(activeResult.videoId);
    if (!activeCard) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      activeCard.scrollIntoView({
        behavior: autoplayEnabled ? "smooth" : "auto",
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [activeResult, autoplayEnabled]);

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
        selectVideo(activeResult, nextSnippet, { playImmediately: false });
        return;
      }

      const nextResult = deferredResults[currentVideoIndex + 1];
      if (nextResult) {
        selectVideo(nextResult, undefined, { playImmediately: false });
        return;
      }

      updateAutoplayEnabled(false);
    }, playbackWindow.durationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeResult, activeSnippet, autoplayEnabled, deferredResults, playbackWindow]);

  async function runSearch(nextQuery: string, updateUrl: boolean, preferredResultId?: string | null, preferredSnippetId?: number | null): Promise<void> {
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
      setActiveVideoId(null);
      setActiveSnippetId(null);
      setAutoplayEnabled(false);
      setManualAutoplaySelection(null);

      if (updateUrl) {
        replaceSearchParams("", false, null, null);
      }

      return;
    }

    if (updateUrl) {
      replaceSearchParams(trimmedQuery, autoplayEnabled);
    }

    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setManualAutoplaySelection(null);

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
      const nextActiveResult = preferredResultId
        ? (payload.results.find((result) => result.videoId === preferredResultId) ?? payload.results[0] ?? null)
        : (payload.results[0] ?? null);
      const nextActiveSnippet = nextActiveResult
        ? preferredSnippetId !== null && preferredSnippetId !== undefined
          ? (nextActiveResult.snippets.find((snippet) => snippet.chunkId === preferredSnippetId) ?? nextActiveResult.snippets[0] ?? null)
          : (nextActiveResult.snippets[0] ?? null)
        : null;

      startTransition(() => {
        setResults(payload.results);
        setResultCount(payload.resultCount);
        setTookMs(payload.tookMs);
        setActiveVideoId(nextActiveResult?.videoId ?? null);
        setActiveSnippetId(nextActiveSnippet?.chunkId ?? null);
      });

      replaceSearchParams(trimmedQuery, autoplayEnabled, nextActiveResult?.videoId ?? null, nextActiveSnippet?.chunkId ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Search request failed unexpectedly.");
      setResults([]);
      setResultCount(0);
      setTookMs(0);
      setActiveVideoId(null);
      setActiveSnippetId(null);
      setAutoplayEnabled(false);
      setManualAutoplaySelection(null);
      replaceSearchParams(trimmedQuery, false, null, null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSelectedVideo(
    videoId: string,
    preferredSnippetId?: number | null,
    options?: {
      queryToKeep?: string;
      syncUrl?: boolean;
    },
  ): Promise<void> {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setQuery(options?.queryToKeep ?? "");
    setManualAutoplaySelection(null);

    try {
      const endpoint = new URL(`/api/videos/${encodeURIComponent(videoId)}`, window.location.origin);

      if (preferredSnippetId !== null && preferredSnippetId !== undefined) {
        endpoint.searchParams.set("snippet", String(preferredSnippetId));
      }

      const response = await fetch(endpoint.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Shared video request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as SearchResponse;
      const nextActiveResult = payload.results[0] ?? null;
      const nextActiveSnippet = nextActiveResult
        ? preferredSnippetId !== null && preferredSnippetId !== undefined
          ? (nextActiveResult.snippets.find((snippet) => snippet.chunkId === preferredSnippetId) ?? nextActiveResult.snippets[0] ?? null)
          : (nextActiveResult.snippets[0] ?? null)
        : null;

      startTransition(() => {
        setResults(payload.results);
        setResultCount(payload.resultCount);
        setTookMs(payload.tookMs);
        setActiveVideoId(nextActiveResult?.videoId ?? null);
        setActiveSnippetId(nextActiveSnippet?.chunkId ?? null);
      });

      if (options?.syncUrl ?? true) {
        replaceSearchParams(options?.queryToKeep ?? "", true, nextActiveResult?.videoId ?? null, nextActiveSnippet?.chunkId ?? null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Shared video request failed unexpectedly.");
      setResults([]);
      setResultCount(0);
      setTookMs(0);
      setActiveVideoId(null);
      setActiveSnippetId(null);
      setAutoplayEnabled(false);
      setManualAutoplaySelection(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runSearch(query, true);
  }

  function selectVideo(result: SearchVideoResult, snippet?: SearchSnippet, options?: { playImmediately?: boolean }): void {
    const nextSnippetId = snippet?.chunkId ?? result.snippets[0]?.chunkId ?? null;
    const shouldPlayImmediately = options?.playImmediately ?? true;

    setManualAutoplaySelection(shouldPlayImmediately ? { videoId: result.videoId, snippetId: nextSnippetId } : null);

    setActiveVideoId(result.videoId);
    setActiveSnippetId(nextSnippetId);
    replaceSearchParams(undefined, undefined, result.videoId, nextSnippetId);
  }

  function handleResultCardKeyDown(event: React.KeyboardEvent<HTMLElement>, result: SearchVideoResult): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    selectVideo(result);
  }

  function setResultCardRef(videoId: string, node: HTMLElement | null): void {
    if (node) {
      resultCardRefs.current.set(videoId, node);
      return;
    }

    resultCardRefs.current.delete(videoId);
  }

  function queueShareFeedbackReset(): void {
    if (shareFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(shareFeedbackTimeoutRef.current);
    }

    shareFeedbackTimeoutRef.current = window.setTimeout(() => {
      setShareFeedback("idle");
      shareFeedbackTimeoutRef.current = null;
    }, SHARE_FEEDBACK_TIMEOUT_MS);
  }

  async function handleShareCopy(): Promise<void> {
    if (!sharedClipHref || typeof window === "undefined") {
      return;
    }

    try {
      const shareUrl = new URL(sharedClipHref, window.location.origin).toString();
      await copyTextToClipboard(shareUrl);
      setShareFeedback("copied");
    } catch {
      setShareFeedback("error");
    }

    queueShareFeedbackReset();
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
                  <div className="stage-bar__actions">
                    <a
                      className="stage-link"
                      href={`https://www.youtube.com/watch?v=${activeResult.videoId}&t=${playbackWindow?.startSeconds ?? activeSnippet.startSeconds}s`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Avaa YouTubessa
                    </a>
                    {sharedClipHref ? (
                      <button
                        className={`stage-link stage-link--share${shareFeedback !== "idle" ? ` stage-link--share-${shareFeedback}` : ""}`}
                        type="button"
                        onClick={() => void handleShareCopy()}
                        aria-live="polite"
                      >
                        {shareFeedback === "copied" ? "Linkki kopioitu" : shareFeedback === "error" ? "Kopiointi ei onnistunut" : "Jaa tämä luikautus"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <h1>{activeResult?.title ?? (isSharedView ? "Jaettua luikautusta ei löytynyt" : "Valitse haku oikealta")}</h1>
            </div>
          </div>

          <div className="stage-video-shell">
            {activeResult && activeSnippet ? (
              <iframe
                key={`${activeResult.videoId}-${activeSnippet.chunkId}`}
                className="stage-video"
                src={withPlaybackWindow(activeResult.videoId, activeSnippet, shouldAutoplayActiveSelection)}
                title={activeResult.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="stage-empty">
                <h2>{isSharedView ? "Jaettua luikautusta ei voitu avata." : "Kirjoita oikealle haku."}</h2>
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
                    onClick={() => selectVideo(activeResult, snippet)}
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
                <span>{`${resultCount} videoust`}</span>
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
                    ref={(node) => setResultCardRef(result.videoId, node)}
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
