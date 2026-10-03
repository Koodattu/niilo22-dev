# Improvement goal — 2026-10-03

## Starting state and scope
- Revision: `d104c710479b9092bf2db8e47f69f31efbc04c21`; staged, unstaged and untracked work all empty before changes.
- One agent; local edits only. No commits, publishing, deployment or external writes.
- No repository/ancestor AGENTS.md found. User-provided global instructions apply.
- Product: Finnish Niilo22 transcript archive. Core journeys: search → choose timestamp → watch; copy/open shared moment; inspect archive analytics; incremental local data import.
- Stack: Node 24, npm lockfiles, Next 16.3 / React 19, Fastify 5, PostgreSQL 17; Python media/transcription pipeline. Finnish search UI, English analytics; no locale catalogs. Preserve established voice and cream/brown palette, Bitter headings, Space Grotesk body.
- UI direction: scoped product UI improvements for desktop keyboard/mouse and mobile touch. Search must be discoverable, selection operable with native controls, loading/error/empty distinct, shared moments durable. Preserve the player/results workspace.

## Baseline and resources
- `git -c safe.directory=E:/Projektit/niilo22-dev status --short` → clean. Per-command safe.directory required by sandbox account.
- `cd web/backend; npm run build` → PASS. No existing test scripts or test files.
- Baseline frontend build was blocked by sandbox access to the existing Google Fonts download; the same build passed with approved network access. No source build failure was established.
- Docker available only through escalation. Task container `niilo22-goal-20261003`, PostgreSQL 17.10 alpine, 512 MiB / 2 CPUs, tmpfs data, synthetic data only. First create failed because port 55432 was occupied; only that failed task container was removed, then recreated on dynamic localhost port 55770. No existing volumes/containers touched.
- Existing .env values and dataset contents not read or used. Explicit task environment overrides for every app/import/test invocation.

## Ranked backlog (initial candidates; reproduce before implementing)
| Priority | Evidence / user impact | Acceptance | Confidence / effort / risk |
|---|---|---|---|
| 1 | Import filename parser splits on every underscore; valid YouTube IDs may contain underscores, so transcript data can disappear from search. | CLI imports synthetic underscore-ID transcripts; idempotent rerun and malformed input preserve data. | High / small / medium |
| 1 | PostgreSQL BIGSERIAL snippet IDs returned as strings while UI URL parsing uses numbers; imports delete/recreate chunks. | Requested shared moment opens exactly; new links remain correct after reimport; old links stay compatible. | High / medium / medium |
| 1 | Result article acts as button and contains snippet buttons; parent keydown catches child Enter/Space. | Keyboard selects the requested snippet without jumping to first; input has label. | High / small / low |
| 1 | Autoplay advances via wall-clock timeout regardless of paused/buffering/blocked iframe playback. | Advance only after actual player completion, honor paused/off, and provide external playback recovery. | High / medium / medium |
| 2 | UI fetch has no cancellation/timeout; failures show English status codes and also “Ei osumia”; mobile starts with a large empty player above search. | Clear Finnish recovery, retained input, no false empty result; search visible and usable on narrow screens. | High / medium / medium |
| 2 | Search cache invalidation relies on local file stat; importer writes it only on full success. | Committed changes visible across API/import processes, including partial import failure; bounded cache and measured warm/cold workload. | High / medium / medium |
| 2 | Duplicate proxy fetch implementations have no timeout; shared-preview fetch can hold page rendering. | Bounded failure with consistent status; verify through HTTP. | High / small / low |

## Decisions / test seams
- Applying diagnosing-bugs, end-user-ui-ux, impeccable `audit`; context script run with absolute path and target web/frontend, no product/design docs present.
- Applying tdd, improve-codebase-architecture + codebase-design sequentially. Scope refactors to demonstrated issues; no presentation/interview/subagents under unattended-work authorization.
- Observable seams: importer CLI → real PostgreSQL → Fastify HTTP; browser user interactions through real Next proxy/backend. Only YouTube/network failures are test doubles at external boundaries. Node test runner + existing tsx for backend; minimal Playwright dev dependency for frontend because no browser test tooling exists.

