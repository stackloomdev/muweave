# Muweave

Read `docs/EXECUTION_PLAN.md` and `docs/VALIDATION.md` for scope and current evidence. This is an independent browser-first, agent-operated visual video canvas.

- All application features run in the browser. Do not reintroduce a business backend, native FFmpeg, or a headless render server. Build/test tooling and the one-time legacy migration helper are separate from application runtime.
- Preserve the split between visible content, narration, captions, and production notes.
- UI and WebMCP use the same validated IndexedDB transaction API. Never bypass revisions, receipts, or atomic persistence.
- Time is integer microseconds. Preview and export use the same evaluator and renderer.
- Keep user assets outside source control. Never depend on a developer's absolute paths.
- Test transactions, concurrency, timeline behavior, browser persistence and real exports. Runtime evidence is separate from unit tests.
- Report native WebMCP only after actual discovery and execution in a supported browser. No fake modelContext shim.
- Keep the approved visual video canvas scope. Do not turn it into a testing/review platform.
