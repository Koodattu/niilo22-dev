import type { Metadata } from "next";

type AnalyticsMetricEntry = {
  key?: string;
  label: string;
  count: number;
};

type AnalyticsVideoEntry = {
  videoId: string;
  title: string;
  wordCount: number;
};

type AnalyticsYearEntry = {
  year: number;
  videoCount: number;
  wordCount: number;
  transcriptHours: number;
};

type AnalyticsSummary = {
  totalVideos: number;
  totalTranscriptChunks: number;
  totalTranscriptWords: number;
  readyVideos: number;
  ambientVideos: number;
  missingVideos: number;
  transcriptCoveragePercent: number;
  approximateTranscriptHours: number;
  averageWordsPerTranscribedVideo: number;
  medianWordsPerTranscribedVideo: number;
  p90WordsPerTranscribedVideo: number;
  uniqueWords: number;
  uniqueBigrams: number;
  uniqueTrigrams: number;
  uniqueTrackedQueries: number;
  totalTrackedQueries: number;
  measuredTrackedQueries: number;
  zeroResultQueries: number;
  searchSuccessRate: number;
  averageSearchResultCount: number;
  averageSearchDurationMs: number;
  refreshedAt: string;
};

type AnalyticsResponse = {
  summary: AnalyticsSummary;
  queries: AnalyticsMetricEntry[];
  failedQueries: AnalyticsMetricEntry[];
  words: AnalyticsMetricEntry[];
  bigrams: AnalyticsMetricEntry[];
  trigrams: AnalyticsMetricEntry[];
  distinctiveBigrams: AnalyticsMetricEntry[];
  distinctiveTrigrams: AnalyticsMetricEntry[];
  topTranscriptVideos: AnalyticsVideoEntry[];
  yearlyActivity: AnalyticsYearEntry[];
};

export const metadata: Metadata = {
  title: "Analytics",
  description: "Aggregated search and transcript analytics for the Niilo22 archive.",
};

export const dynamic = "force-dynamic";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fi-FI").format(value);
}

function formatDecimal(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("fi-FI", {
    maximumFractionDigits,
  }).format(value);
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
    next: {
      revalidate: 120,
    },
  });

  if (!response.ok) {
    throw new Error(`Analytics request failed with status ${response.status}`);
  }

  return (await response.json()) as AnalyticsResponse;
}