## Next action
Complete within the authorized local scope. Final checks, self-review and task-only cleanup passed. No further implementation is planned; remaining dependency/deployment/provider work is outside this goal's authorization or local verification.

## Batch 1 — import identity and shared moments
- RED: importer/search integration returned only `testvid0001`, omitting `test_id0002`; fixed filename extraction to preserve all 11 ID characters.
- RED: browser keyboard Enter on 00:30 selected 00:00; reload after mouse selection also returned 00:00. Native title/snippet buttons removed nested interaction; frontend now preserves BIGSERIAL IDs as strings (existing wire format).
- RED: old chunk ID after reimport selected 00:00 instead of requested 00:30. New shares add `t` in seconds (millisecond precision), backend resolves nearest chunk within that video; old ID-only URLs still work. Metadata and OG URLs carry the timestamp.
- PASS: `cd web/backend; $env:TEST_DATABASE_URL='postgresql://goal_test:local_test_only@127.0.0.1:55770/niilo22_goal_test'; npm test` (first two tests); `npm run build`.
- PASS: `cd web/frontend; npm test -- --grep 'keyboard|reloading'` (2 browser tests).
- Inspected `evidence/before-desktop.png`, `evidence/before-mobile.png`. Mobile says “right” although search is below a large blank player. Browser baseline used font fallbacks because sandboxed dev cannot fetch Google Fonts; escalated frontend production build passed with real fonts. Existing font network requirement documented, not misreported as source failure.
- Applying code-review as sequential self-review against starting revision, full working diff/new files and these acceptance criteria. No independent reviewers.
- Task resources: container `niilo22-goal-20261003` at localhost:55770; backend :44117, frontend :33117. Synthetic fixture directory created/cleaned per run. Next dev generated frontend AGENTS.md / CLAUDE.md and next-env updates; read generated guidance, plan to remove task-generated noise after stopping dev.
- New RED test: running API retains the old title after a separate importer process commits changes (no shared version file). Next batch will make cache invalidation transactional in PostgreSQL.

## Batch 2 — cache and import reliability
- Added migration 007: one PostgreSQL revision row. Import updates revision in the same transaction as each changed video or deletion. API checks the row before serving cached data; no shared disk/mtime dependency. Cache remains bounded LRU, request key includes normalized query/limit/snippet limit; unchanged imports do not invalidate it. No tenants/users in this public archive.
- RED → GREEN: cross-process stale title; invalid reversed timestamps previously overwrote searchable data. Importer now validates metadata/transcripts before replacing each video's data; earlier valid commits remain visible if a later file fails. Four PostgreSQL integration tests and backend build pass.
- Additive migration only, no data rewrite/index. Existing migrations through 006 upgraded successfully in disposable DB. Fresh-install validation still pending. Keep 007 if rolling application code back; legacy processes need restart/normal legacy cache handling. Deployment config unchanged (old SEARCH_DATA_VERSION_PATH setting is now unused by new code).
- Benchmark: `npx tsx tests/benchmark.ts` and `--cold`, TEST_DATABASE_URL as above. 400 synthetic videos / 24,000 chunks / 2,400 matching chunks, PostgreSQL 17.10 limited to 2 CPUs and 512 MiB, 30 sequential warm-DB requests. Before: cache median 0.082 ms / p95 0.122 ms; uncached median 8.644 / p95 9.567 ms. After: cache median 0.507 / p95 0.736 ms; uncached median 8.985 / p95 13.115 ms. Correct freshness costs ~0.43 ms median locally; no production performance claim. Benchmark records are synthetic and removed on next fixture import (dedicated test DB only).

