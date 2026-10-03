# Player overlays — 2026-10-03

Starting revision: `852cf50`; working tree clean. User explicitly requests subtitles over the video and loading feedback in the video area, superseding the earlier below-video placement. Commit, push and deployment are authorized.

## Scope

- Remove the separate footer. Position subtitle phrases over the lower video area, above native controls, with a translucent background and existing word highlighting.
- Center the loading indicator inside the video. Preserve loading/buffering/error handling and static reduced-motion feedback.
- Pass pointer input through the overlays, except the existing subtitle retry button. Keep transcript timing, continuous playback and backend behavior unchanged.
- Retain the existing player, Finnish labels and styling. No dependencies, database changes or deployment configuration changes.

## Verification

- Updated the existing browser placement check to match the requested overlay behavior, verify native-control clearance and actual pointer hit testing on desktop/mobile, and capture scoped screenshots.
- RED: the previous subtitle strip was below the iframe and failed the new placement assertion.
- Enlarged-text review reproduced clipped captions at 320px with 200% text. The player minimum height now scales with text, while the native-control clearance stays in pixels; both normal and enlarged captions must fit inside the iframe area.
- Local tests use only synthetic fixtures in disposable container `niilo22-overlay-20261003`, localhost port 57293, database `niilo22_overlay_test`. YouTube is doubled only at the external boundary.
- PASS: frontend production build and all 23 browser tests against the real local frontend/backend/database. The updated layout test verifies desktop, 390px and 320px placement; clearance above native controls; captions and spinner passing pointer input through to the iframe; no leftover footer; reduced-motion behavior; and captions fitting at 200% text size.
- Inspected desktop/mobile caption screenshots, mobile loading and enlarged-text evidence in `evidence/`. Existing historical screenshots were restored after the regression run. Reviewed the final diff for scope, stale footer styles and pointer interception. No playback/timing or backend implementation changes.
- Motion review: existing 900ms linear spinner remains static under reduced motion; no caption animations or added transitions. Verdict: pass.
- Native YouTube fullscreen and picture-in-picture still contain only the iframe, so custom overlays are not included there. Automated tests use a simulated YouTube provider; real network/autoplay behavior is not established by them.
- Ready for the requested commit/push and verification through the existing server deployment timer. Operational deployment results will be reported in the task response.
