import type { Metadata } from "next";

type AnalyticsMetricEntry = {
  label: string;
  count: number;
};

type AnalyticsSummary = {
  totalVideos: number;
  totalTranscriptChunks: number;
  totalTranscriptWords: number;
  uniqueWords: number;
  uniqueBigrams: number;
  uniqueTrigrams: number;
  uniqueTrackedQueries: number;
  totalTrackedQueries: number;
  refreshedAt: string;
};

type AnalyticsResponse = {
  summary: AnalyticsSummary;
  queries: AnalyticsMetricEntry[];
  words: AnalyticsMetricEntry[];
  bigrams: AnalyticsMetricEntry[];
  trigrams: AnalyticsMetricEntry[];
};

export const metadata: Metadata = {
  title: "Analytics",
  description: "Aggregated search and transcript analytics for the Niilo22 archive.",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fi-FI").format(value);
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("fi-FI", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function loadAnalytics(): Promise<AnalyticsResponse> {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const response = await fetch(`${backendUrl}/api/analytics?limit=12`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Analytics request failed with status ${response.status}`);
  }

  return (await response.json()) as AnalyticsResponse;
}

function BarList({ items, emptyText }: { items: AnalyticsMetricEntry[]; emptyText: string }) {
  const maxCount = items[0]?.count ?? 0;

  if (items.length === 0) {
    return <p className="analytics-empty">{emptyText}</p>;
  }

  return (
    <div className="analytics-bars" role="list">
      {items.map((item) => {
        const width = maxCount > 0 ? `${Math.max(8, (item.count / maxCount) * 100)}%` : "8%";

        return (
          <div className="analytics-bar-row" role="listitem" key={item.label}>
            <div className="analytics-bar-row__meta">
              <span className="analytics-bar-row__label">{item.label}</span>
              <span className="analytics-bar-row__count">{formatNumber(item.count)}</span>
            </div>
            <div className="analytics-bar-track" aria-hidden="true">
              <span className="analytics-bar-fill" style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="analytics-metric-card">
      <p className="analytics-metric-card__label">{label}</p>
      <strong className="analytics-metric-card__value">{value}</strong>
    </article>
  );
}

export default async function AnalyticsPage() {
  const analytics = await loadAnalytics();

  return (
    <main className="page-shell analytics-page-shell">
      <section className="status-banner analytics-hero">
        <div className="analytics-hero__copy">
          <p className="stage-bar__eyebrow analytics-hero__eyebrow">Archive intelligence</p>
          <h1>Analytics</h1>
          <p className="analytics-hero__text">A lightweight reporting view over tracked user searches and the normalized transcript corpus.</p>
        </div>
        <div className="analytics-hero__actions">
          <a className="stage-link stage-link--share" href="/">
            Back to search
          </a>
          <span className="analytics-hero__stamp">Updated {formatUpdatedAt(analytics.summary.refreshedAt)}</span>
        </div>
      </section>

      <section className="analytics-metrics-grid">
        <MetricCard label="Videos" value={formatNumber(analytics.summary.totalVideos)} />
        <MetricCard label="Transcript chunks" value={formatNumber(analytics.summary.totalTranscriptChunks)} />
        <MetricCard label="Transcript words" value={formatNumber(analytics.summary.totalTranscriptWords)} />
        <MetricCard label="Unique tracked queries" value={formatNumber(analytics.summary.uniqueTrackedQueries)} />
        <MetricCard label="Tracked searches" value={formatNumber(analytics.summary.totalTrackedQueries)} />
        <MetricCard label="Unique words" value={formatNumber(analytics.summary.uniqueWords)} />
        <MetricCard label="Unique bigrams" value={formatNumber(analytics.summary.uniqueBigrams)} />
        <MetricCard label="Unique trigrams" value={formatNumber(analytics.summary.uniqueTrigrams)} />
      </section>

      <section className="analytics-grid">
        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">User behavior</p>
              <h2>Most common queries</h2>
            </div>
            <p className="analytics-card__hint">Normalized queries, aggregated by count</p>
          </div>
          <BarList items={analytics.queries} emptyText="No tracked searches yet." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Corpus</p>
              <h2>Top words</h2>
            </div>
            <p className="analytics-card__hint">From normalized transcript chunks</p>
          </div>
          <BarList items={analytics.words} emptyText="Word analytics are not available yet." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Sequences</p>
              <h2>Top bigrams</h2>
            </div>
            <p className="analytics-card__hint">Two-token phrases by occurrence count</p>
          </div>
          <BarList items={analytics.bigrams} emptyText="Bigram analytics are not available yet." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Sequences</p>
              <h2>Top trigrams</h2>
            </div>
            <p className="analytics-card__hint">Three-token phrases by occurrence count</p>
          </div>
          <BarList items={analytics.trigrams} emptyText="Trigram analytics are not available yet." />
        </article>
      </section>
    </main>
  );
}