## Batch 3 — playback, navigation and responsive recovery
- RED → GREEN: advancing the browser clock 15 seconds skipped an unplayed video. Replaced timer with official YouTube IFrame API completion events, scoped lifecycle/cleanup in VideoPlayer. Native player stays usable if API fails; YouTube link provided. Sources: https://developers.google.com/youtube/iframe_api_reference and installed Next docs.
- Consolidated duplicate search/shared loading into one cancellable request path, 15s timeout, latest request wins, unmount cleanup, Finnish failure/retry, no false “Ei osumia” on network errors. New searches create history entries; Back/Forward restore query/selection. Ambient shared video can play without transcript snippets.
- Applied impeccable `harden` and `adapt`, retaining existing palette/fonts. Labelled search appears before player on mobile; results use native buttons with pressed states and visible focus; all four returned snippets available. Reduced nested-card chrome, darkened action fills for contrast, removed mobile nested result scrolling and fixed directional copy. Applying emil-review-animations only to changed scroll/reduced-motion behavior; no new decorative motion.
- Browser RED tests for missing error recovery and missing accessible/mobile-first search recorded. Current checks: keyboard/reload/autoplay/mobile pass; failure test locator needed scoping to main because Next also owns an empty alert announcer. Await final rerun.

## Batch 4 — pipeline safety and bounded service failures
- Python RED → GREEN (3 unittest tests): transcribe/local search truncated underscore IDs; corrupt metadata was treated as empty; failed serialization truncated the previous metadata file. Shared pipeline filename handling and atomic same-directory JSON replacement now preserve data. GPU/transcription algorithm untouched; tests supply a synthetic model at the external Whisper boundary.
- Compiled backend default paths reproduced as web/videos.json, web/output, backend/db/migrations; corrected source/dist root resolution. Regression test passes after build.
- Backend now rejects punctuation-only, one-letter, excessive (>200 char) searches and out-of-range shared parameters (HTTP tests). Actual BIGSERIAL wire format remains string; historical links supported.
- Proxy hanging upstream stayed pending after 12 seconds (RED), now returns 504 after 10 seconds (GREEN); duplicate proxy code consolidated. Metadata invalid JSON previously threw, now falls back. Analytics unavailable upstream previously threw the whole page; recovery UI added, browser verification pending production rebuild (Playwright's TSX transform isn't React SSR; switched to actual Next-rendered page test, not weakening assertions).
- Analytics copy now Finnish, matching document language and search UI, and linked from the search controls. No translation catalogs exist.
- Expanded real-browser tests: 10 PASS, including history, latest request wins, clipboard and reopened timestamp, ambient video, missing video, validation, plus previously verified flows. Test screenshots inspected with fallback fonts; production-font capture pending.

