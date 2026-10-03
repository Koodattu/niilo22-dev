# Final coverage and self-review

Reviewed sequentially by the implementing agent against the starting revision `d104c710479b9092bf2db8e47f69f31efbc04c21`, the requested goal, tracked diffs and new files. This is self-review, not an independent assessment. No unrelated user changes existed at the start. No commits, deployment changes or external writes were made.

## Coverage and outcomes

| Area | Evidence and resulting decision |
|---|---|
| Search → select → watch | Reproduced Enter selecting the first snippet and reload losing a selection. Native controls and string chunk IDs now preserve selection. Search, results, all four timestamps and player remain available. |
| Shared moments | Reimport previously invalidated a shared chunk ID. New links carry seconds as well as ID; backend resolves the nearest timestamp in that video. Shared preview and canonical URLs preserve the moment. Starting a new search clears an old shared timestamp. |
| Playback and motion | A wall timer skipped unplayed/paused media. Actual provider completion now drives advancement; paused/off states are covered. Native iframe and external link provide recovery if the API fails. Result scrolling is desktop-only and honors reduced motion; the existing loading spinner stops animating under reduced motion. No decorative animation was added. |
| Search recovery and navigation | One cancellable loader replaces duplicate paths. Latest request wins, browser history restores query/results, input survives failure, loading/error/empty are distinct, and retry is actionable. Requests have bounded timeouts. |
| Interface and accessibility | Preserved cream/brown palette, Bitter and Space Grotesk. Mobile starts with labelled search. Native buttons, pressed states, visible focus and 44px controls replace nested interactive cards. Finnish copy includes analytics and preview metadata. Tested 320/390/768/1280/1440px widths, a 600px-high desktop, selection and 200% text at 768px. Fixed a measured 370px player overflow at a 320px viewport. |
| Analytics | Existing page is reachable from search, uses Finnish copy and recovers from an unavailable backend. Real database assertions cover totals, ambient/ready status and deleted videos. Existing aggregate/snapshot algorithm retained. |
| Import/data pipeline | Underscore video IDs work through transcription, local fuzzy search, CLI import and HTTP search. Validation rejects malformed timestamps before replacing a video's prior data. Atomic JSON replacement preserves existing files on serialization failure; unreadable metadata stops the downloader. Idempotent imports and deletions are covered. |
| Cache | Existing 250-entry LRU/key scope and in-flight deduplication retained. Key includes normalized query and result/snippet limits; archive has no users/tenants. Transactional PostgreSQL revision replaces file mtime. Cross-process changes, partial failures, unchanged imports, limits and deletions are covered. Missing revision/database errors propagate instead of silently serving an indefinitely stale cache. |
| Schema/database | Additive migration 007 tested after 006 and on an empty database through all migrations. Existing PK/FK/unique constraints retained. Search uses two set-based queries, bounded video limits and per-video candidate ranks; no N+1 pattern found. No index or retention change justified by the bounded workload. |
| Reliability/security | SQL parameters, React text rendering, external boundaries, validation, cancellation, transactions and cleanup reviewed. Public archive has no account/tenant/billing flows. No auth, permission, encryption or deployment policy changed. Installed dependency advisories are deferred below. |
| Architecture/developer workflow | Reused existing Zod, PostgreSQL pool and transaction helper. Shared proxy, file handling and player lifecycle address demonstrated duplication/coupling. Source and compiled backend paths now agree; development/import scripts load documented env files. Added only Playwright as a dev dependency, with real integration fixtures and reproduction instructions. |

## Measurements

400 synthetic videos, 24,000 generated chunks, 2,400 matches; PostgreSQL 17.10 in Docker with 2 CPUs / 512 MiB; 30 sequential requests, warm database. Cache-disabled measurements do not mean cold disk.

| Mode | Before median / p95 | After median / p95 |
|---|---|---|
| Warm application cache | 0.082 / 0.122 ms | 0.507 / 0.736 ms |
| Cache disabled | 8.644 / 9.567 ms | 8.985 / 13.115 ms |

The revision lookup costs approximately 0.43 ms median locally and fixes stale results; this is not a performance speedup. A later repeat during query-plan inspection measured 0.445 / 0.589 ms warm-cache median/p95. Initial uncached requests were approximately 12–15 ms. No production-capacity claim follows from these synthetic measurements.

`EXPLAIN (ANALYZE, BUFFERS)` of the first search query for `mittauskahvi` selected a sequential scan (10% selectivity), hash aggregate and top-N heapsort: 3.220 ms, 657 shared-buffer hits, 27 KiB sort and 61 KiB aggregate memory. Existing FTS GIN and video/start indexes remain available; forcing an index or adding another is not justified by this measurement.

At inspection, the revision table used 8,192 bytes of heap + 16,384 of primary index = **24 KiB**. The reused synthetic test database had 5,332,992 heap / 7,667,712 index bytes for transcript chunks (13,041,664 total including ancillary storage), and 196,608 total bytes for videos. These include test/import history, are not production footprints, and do not establish storage savings. No data was deleted to claim savings.

## Remaining limitations and rollout notes

- Dependency patches were outside authorization. `npm audit --omit=dev` reported frontend Next critical, sharp high, baseline-browser-mapping moderate; backend Fastify and fast-uri high. Plan a separate reviewed patch before deployment. npm recommended Next 16.3.8. Primary advisories include [Node ImageResponse](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) and [Windows-hosted Next](https://github.com/advisories/GHSA-p293-qw3h-jr36). This app uses Node `next/og`; no exploit was attempted or proven. The SVG-specific exploit condition is not demonstrated by passing ordinary query text to a div. Production Docker is Linux; local test servers bound localhost.
- Apply 007 before the new API/importer. Coordinate their versions: old importers do not advance the new revision. Keep the additive table on application rollback; no destructive down migration is included. Old ID-only links whose chunks were already deleted cannot reconstruct the original time. New `t` links select the nearest available chunk after transcript changes.
- Per-video transactions deliberately preserve existing partial-import semantics. Earlier valid videos remain committed when a later transcript fails. The full analytics snapshot is refreshed after a successful import; it can remain at the prior successful snapshot after a partial failure until the input is fixed and import reruns.
- Existing migration 002 contains `ALTER SYSTEM`; elevated database rights were used only in the disposable test container. Production migration privileges/configuration remain an operator concern.
- Real YouTube streaming, audio, provider restrictions, physical iOS/Android devices, GPU inference, downloads and production-scale concurrency were not tested. Browser tests replace the external YouTube API/video at that boundary. Root experimental corpus/fine-tuning scripts were inspected as tooling, with no changes or expensive training runs warranted.
- Frontend builds still need Google Fonts network access. The repository's `next start` / standalone-output warning is documented in the local verification guide; deployment configuration is unchanged.

## Evidence and reproduction

See [VERIFICATION.md](VERIFICATION.md) for exact setup/check/cleanup commands and [STATE.md](STATE.md) for final check results. Screenshots in `evidence/` include before/after desktop and mobile, selected layouts, text scaling, analytics success/failure and the generated shared preview. Baseline UI screenshots used fallback fonts due to sandbox networking; final production screenshots use the configured fonts. Screenshots are synthetic fixtures, not production data.
