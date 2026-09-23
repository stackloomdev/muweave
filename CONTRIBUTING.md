# Contributing

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/BACKLOG.md` before changing behavior.

Install dependencies, Chromium and FFmpeg following the README. Run `pnpm dev` for development; use `pnpm check`, `pnpm test:e2e` and `pnpm format:check` before submitting a change. Browser tests use a temporary data directory and a separate port.

Keep changes focused and include a reproducible problem statement and the checks actually run. Changes to timings, persistence, imports or exports should include a regression test for the behavior. Visual changes need a real browser check. Unit tests cannot establish that a browser exposes native WebMCP.

Do not commit personal projects, generated customer assets, tokens, API keys or absolute machine paths. New distributed artwork and fonts must have a clear source and compatible license.

Never bypass the command API for an editor feature. Retain stable IDs, revision conflict checks, persisted request IDs and whole-batch undo. Keep notes out of captions and narration, and keep export tied to its immutable project snapshot.

This early preview intentionally focuses on local graphic-led video creation. Discuss major product or schema changes before expanding its scope. Runtime data is schema version 1; migrations must preserve existing user projects.
