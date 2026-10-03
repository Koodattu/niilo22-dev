# Reproduce the local checks

Use Node 24, npm lockfiles, Docker, and a dedicated disposable PostgreSQL database. These commands are for PowerShell from the repository root unless otherwise stated. Install declared dependencies with `npm ci` in `web/backend` and `web/frontend` first.

**Tests and seeds remove videos absent from their synthetic fixture files. Never point them at an existing archive.** The test guard requires localhost and a database name ending in `_test`; that is an extra check, not permission to use an existing database.

## 1. Disposable database

```powershell
$testRepoRoot = (Get-Location).Path
docker run --detach --rm --name niilo22-local-tests --cpus=2 --memory=512m --tmpfs /var/lib/postgresql/data --publish 127.0.0.1::5432 -e POSTGRES_USER=goal_test -e POSTGRES_PASSWORD=local_test_only -e POSTGRES_DB=niilo22_local_test postgres:17.10-alpine3.23
$testPgPort = (docker port niilo22-local-tests 5432/tcp).Split(':')[-1]
$env:TEST_DATABASE_URL = "postgresql://goal_test:local_test_only@127.0.0.1:${testPgPort}/niilo22_local_test"
docker exec niilo22-local-tests pg_isready -U goal_test -d niilo22_local_test
```

Continue when `pg_isready` reports accepting connections. Existing migration 002 uses `ALTER SYSTEM`; this isolated container has its own database superuser. No host/production PostgreSQL settings should be changed. Container-name conflicts should be resolved by choosing a new task-specific name, not deleting an existing container.

## 2. Backend checks and fixtures

```powershell
Set-Location "$testRepoRoot\web\backend"
npm test
npm run test:seed
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:HOST = '127.0.0.1'
$env:PORT = '44117'
$env:MIGRATION_PATH = "$testRepoRoot\web\db\migrations"
npm run dev
```

Keep that terminal running. `npm test` builds TypeScript, then runs CLI/import/API regression checks against PostgreSQL. On a new database it applies all migrations. Reseeding restores three videos after tests that intentionally change/delete fixtures.

## 3. Production frontend and browser checks

In a second terminal, from `web/frontend`:

```powershell
$env:BACKEND_URL = 'http://127.0.0.1:44117'
$env:SITE_URL = 'http://127.0.0.1:33117'
npm run build
npm run start -- --hostname 127.0.0.1 --port 33117
```

The build fetches the existing Google Fonts and needs network access. `next start` serves local checks but emits the existing standalone-output warning; deployment uses the separate standalone build workflow. Open <http://127.0.0.1:33117> and search for `aamukahvi` to review the synthetic archive. Synthetic video IDs intentionally cannot play real YouTube media outside the tests.

In a third terminal, from `web/frontend`:

```powershell
npm test
```

Windows tests use installed Microsoft Edge. Elsewhere, install Playwright Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL` to an installed supported browser. The test dependency is development-only.

Search tests use the real Next proxy and Fastify/PostgreSQL search. Only external YouTube playback and deliberate failure cases are replaced. Failure tests start and stop a separate local HTTP stub and production Next process, so a production build is required. Tests cover keyboard/timestamps, history, cancellation, loading/empty/errors/retry, clipboard/shared links, autoplay completion/paused/off, ambient videos, responsive layouts, text scaling, analytics and service failures.

Screenshots go to `work/goal-improvement/evidence`; transient failure artifacts go to ignored `web/frontend/test-results`. Browser viewport emulation does not verify physical mobile hardware or actual YouTube streaming.

## 4. Python pipeline and bounded benchmark

With the existing Python requirements installed, from the repository root:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

The tests use temporary files and a synthetic model at the transcription boundary. No downloads, API credentials or GPU inference are used.

Optional benchmark, from `web/backend` with the same explicit `TEST_DATABASE_URL`:

```powershell
npx tsx tests/benchmark.ts
npx tsx tests/benchmark.ts --cold
npm run test:seed
```

This creates 400 synthetic videos / 24,000 chunks, then measures 30 sequential requests with cache enabled or disabled (the database is warm). Reseeding removes benchmark videos. The work log records the initial before/after measurements; this script measures the current version only. Synthetic timings do not establish production capacity.

## 5. Cleanup and review

Stop both app terminals with Ctrl+C, then remove only the container created above:

```powershell
docker rm -f niilo22-local-tests
```

Review changes with `git status --short`, `git diff`, and `git log --oneline`. The initial local work was subsequently committed/pushed at the user's request, followed by the dependency security update. See [STATE.md](STATE.md) for measured outcomes and [REVIEW.md](REVIEW.md) for remaining limitations and migration considerations.