function BarList({ items, emptyText }: { items: AnalyticsMetricEntry[]; emptyText: string }) {
  const maxCount = Math.max(0, ...items.map((item) => item.count));

  if (items.length === 0) {
    return <p className="analytics-empty">{emptyText}</p>;
  }

  return (
    <div className="analytics-bars" role="list">
      {items.map((item) => {
        const width = maxCount > 0 ? `${Math.max(8, (item.count / maxCount) * 100)}%` : "8%";

        return (
          <div className="analytics-bar-row" role="listitem" key={item.key ?? item.label}>
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

function YearlyActivityList({ items }: { items: AnalyticsYearEntry[] }) {
  if (items.length === 0) {
    return <p className="analytics-empty">Yearly activity is not available yet.</p>;
  }

  return (
    <div className="analytics-year-list" role="list">
      {items.map((item) => (
        <div className="analytics-year-row" role="listitem" key={item.year}>
          <strong>{item.year}</strong>
          <span>{formatNumber(item.videoCount)} videos</span>
          <span>{formatNumber(item.wordCount)} words</span>
          <span>{formatDecimal(item.transcriptHours)} h</span>
        </div>
      ))}
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
  const hasMeasuredSearches = analytics.summary.measuredTrackedQueries > 0;
  const coverageEntries = [
    { label: "Ready", count: analytics.summary.readyVideos },
    { label: "Ambient / no speech", count: analytics.summary.ambientVideos },
    { label: "Missing", count: analytics.summary.missingVideos },
  ];
  const transcriptVideoEntries = analytics.topTranscriptVideos.map((video) => ({
    key: video.videoId,
    label: video.title,
    count: video.wordCount,
  }));

  return (
    <main className="page-shell analytics-page-shell">
      <section className="status-banner analytics-hero">
        <div className="analytics-hero__copy">
          <p className="stage-bar__eyebrow analytics-hero__eyebrow">Archive intelligence</p>
          <h1>Analytics</h1>
          <p className="analytics-hero__text">A lightweight view of search quality, transcript coverage, archive activity, and recurring language.</p>
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
        <MetricCard label="Transcript coverage" value={`${formatDecimal(analytics.summary.transcriptCoveragePercent)}%`} />
        <MetricCard label="Approx. transcript hours" value={formatDecimal(analytics.summary.approximateTranscriptHours)} />
        <MetricCard label="Transcript words" value={formatNumber(analytics.summary.totalTranscriptWords)} />
        <MetricCard label="Avg. words / transcribed video" value={formatNumber(Math.round(analytics.summary.averageWordsPerTranscribedVideo))} />
        <MetricCard label="Median words / transcribed video" value={formatNumber(Math.round(analytics.summary.medianWordsPerTranscribedVideo))} />
        <MetricCard label="P90 words / transcribed video" value={formatNumber(Math.round(analytics.summary.p90WordsPerTranscribedVideo))} />
        <MetricCard label="Transcript chunks" value={formatNumber(analytics.summary.totalTranscriptChunks)} />
        <MetricCard label="Tracked searches" value={formatNumber(analytics.summary.totalTrackedQueries)} />
        <MetricCard label="Unique tracked queries" value={formatNumber(analytics.summary.uniqueTrackedQueries)} />
        <MetricCard label="Measured search success" value={hasMeasuredSearches ? `${formatDecimal(analytics.summary.searchSuccessRate)}%` : "—"} />
        <MetricCard label="Zero-result searches" value={formatNumber(analytics.summary.zeroResultQueries)} />
        <MetricCard label="Avg. results / search" value={hasMeasuredSearches ? formatDecimal(analytics.summary.averageSearchResultCount) : "—"} />
        <MetricCard label="Avg. backend search time" value={hasMeasuredSearches ? `${formatDecimal(analytics.summary.averageSearchDurationMs)} ms` : "—"} />
        <MetricCard label="Unique words" value={formatNumber(analytics.summary.uniqueWords)} />
        <MetricCard label="Unique phrases" value={formatNumber(analytics.summary.uniqueBigrams + analytics.summary.uniqueTrigrams)} />
      </section>

      <section className="analytics-grid">
        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Search quality</p>
              <h2>Most common queries</h2>
            </div>
            <p className="analytics-card__hint">Normalized queries, aggregated without storing user identities</p>
          </div>
          <BarList items={analytics.queries} emptyText="No tracked searches yet." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Search quality</p>
              <h2>Queries without results</h2>
            </div>
            <p className="analytics-card__hint">Useful gaps in the searchable archive</p>
          </div>
          <BarList items={analytics.failedQueries} emptyText="No zero-result searches have been measured yet." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Corpus health</p>
              <h2>Transcript coverage</h2>
            </div>
            <p className="analytics-card__hint">Ready, ambient, and missing transcript states</p>
          </div>
          <BarList items={coverageEntries} emptyText="Transcript status data is not available yet." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Corpus health</p>
              <h2>Largest transcripts</h2>
            </div>
            <p className="analytics-card__hint">Videos ranked by transcript word count</p>
          </div>
          <BarList items={transcriptVideoEntries} emptyText="Transcript size data is not available yet." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Archive timeline</p>
              <h2>Publication activity by year</h2>
            </div>
            <p className="analytics-card__hint">Published videos, transcript words, and approximate transcript hours</p>
          </div>
          <YearlyActivityList items={analytics.yearlyActivity} />
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

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Sequences</p>
              <h2>Top trigrams</h2>
            </div>
            <p className="analytics-card__hint">Three-token phrases by occurrence count</p>
          </div>
          <BarList items={analytics.trigrams} emptyText="Trigram analytics are not available yet." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Distinctive language</p>
              <h2>Distinctive bigrams</h2>
            </div>
            <p className="analytics-card__hint">Repeated pairs ranked by association; bars show occurrences</p>
          </div>
          <BarList items={analytics.distinctiveBigrams} emptyText="No repeated distinctive bigrams are available yet." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Distinctive language</p>
              <h2>Distinctive trigrams</h2>
            </div>
            <p className="analytics-card__hint">Repeated three-word phrases ranked by association; bars show occurrences</p>
          </div>
          <BarList items={analytics.distinctiveTrigrams} emptyText="No repeated distinctive trigrams are available yet." />
        </article>
      </section>
    </main>
  );
}
