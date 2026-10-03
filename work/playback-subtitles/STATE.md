# Playback and subtitles — 2026-10-03

Starting revision: `f3fb3e8`; working tree clean. User authorizes implementation, commit, push and deployment. One agent; preserve the existing Finnish search workspace, fonts and palette.

## Plan and acceptance

1. Inspect playback and stored word timings. Keep separate search hits; continue through forward hits whose padded playback windows overlap, without remounting or seeking the player. Distant hits still advance normally. Autoplay off, pause, buffering and manual selection retain their behavior.
2. Return a bounded transcript time range from the existing `words_json` data. Display short subtitle phrases and highlight the word at the actual YouTube playhead; handle seeking, pauses, empty ranges and unavailable transcripts. Add a subtle loading state with reduced-motion support.
3. Verify through importer → disposable PostgreSQL → Fastify → Next → browser. Only the external YouTube API is doubled. Review desktop/mobile screenshots, commit and push, then verify the existing server deployment timer and health.

## Design decisions

- YouTube prohibits custom elements in front of its embedded player: https://developers.google.com/youtube/terms/required-minimum-functionality#overlays-and-frames . Subtitles and loading feedback occupy a slim dark strip directly below the iframe, within the player shell, leaving native controls unobscured. This placement difference was disclosed to the user before implementation.
- Timing follows `getCurrentTime()` and player state, never elapsed wall time: https://developers.google.com/youtube/iframe_api_reference . No database migration, production import, new dependency or deployment configuration change is needed.
- Apply the existing UI, TDD and motion guidance selectively. Progress animation is linear; reduced motion is static; spoken-word changes have no decorative transitions.
- Test resources: task-only PostgreSQL container `niilo22-playback-20261003`, localhost port 63628, database `niilo22_playback_test`; synthetic data only. Existing production data and credentials are not test inputs.

## Verification

- RED: the transcript range route returned 404; the browser reproduced missing continuous selection, subtitles and loading feedback before implementation.
- PASS: backend build and all 9 integration/config tests against the disposable database. Tests exercise cross-chunk word timing, surrounding speech, empty ranges, underscore IDs, missing videos and invalid/unbounded ranges, plus existing import/search regressions.
- PASS: frontend production build and all 23 Playwright tests against the actual local frontend/backend/database. New coverage includes nearby/distant transitions without iframe reload, autoplay toggles after clip completion, paused/buffering clocks, backward and distant seeks, word highlighting, subtitle visibility and retry, silence/ambient videos, and loading/reduced motion. Existing keyboard, history, sharing, proxy timeout, analytics and 200% text checks also pass.
- Inspected desktop, 390px mobile and 320px loading screenshots in `evidence/`. The subtitle band leaves the iframe unobscured and at least 200px high. No horizontal page overflow. Previous goal screenshots were backed up/restored so their historical evidence remains unchanged.
- Reviewed the final changes for scope, lifecycle cleanup, request cancellation, player API readiness, bounded SQL parameters, accessible Finnish controls and existing dependencies. No new dependencies, schema changes or infrastructure changes. Clip completion follows actual playing time; the moving end boundary never remounts the current nearby playback run.
- Final review reproduced a manual-selection edge case: enabling autoplay after the clip finished did not advance because the one-time manual play request remained active. Consume that request when the player reports its playhead; the regression now includes a manual timestamp click before completion.

| Motion | Review | Result |
| --- | --- | --- |
| Loading spinner | 900ms linear transform; static with reduced motion; no pointer interception | Pass |
| Spoken word | Immediate color + underline, no animation or per-word live announcements | Pass |
| Nearby selection | Existing player retained; no seek/reload or additional decorative transition | Pass |

Verdict: ready to commit and deploy. Live YouTube media is replaced only at the external boundary in automated tests; real-provider network/autoplay restrictions and the quality of existing transcript alignment are not guaranteed by those tests. Custom subtitles do not appear in YouTube's native fullscreen or picture-in-picture view. If its API fails, native playback remains available but timed clip boundaries/subtitles cannot run.

Commit/push and verification of the existing `vaarattu-server` deployment timer are the final operational steps; their results will be reported in the task response.