## Final integration and coverage
- All batch acceptance criteria now pass. [REVIEW.md](REVIEW.md) records the final sequential self-review and applicable-area coverage. [VERIFICATION.md](VERIFICATION.md) provides exact reproducible local setup/check/cleanup commands; root/web READMEs now link it and accurately describe Finnish FTS versus the separate Python fuzzy search.
- Added missing environment loading for documented backend dev/import commands and corrected the example database port to 55422. Existing explicit environment values take precedence. The compiled-path regression remains covered. README writes needed a narrow approved escalation after the sandbox denied them; no permissions/settings were changed.
- Final browser checks found and fixed a 370px overflow at a 320px viewport, caused by the player aspect ratio/minimum height. Verified selected states at 320×740, 768×1024 and 1280×600, initial mobile at 390×844, desktop at 1440×900, 200% text at 768px, analytics navigation and 320px analytics. Page-error/API-failure collection was empty in the success journey.
- RED → GREEN: a new search launched from a shared link retained its old `t` value. Query navigation now removes it. Shared canonical metadata/PNG preview are verified. Preview copy is Finnish; screenshot inspection found a clipped provider URL, replaced with the concise YouTube label and regenerated/inspected successfully.
- Autoplay checks cover elapsed time without completion, paused events, actual completion, disabled autoplay, and unavailable provider API/native iframe recovery. Real provider media remains outside local verification.
- Final backend: `cd web/backend; $env:TEST_DATABASE_URL='postgresql://goal_test:local_test_only@127.0.0.1:55770/niilo22_goal_test'; npm test` → **7 PASS**, including TypeScript build. `npm run test:seed` → PASS, restores 3 videos. The same 7 checks previously passed on fresh `niilo22_fresh_test`, applying all 7 migrations; upgrade from existing 006 was also tested.
- Final Python: `.\venv\Scripts\python.exe -m unittest discover -s tests -v` → **3 PASS**.
- Final frontend: from `web/frontend`, set `BACKEND_URL=http://127.0.0.1:44117`, `SITE_URL=http://127.0.0.1:33117`, then `npm run build` → **PASS**, including TypeScript. With the task backend and production frontend running, `npm test` → **16 PASS** in 28.5 seconds. After the final provider-label text edit, production build + `npm test -- search.spec --grep 'shared metadata'` → **PASS**; unaffected suites were not repeated.
- `git -c safe.directory=E:/Projektit/niilo22-dev -c core.safecrlf=false diff --check` → PASS. No hooks/tests were bypassed. Self-review includes all untracked code/tests/docs, not just the tracked diff.
- Final screenshots inspected: `evidence/after-desktop.png`, `after-mobile.png`, `selected-320.png`, `selected-1280.png`, `text-scaling.png`, `analytics-320.png`, `analytics-error.png`, `shared-preview.png`. Final build uses configured fonts; baseline screenshot font limitation retained above.
- Query-plan/storage follow-up on the bounded benchmark: first query selected sequential scan for 10% selectivity, 3.220 ms execution, 657 shared-buffer hits. Revision table adds **24 KiB** total. No new index/storage optimization justified. Full workload/timing/footprint caveats in REVIEW.md. Repeated warm-cache measurement was median 0.445 / p95 0.589 ms; no production speedup claim.

## Cleanup
- Stopped task backend (:44117) and production frontend (:33117); verified neither port is listening. Earlier dev/production instances were stopped when replaced. Failure-test child servers are closed by the test suite.
- `docker rm -f niilo22-goal-20261003` succeeded. Both synthetic databases and tmpfs data were removed with that task container; no unrelated container or volume was touched.
- Removed only Next-generated frontend AGENTS.md / CLAUDE.md after confirming their generated content and stopping dev, plus a duplicate review screenshot. Global instructions/skills/permissions were not changed. Fixture scripts clean their own guarded temporary paths.
- Final Git state contains only the reviewed application, tests, migration, documentation and evidence changes. No commits, pushes, PRs or deployments. Build outputs/dependencies remain available for local review.

## Deferred / constraints
- `npm audit --omit=dev --json`: frontend has 1 critical (Next 16.3.0), 1 high (sharp), 1 moderate (baseline-browser-mapping); backend has 2 high (Fastify, fast-uri). No upgrades authorized, no packages auto-fixed. npm recommends Next 16.3.8; review a dependency patch separately before deployment.
- Verified advisory https://github.com/advisories/GHSA-vcvr-r3jv-pc5j (Node ImageResponse, fixed 16.3.6; exploit condition includes attacker-controlled SVG values) and https://github.com/advisories/GHSA-p293-qw3h-jr36 (Windows-hosted servers). This app uses Node next/og and user query text in div content; no exploit attempted or proven. Production Docker is Linux, but local host is Windows and tests bind localhost only.
- Existing migration 002 changes PostgreSQL system settings and requires elevated DB rights; left unchanged under infrastructure/deployment restriction. Dedicated container only used for applying it.
- YouTube playback/provider behavior tested with official API-shaped double and local synthetic videos; real streaming/audio and actual iOS/Android hardware are not yet verified. External downloads/API/GPU training not run. No production data/credentials used.
