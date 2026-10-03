"use client";

import { useEffect, useMemo, useState } from "react";

interface Word { word: string; startMs: number; endMs: number }

function makeCues(words: Word[]): Word[][] {
  const cues: Word[][] = [];
  let cue: Word[] = [];
  let length = 0;
  for (const word of words) {
    const previous = cue.at(-1);
    if (previous && (cue.length >= 7 || length + word.word.length > 56 || word.startMs - previous.endMs > 700)) {
      cues.push(cue);
      cue = [];
      length = 0;
    }
    cue.push(word);
    length += word.word.length + 1;
    if (/[.!?…]$/.test(word.word)) {
      cues.push(cue);
      cue = [];
      length = 0;
    }
  }
  if (cue.length) cues.push(cue);
  return cues;
}

export function VideoSubtitles({ videoId, timeSeconds, hidden }: { videoId: string; timeSeconds: number; hidden: boolean }) {
  const [words, setWords] = useState<Word[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const bucket = Math.floor(timeSeconds / 30);

  useEffect(() => {
    const controller = new AbortController();
    const start = Math.max(0, bucket * 30 - 10);
    const end = Math.min(2_147_483, bucket * 30 + 60);
    setFailed(false);
    void fetch(`/api/videos/${encodeURIComponent(videoId)}/transcript?start=${start}&end=${end}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      headers: { Accept: "application/json" },
    }).then(async response => {
      if (!response.ok) throw new Error("Transcript unavailable");
      const payload = await response.json() as { words: Word[] };
      if (!controller.signal.aborted) setWords(payload.words);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [videoId, bucket, retry]);

  const cues = useMemo(() => makeCues(words), [words]);
  const timeMs = timeSeconds * 1000;
  const cue = cues.find((words, index) => timeMs >= words[0].startMs
    && timeMs < Math.min(words.at(-1)!.endMs + 200, cues[index + 1]?.[0].startMs ?? Infinity));
  const spokenIndex = cue?.findLastIndex(word => timeMs >= word.startMs && timeMs < word.endMs);

  return (
    <div className="video-subtitle" aria-label="Videon tekstitys" hidden={hidden}>
      {cue ? <p>{cue.map((word, index) => (
        <span key={`${word.startMs}-${index}`} className={index === spokenIndex ? "video-subtitle__word--spoken" : undefined}>{word.word}{index < cue.length - 1 ? " " : ""}</span>
      ))}</p> : failed ? (
        <p className="video-subtitle__error">Tekstitystä ei voitu ladata. <button type="button" onClick={() => setRetry(value => value + 1)}>Yritä uudelleen</button></p>
      ) : null}
    </div>
  );
}
