"use client";

import { useEffect, useRef } from "react";

interface Player {
  destroy(): void;
  playVideo(): void;
}

interface YouTubeApi {
  Player: new (frame: HTMLIFrameElement, options: {
    events: { onReady(): void; onStateChange(event: { data: number }): void; onError(): void };
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
export function VideoPlayer({ src, title, autoplay, onEnded, onUnavailable }: {
  src: string; title: string; autoplay: boolean; onEnded(): void; onUnavailable(): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const callbacks = useRef({ onEnded, onUnavailable });
  const autoplayRef = useRef(autoplay);
  useEffect(() => { autoplayRef.current = autoplay; }, [autoplay]);
  useEffect(() => { callbacks.current = { onEnded, onUnavailable }; }, [onEnded, onUnavailable]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
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
          onReady() { if (autoplayRef.current) playerRef.current?.playVideo(); },
          onStateChange(event) { if (!disposed && event.data === 0) callbacks.current.onEnded(); },
          onError() { if (!disposed) callbacks.current.onUnavailable(); },
        },
      });
    }).catch(() => { if (!disposed) callbacks.current.onUnavailable(); });
    return () => {
      disposed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [src, title]);

  useEffect(() => { if (autoplay) playerRef.current?.playVideo(); }, [autoplay]);
  return <div className="stage-video-host" ref={hostRef} />;
}
