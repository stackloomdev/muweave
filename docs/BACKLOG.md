# Remaining work

The application now runs in the browser; current evidence is in `VALIDATION.md`.

- Complete a ten-scene narrated knowledge video and listen to every transition; automated media fixtures and the voiced demonstration remain short.
- Measure total browser memory for long / image-heavy exports; evaluate WebCodecs when measurements justify it.
- Test Safari, Firefox and mobile import/export limits. No claim of cross-browser parity yet.
- Add safe storage management and garbage collection based on history / snapshot reachability; provide storage usage and persistent-storage controls.
- Expand custom-font, background-music, complex transition and pixel-comparison coverage.
- Improve dense Chinese reflow, text fitting, paragraph layout, caption / narration handles and independent 4:3 layouts.
- Split the large studio component into focused inspector, timeline and asset modules as features grow.
- Define migrations for future IndexedDB / document versions, recovery for damaged projects, and durable receipt compaction.
- Complete ffmpeg.wasm matching-source and license-notice release packaging before publicly distributing hosted or packaged binaries.
- Verify the static build on an actual Vercel project and run remote CI; neither is implied by local validation.

Accounts, cloud collaboration, marketplaces, full source-video editing, automatic transcription, background export after closing the page and hosted generation providers remain outside this version.
