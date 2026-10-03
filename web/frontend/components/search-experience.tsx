"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { SearchResponse, SearchSnippet, SearchVideoResult } from "./search-types";
import { VideoPlayer } from "./video-player";

const MATCH_LEAD_SECONDS = 3;
const MATCH_TAIL_SECONDS = 6;
const MIN_PLAYBACK_WINDOW_SECONDS = 10;
const SHARE_FEEDBACK_TIMEOUT_MS = 2_000;

type SearchSelection = { query: string; videoId?: string | null; snippetId?: string | null; timestamp?: string | null };

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

function parseSnippetId(value: string | null): string | null {
  return value && /^[1-9]\d{0,18}$/.test(value) ? value : null;
}

function buildSharedClipHref(pathname: string, videoId: string, snippet: SearchSnippet | null): string {
  const params = new URLSearchParams();

  params.set("autoplay", "1");
  params.set("result", videoId);

  if (snippet) {
    params.set("snippet", snippet.chunkId);
    params.set("t", String(snippet.startMs / 1_000));
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

function withPlaybackWindow(videoId: string, snippet: SearchSnippet): string {
  const { startSeconds, endSeconds } = getPlaybackWindow(snippet);
  const url = new URL(`https://www.youtube.com/embed/${videoId}`);

  url.searchParams.set("start", String(startSeconds));
  url.searchParams.set("end", String(endSeconds));
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  return url.toString();
}

function getPlaybackWindow(snippet: SearchSnippet): { startSeconds: number; endSeconds: number } {
  const startSeconds = Math.max(0, snippet.startSeconds - MATCH_LEAD_SECONDS);
  const endSeconds = Math.max(startSeconds + MIN_PLAYBACK_WINDOW_SECONDS, snippet.endSeconds + MATCH_TAIL_SECONDS);

  return {
    startSeconds,
    endSeconds,
  };
}

export function SearchExperience() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get("q") ?? "";
  const initialAutoplayEnabled = searchParams.get("autoplay") !== "0";
  const selectedResultId = searchParams.get("result");
  const isSharedView = !currentQuery.trim() && Boolean(selectedResultId);

  const [query, setQuery] = useState(currentQuery);
  const [results, setResults] = useState<SearchVideoResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [tookMs, setTookMs] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(initialAutoplayEnabled);
  const [manualAutoplaySelection, setManualAutoplaySelection] = useState<{ videoId: string; snippetId: string | null } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<ShareFeedbackState>("idle");
  const [playerUnavailable, setPlayerUnavailable] = useState(false);
  const resultCardRefs = useRef(new Map<string, HTMLElement>());
  const requestRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<SearchSelection | null>(null);
  const shareFeedbackTimeoutRef = useRef<number | null>(null);

  const activeResult = results.find((result) => result.videoId === activeVideoId) ?? results[0] ?? null;
  const activeSnippet = activeResult ? (activeResult.snippets.find((snippet) => snippet.chunkId === activeSnippetId) ?? activeResult.snippets[0] ?? null) : null;
  const shouldAutoplayActiveSelection =
    autoplayEnabled ||
    (manualAutoplaySelection !== null && manualAutoplaySelection.videoId === activeResult?.videoId && manualAutoplaySelection.snippetId === (activeSnippet?.chunkId ?? null));
  const playbackWindow = useMemo(() => (activeSnippet ? getPlaybackWindow(activeSnippet) : null), [activeSnippet]);
  const sharedClipHref = activeResult ? buildSharedClipHref(pathname, activeResult.videoId, activeSnippet) : null;

  function replaceSearchParams(nextQuery?: string, nextAutoplayEnabled?: boolean, nextResultId?: string | null, nextSnippetId?: string | null, push = false): void {
    if (typeof window === "undefined") {
      return;
    }

    const currentSearch = window.location.search;
    const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);

    if (nextQuery !== undefined) {
      const trimmedQuery = nextQuery.trim();
      params.delete("t");

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
    if (push) window.history.pushState(null, "", nextUrl);
    else window.history.replaceState(null, "", nextUrl);
  }

  function updateAutoplayEnabled(nextAutoplayEnabled: boolean): void {
    setAutoplayEnabled(nextAutoplayEnabled);
    replaceSearchParams(undefined, nextAutoplayEnabled);
  }

  useEffect(() => {
    function restoreFromUrl(): void {
      const params = new URLSearchParams(window.location.search);
      const restoredQuery = params.get("q") ?? "";
      setQuery(restoredQuery);
      setAutoplayEnabled(params.get("autoplay") !== "0");
      void loadResults({ query: restoredQuery, videoId: params.get("result"), snippetId: parseSnippetId(params.get("snippet")), timestamp: params.get("t") });
    }
    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);
    return () => {
      window.removeEventListener("popstate", restoreFromUrl);
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setAutoplayEnabled(initialAutoplayEnabled);
  }, [initialAutoplayEnabled]);

  useEffect(() => {
    setShareFeedback("idle");
    setPlayerUnavailable(false);
  }, [sharedClipHref]);

  useEffect(() => {
    return () => {
      if (shareFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(shareFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeResult || window.matchMedia("(max-width: 1180px)").matches) {
      return;
    }

    const activeCard = resultCardRefs.current.get(activeResult.videoId);
    if (!activeCard) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      activeCard.scrollIntoView({
        behavior: autoplayEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [activeResult, autoplayEnabled]);

  function advancePlayback(): void {
    if (!autoplayEnabled || !activeResult || !activeSnippet || results.length === 0 || !playbackWindow) {
      return;
    }

    const currentVideoIndex = results.findIndex((result) => result.videoId === activeResult.videoId);
    const currentSnippetIndex = activeResult.snippets.findIndex((snippet) => snippet.chunkId === activeSnippet.chunkId);

    if (currentVideoIndex === -1 || currentSnippetIndex === -1) {
      return;
    }

    const nextSnippet = activeResult.snippets[currentSnippetIndex + 1];
    if (nextSnippet) {
      selectVideo(activeResult, nextSnippet, { playImmediately: false });
      return;
    }
    const nextResult = results[currentVideoIndex + 1];
    if (nextResult) {
      selectVideo(nextResult, undefined, { playImmediately: false });
      return;
    }
    updateAutoplayEnabled(false);
  }

  async function loadResults(selection: SearchSelection): Promise<void> {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    lastRequestRef.current = selection;
    const trimmedQuery = selection.query.trim();
    const shared = !trimmedQuery && Boolean(selection.videoId);
    setError(null);
    setResults([]);
    setResultCount(0);
    setTookMs(0);
    setActiveVideoId(null);
    setActiveSnippetId(null);
    setManualAutoplaySelection(null);
    setHasSearched(Boolean(trimmedQuery || shared));
    setIsLoading(false);
    if (!trimmedQuery && !shared) return;
    if (trimmedQuery && trimmedQuery.replace(/[^\p{L}\p{N}]/gu, "").length < 2) {
      setError("Kirjoita vähintään kaksi kirjainta tai numeroa.");
      return;
    }
    setIsLoading(true);
    const endpoint = shared
      ? new URL(`/api/videos/${encodeURIComponent(selection.videoId!)}`, window.location.origin)
      : new URL("/api/search", window.location.origin);
    if (shared) {
      if (selection.snippetId) endpoint.searchParams.set("snippet", selection.snippetId);
      if (selection.timestamp != null) endpoint.searchParams.set("t", selection.timestamp);
    } else endpoint.searchParams.set("q", trimmedQuery);

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) {
        setError(shared && response.status === 404
          ? "Jaettua luikautusta ei löytynyt. Voit tehdä uuden haun."
          : shared ? "Jaetun luikautuksen lataus ei onnistunut. Yritä uudelleen."
          : response.status === 400 ? "Tarkista haku: kirjoita 2–200 merkkiä."
          : "Haku ei onnistunut. Tarkista verkkoyhteys ja yritä uudelleen.");
        return;
      }
      const payload = (await response.json()) as SearchResponse;
      if (controller.signal.aborted) return;
      const nextResult = payload.results.find((result) => result.videoId === selection.videoId) ?? payload.results[0] ?? null;
      const nextSnippet = nextResult?.snippets.find((snippet) => snippet.chunkId === selection.snippetId)
        ?? nextResult?.snippets.find((snippet) => selection.timestamp != null && snippet.startMs === Number(selection.timestamp) * 1_000)
        ?? nextResult?.snippets[0] ?? null;
      setResults(payload.results);
      setResultCount(payload.resultCount);
      setTookMs(payload.tookMs);
      setActiveVideoId(nextResult?.videoId ?? null);
      setActiveSnippetId(nextSnippet?.chunkId ?? null);
      if (!shared) replaceSearchParams(trimmedQuery, undefined, nextResult?.videoId ?? null, nextSnippet?.chunkId ?? null);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(requestError instanceof Error && requestError.name === "TimeoutError"
        ? "Haku kesti liian kauan. Yritä uudelleen."
        : "Haku ei onnistunut. Tarkista verkkoyhteys ja yritä uudelleen.");
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    replaceSearchParams(query, autoplayEnabled, null, null, true);
    await loadResults({ query });
  }

  function selectVideo(result: SearchVideoResult, snippet?: SearchSnippet, options?: { playImmediately?: boolean }): void {
    const nextSnippetId = snippet?.chunkId ?? result.snippets[0]?.chunkId ?? null;
    const shouldPlayImmediately = options?.playImmediately ?? true;

    setManualAutoplaySelection(shouldPlayImmediately ? { videoId: result.videoId, snippetId: nextSnippetId } : null);

    setActiveVideoId(result.videoId);
    setActiveSnippetId(nextSnippetId);
    replaceSearchParams(undefined, undefined, result.videoId, nextSnippetId);
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
        <section className="search-controls">
          <form className="search-form" role="search" onSubmit={handleSubmit} aria-busy={isLoading}>
            <label className="search-form__label" htmlFor="search-query">Etsi videoiden puheesta</label>
            <div className="search-form__row search-form__row--stacked">
              <input
                id="search-query"
                className="search-form__input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="aamukahvi, pyöräily, tuju"
                autoComplete="off"
                maxLength={200}
                enterKeyHint="search"
                aria-describedby="search-hint"
              />
              <button className="search-form__button" type="submit" aria-label="Hae">
                {isLoading ? <span className="search-form__spinner" aria-hidden="true" /> : "Hae"}
              </button>
            </div>
            <p className="search-form__hint" id="search-hint">Kirjoita sana tai lause ja valitse osuman aikaleima.</p>
          </form>

          <div className="sidebar-panel__utility-row">
            <div className="playback-controls">
              <button
                className={`autoplay-toggle${autoplayEnabled ? " autoplay-toggle--active" : ""}`}
                type="button"
                onClick={() => updateAutoplayEnabled(!autoplayEnabled)}
                aria-pressed={autoplayEnabled}
                disabled={!activeResult || !activeSnippet || results.length === 0}
              >
                {autoplayEnabled ? "Autoplay päällä" : "Autoplay pois"}
              </button>
            </div>
            <a className="utility-link" href="/analytics">Arkiston tilastot</a>

            {hasSearched && !isLoading && !error ? (
              <div className="sidebar-panel__stats" role="status">
                <span>{`${resultCount} videoust`}</span>
                <span>{`${tookMs} ms`}</span>
              </div>
            ) : null}
          </div>

          {isLoading ? <p className="status-banner" role="status">{isSharedView ? "Ladataan jaettua luikautusta…" : "Haetaan osumia…"}</p> : null}
          {error ? <div className="status-banner status-banner--error" role="alert"><p>{error}</p><button type="button" className="retry-button" onClick={() => lastRequestRef.current && void loadResults(lastRequestRef.current)}>Yritä uudelleen</button></div> : null}

        </section>

        <section className="stage-panel">
          <div className="stage-bar stage-bar--top">
            <div className="stage-bar__header">
              <div className="stage-bar__meta">
                <p className="stage-bar__eyebrow stage-bar__eyebrow--inline">{activeResult ? formatDate(activeResult.publishedAt) : "Hakutulokset"}</p>
                {activeResult ? (
                  <div className="stage-bar__actions">
                    <a
                      className="stage-link"
                      href={`https://www.youtube.com/watch?v=${activeResult.videoId}&t=${playbackWindow?.startSeconds ?? 0}s`}
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
              <h1>{activeResult?.title ?? (isLoading ? "Ladataan…" : "Niilo22 Search")}</h1>
            </div>
          </div>

          <div className="stage-video-shell">
            {activeResult ? (
              <VideoPlayer
                key={`${activeResult.videoId}-${activeSnippet?.chunkId ?? "full"}`}
                src={activeSnippet ? withPlaybackWindow(activeResult.videoId, activeSnippet) : activeResult.primaryEmbedUrl}
                title={activeResult.title}
                autoplay={shouldAutoplayActiveSelection}
                onEnded={advancePlayback}
                onUnavailable={() => setPlayerUnavailable(true)}
              />
            ) : (
              <div className="stage-empty">
                <div><h2>{isLoading ? "Etsitään luikautusta…" : error ? "Kokeillaan uudelleen." : "Löydä tuttu luikautus."}</h2><p>Hae videoiden puheesta ja avaa oikea hetki.</p></div>
              </div>
            )}
          </div>

          <div className="stage-bar stage-bar--bottom">
            {activeResult && !activeSnippet ? <p className="status-banner">Videolle ei ole puhetekstiosumia. Voit katsoa koko videon.</p> : null}
            {playerUnavailable ? <p className="status-banner" role="status">Videota ei voitu toistaa tässä. Kokeile Avaa YouTubessa -linkkiä.</p> : null}
            <div className="stage-snippets">
              {activeResult?.snippets.map((snippet) => {
                const isActive = snippet.chunkId === activeSnippet?.chunkId;
                return (
                  <button
                    key={snippet.chunkId}
                    type="button"
                    className={`stage-snippet${isActive ? " stage-snippet--active" : ""}`}
                    aria-pressed={isActive}
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

        <aside className="sidebar-panel" aria-label="Hakutulokset">
          <div className="results-rail-shell">
            <div className="results-rail">
              {results.map((result) => {
                const isActive = result.videoId === activeResult?.videoId;
                return (
                  <article
                    key={result.videoId}
                    ref={(node) => setResultCardRef(result.videoId, node)}
                    className={`result-rail-card${isActive ? " result-rail-card--active" : ""}`}
                  >
                    <div className="result-rail-card__header">
                      <h3><button type="button" className="result-rail-card__select" aria-pressed={isActive} onClick={() => selectVideo(result)}>{result.title}</button></h3>
                      <p className="result-rail-card__date">{formatDate(result.publishedAt)}</p>
                    </div>

                    <div className="result-rail-card__snippet-list">
                      {result.snippets.map((snippet) => (
                        <button
                          key={snippet.chunkId}
                          type="button"
                          className="result-rail-snippet"
                          aria-pressed={isActive && snippet.chunkId === activeSnippet?.chunkId}
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

              {!isLoading && !error && hasSearched && results.length === 0 ? (
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
