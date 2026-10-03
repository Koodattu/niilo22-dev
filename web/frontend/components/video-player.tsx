"use client";

import { useEffect, useRef, useState } from "react";
import { VideoSubtitles } from "./video-subtitles";

interface Player {
  destroy(): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
}

interface YouTubeApi {
  Player: new (frame: HTMLIFrameElement, options: {
    events: { onReady(): void; onStateChange(event: { data: number }): void; onError(): void; onAutoplayBlocked(): void };
  }) => Player;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement("script");
    const previousReady = window.onYouTubeIframeAPIReady;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previousReady;
    };
    const fail = () => {
      cleanup();
      script.remove();
      apiPromise = null;
      reject(new Error("Video player is unavailable"));
    };
    const timeout = window.setTimeout(fail, 10_000);
    window.onYouTubeIframeAPIReady = () => {
      cleanup();
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail();
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return apiPromise;
}

// Own the provider's DOM in one place; React owns only the surrounding host.
export function VideoPlayer({ src, title, videoId, autoplay, endSeconds, subtitles, onTimeUpdate, onEnded, onUnavailable }: {
  src: string; title: string; videoId: string; autoplay: boolean; endSeconds: number | null; subtitles: boolean;
  onTimeUpdate(timeSeconds: number): void; onEnded(): void; onUnavailable(): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const completedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [timeSeconds, setTimeSeconds] = useState(() => Number(new URL(src).searchParams.get("start") ?? 0));
  const callbacks = useRef({ onTimeUpdate, onEnded, onUnavailable, endSeconds });
  const autoplayRef = useRef(autoplay);
  useEffect(() => { autoplayRef.current = autoplay; }, [autoplay]);
  useEffect(() => { completedRef.current = false; }, [autoplay, endSeconds]);
  useEffect(() => { callbacks.current = { onTimeUpdate, onEnded, onUnavailable, endSeconds }; }, [onTimeUpdate, onEnded, onUnavailable, endSeconds]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let playerReady = false;
    let interval: number | undefined;
    const unavailable = () => {
      if (disposed) return;
      window.clearTimeout(readyTimeout);
      window.clearInterval(interval);
      playerReady = false;
      setLoading(false);
      setReady(false);
      callbacks.current.onUnavailable();
    };
    const readyTimeout = window.setTimeout(unavailable, 15_000);
    const finish = () => {
      if (disposed || completedRef.current) return;
      completedRef.current = true;
      callbacks.current.onEnded();
    };
    const sample = () => {
      const player = playerRef.current;
      if (disposed || !player || !playerReady) return;
      const state = player.getPlayerState();
      if (state === -1 || state === 5) return;
      const time = player.getCurrentTime();
      if (!Number.isFinite(time) || time < 0) return;
      setTimeSeconds(time);
      callbacks.current.onTimeUpdate(time);
      const end = callbacks.current.endSeconds;
      if (end !== null && time < end - 0.25) completedRef.current = false;
      if (state === 1 && end !== null && time >= end && !completedRef.current) {
        player.pauseVideo();
        finish();
      }
    };
    const frame = document.createElement("iframe");
    const url = new URL(src);
    url.searchParams.set("autoplay", autoplayRef.current ? "1" : "0");
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", window.location.origin);
    frame.src = url.toString();
    frame.className = "stage-video";
    frame.title = title;
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    frame.allowFullscreen = true;
    host.appendChild(frame);
    void loadYouTubeApi().then((api) => {
      if (disposed) return;
      playerRef.current = new api.Player(frame, {
        events: {
          onReady() {
            if (disposed) return;
            window.clearTimeout(readyTimeout);
            playerReady = true;
            setReady(true);
            setLoading(false);
            interval = window.setInterval(sample, 100);
          },
          onStateChange(event) {
            if (disposed) return;
            setLoading(event.data === 3 || event.data === -1);
            if (event.data === 0 && playerReady) finish();
            else sample();
          },
          onError: unavailable,
          onAutoplayBlocked() { if (!disposed) setLoading(false); },
        },
      });
    }).catch(unavailable);
    return () => {
      disposed = true;
      window.clearTimeout(readyTimeout);
      window.clearInterval(interval);
      playerRef.current?.destroy();
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [src, title]);

  useEffect(() => { if (autoplay && ready) playerRef.current?.playVideo(); }, [autoplay, ready]);
  return (
    <div className="video-player">
      <div className="stage-video-host" ref={hostRef} />
      <div className="video-player__footer">
        {loading ? <p className="video-loading" role="status"><span className="video-loading__spinner" aria-hidden="true" />Ladataan videota…</p> : null}
        {subtitles && ready ? <VideoSubtitles videoId={videoId} timeSeconds={timeSeconds} hidden={loading} /> : null}
      </div>
    </div>
  );
}
