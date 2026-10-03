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
  title: "Tilastot",
  description: "Niilo22-arkiston haku- ja puhetekstitilastot.",
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
    signal: AbortSignal.timeout(10_000),
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
    return <p className="analytics-empty">Vuosittaisia tilastoja ei ole vielä saatavilla.</p>;
  }

  return (
    <div className="analytics-year-list" role="list">
      {items.map((item) => (
        <div className="analytics-year-row" role="listitem" key={item.year}>
          <strong>{item.year}</strong>
          <span>{formatNumber(item.videoCount)} videota</span>
          <span>{formatNumber(item.wordCount)} sanaa</span>
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
  let analytics: AnalyticsResponse;
  try {
    analytics = await loadAnalytics();
  } catch {
    return (
      <main className="page-shell analytics-page-shell">
        <section className="status-banner analytics-hero">
          <div className="analytics-hero__copy">
            <h1>Tilastoja ei voitu ladata</h1>
            <p>Tietopalvelu ei vastaa juuri nyt. Kokeile hetken kuluttua uudelleen.</p>
          </div>
          <div className="analytics-hero__actions">
            <a className="stage-link" href="/analytics">Yritä uudelleen</a>
            <a className="stage-link stage-link--share" href="/">Takaisin hakuun</a>
          </div>
        </section>
      </main>
    );
  }
  const hasMeasuredSearches = analytics.summary.measuredTrackedQueries > 0;
  const coverageEntries = [
    { label: "Puheteksti valmis", count: analytics.summary.readyVideos },
    { label: "Ei puhetta", count: analytics.summary.ambientVideos },
    { label: "Puheteksti puuttuu", count: analytics.summary.missingVideos },
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
          <p className="stage-bar__eyebrow analytics-hero__eyebrow">Niilo22-arkisto</p>
          <h1>Tilastot</h1>
          <p className="analytics-hero__text">Hakujen osumat, puhetekstien kattavuus ja arkiston yleisimmät sanat ja ilmaukset.</p>
        </div>
        <div className="analytics-hero__actions">
          <a className="stage-link stage-link--share" href="/">
            Takaisin hakuun
          </a>
          <span className="analytics-hero__stamp">Päivitetty {formatUpdatedAt(analytics.summary.refreshedAt)}</span>
        </div>
      </section>

      <section className="analytics-metrics-grid">
        <MetricCard label="Videoita" value={formatNumber(analytics.summary.totalVideos)} />
        <MetricCard label="Puhetekstien kattavuus" value={`${formatDecimal(analytics.summary.transcriptCoveragePercent)}%`} />
        <MetricCard label="Puhetta noin (tuntia)" value={formatDecimal(analytics.summary.approximateTranscriptHours)} />
        <MetricCard label="Sanoja puheteksteissä" value={formatNumber(analytics.summary.totalTranscriptWords)} />
        <MetricCard label="Sanoja videossa keskimäärin" value={formatNumber(Math.round(analytics.summary.averageWordsPerTranscribedVideo))} />
        <MetricCard label="Sanamäärän mediaani" value={formatNumber(Math.round(analytics.summary.medianWordsPerTranscribedVideo))} />
        <MetricCard label="Sanamäärän 90. persentiili" value={formatNumber(Math.round(analytics.summary.p90WordsPerTranscribedVideo))} />
        <MetricCard label="Puhetekstikatkelmia" value={formatNumber(analytics.summary.totalTranscriptChunks)} />
        <MetricCard label="Hakuja yhteensä" value={formatNumber(analytics.summary.totalTrackedQueries)} />
        <MetricCard label="Erilaisia hakuja" value={formatNumber(analytics.summary.uniqueTrackedQueries)} />
        <MetricCard label="Osuman löytäneet haut" value={hasMeasuredSearches ? `${formatDecimal(analytics.summary.searchSuccessRate)}%` : "—"} />
        <MetricCard label="Hakuja ilman osumia" value={formatNumber(analytics.summary.zeroResultQueries)} />
        <MetricCard label="Tuloksia haussa keskimäärin" value={hasMeasuredSearches ? formatDecimal(analytics.summary.averageSearchResultCount) : "—"} />
        <MetricCard label="Haun kesto keskimäärin" value={hasMeasuredSearches ? `${formatDecimal(analytics.summary.averageSearchDurationMs)} ms` : "—"} />
        <MetricCard label="Erilaisia sanoja" value={formatNumber(analytics.summary.uniqueWords)} />
        <MetricCard label="Erilaisia ilmauksia" value={formatNumber(analytics.summary.uniqueBigrams + analytics.summary.uniqueTrigrams)} />
      </section>

      <section className="analytics-grid">
        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Hakujen osumat</p>
              <h2>Yleisimmät haut</h2>
            </div>
            <p className="analytics-card__hint">Yhdenmukaistetut haut koottuna ilman käyttäjien tunnistetietoja</p>
          </div>
          <BarList items={analytics.queries} emptyText="Hakuja ei ole vielä tallennettu." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Hakujen osumat</p>
              <h2>Haut ilman osumia</h2>
            </div>
            <p className="analytics-card__hint">Hakusanat, joille ei löytynyt vastaavaa puhetta</p>
          </div>
          <BarList items={analytics.failedQueries} emptyText="Kaikki tähän mennessä mitatut haut ovat löytäneet osumia." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Puhetekstit</p>
              <h2>Puhetekstien kattavuus</h2>
            </div>
            <p className="analytics-card__hint">Valmiit puhetekstit, puheettomat videot ja puuttuvat puhetekstit</p>
          </div>
          <BarList items={coverageEntries} emptyText="Puhetekstien tilatietoja ei ole vielä saatavilla." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Puhetekstit</p>
              <h2>Eniten puhetta</h2>
            </div>
            <p className="analytics-card__hint">Videot puhetekstin sanamäärän mukaan</p>
          </div>
          <BarList items={transcriptVideoEntries} emptyText="Puhetekstien sanamääriä ei ole vielä saatavilla." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Arkiston aikajana</p>
              <h2>Julkaisut vuosittain</h2>
            </div>
            <p className="analytics-card__hint">Julkaistut videot, puhetekstien sanamäärät ja puheen arvioitu kesto</p>
          </div>
          <YearlyActivityList items={analytics.yearlyActivity} />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Puhetekstit</p>
              <h2>Yleisimmät sanat</h2>
            </div>
            <p className="analytics-card__hint">Yhdenmukaistetuista puheteksteistä</p>
          </div>
          <BarList items={analytics.words} emptyText="Sanatilastoja ei ole vielä saatavilla." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Ilmaukset</p>
              <h2>Yleisimmät sanaparit</h2>
            </div>
            <p className="analytics-card__hint">Kahden sanan ilmaukset esiintymiskertojen mukaan</p>
          </div>
          <BarList items={analytics.bigrams} emptyText="Sanaparien tilastoja ei ole vielä saatavilla." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Ilmaukset</p>
              <h2>Yleisimmät kolmen sanan ilmaukset</h2>
            </div>
            <p className="analytics-card__hint">Kolmen sanan ilmaukset esiintymiskertojen mukaan</p>
          </div>
          <BarList items={analytics.trigrams} emptyText="Kolmen sanan ilmausten tilastoja ei ole vielä saatavilla." />
        </article>

        <article className="status-banner analytics-card">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Tunnusomaiset ilmaukset</p>
              <h2>Tunnusomaiset sanaparit</h2>
            </div>
            <p className="analytics-card__hint">Sanaparit sanojen yhteyden vahvuuden mukaan; palkit kuvaavat esiintymiskertoja</p>
          </div>
          <BarList items={analytics.distinctiveBigrams} emptyText="Toistuvia tunnusomaisia sanapareja ei ole vielä saatavilla." />
        </article>

        <article className="status-banner analytics-card analytics-card--wide">
          <div className="analytics-card__header">
            <div>
              <p className="analytics-card__eyebrow">Tunnusomaiset ilmaukset</p>
              <h2>Tunnusomaiset kolmen sanan ilmaukset</h2>
            </div>
            <p className="analytics-card__hint">Kolmen sanan ilmaukset sanojen yhteyden vahvuuden mukaan; palkit kuvaavat esiintymiskertoja</p>
          </div>
          <BarList items={analytics.distinctiveTrigrams} emptyText="Toistuvia tunnusomaisia kolmen sanan ilmauksia ei ole vielä saatavilla." />
        </article>
      </section>
    </main>
  );
}
