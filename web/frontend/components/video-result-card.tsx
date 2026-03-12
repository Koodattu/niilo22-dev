"use client";

import { useState } from "react";

import type { SearchVideoResult } from "./search-types";

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
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

export function VideoResultCard({ result }: { result: SearchVideoResult }) {
  const [activeSnippetIndex, setActiveSnippetIndex] = useState(0);
  const activeSnippet = result.snippets[activeSnippetIndex] ?? result.snippets[0];

  return (
    <article className="result-card">
      <div className="result-card__header">
        <div>
          <p className="result-card__eyebrow">{formatDate(result.publishedAt)}</p>
          <h2>{result.title}</h2>
        </div>
        <div className="result-card__meta">
          <span>{result.transcriptWordCount.toLocaleString("fi-FI")} sanaa</span>
          <span>Niilo22</span>
        </div>
      </div>

      <div className="result-card__media">
        <iframe
          key={`${result.videoId}-${activeSnippet.startSeconds}`}
          className="result-card__iframe"
          src={activeSnippet.embedUrl}
          title={result.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      <div className="result-card__snippet-grid">
        {result.snippets.map((snippet, index) => {
          const isActive = index === activeSnippetIndex;
          return (
            <button key={snippet.chunkId} type="button" className={`snippet-chip${isActive ? " snippet-chip--active" : ""}`} onClick={() => setActiveSnippetIndex(index)}>
              <span className="snippet-chip__time">{formatTimestamp(snippet.startSeconds)}</span>
              <span className="snippet-chip__text">{snippet.text}</span>
            </button>
          );
        })}
      </div>

      <div className="result-card__footer">
        <a className="result-card__link" href={`https://www.youtube.com/watch?v=${result.videoId}&t=${activeSnippet.startSeconds}s`} target="_blank" rel="noreferrer">
          Avaa YouTubessa
        </a>
      </div>
    </article>
  );
}
