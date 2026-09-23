---
name: muweave-storyboard
description: Create and revise editable 16:9 text and shape storyboards with Muweave, preview the canvas, and hand off a project bundle for browser editing and video export.
---

# Muweave storyboard

Use the Muweave MCP tools for a draft in the current conversation. Read `muweave_capabilities` first. The server is a stateless transformer, not a project library; it cannot list, load by ID, or recover old projects. Never claim a draft has been saved to the cloud.

## Make a draft

1. Establish the requested content and page count. Check factual claims when appropriate. Keep visible text, narration, captions and production notes separate. Do not insert notes or procedural filler into narration/captions.
2. Call `muweave_create_draft` with a unique stable `projectId`, one ISO UTC `createdAt`, title and scenes. Reuse ID/time when retrying. Coordinates are pixels in a 1920 × 1080 canvas; times are integer microseconds. Set `gapUs: 0` unless a pause is intentional.
3. Compose legible text/shape layouts with clear hierarchy. Use Roboto or Noto Sans SC. This remote version does not accept assets, audio, image nodes, font uploads, file paths or URLs. Do not invent asset IDs. Describe desired media in production notes for later import.
4. Inspect returned validation issues and preview. An empty issue list checks structure and timing, not facts, typography or listening quality.

## Revise without mixing projects

Take the complete latest `structuredContent.project` for the intended project. Call `muweave_apply_commands` with that `snapshot`, matching `projectId`, `batch.expectedRevision`, a new `batch.requestId`, commands and an ISO UTC `editedAt` at or after the previous update. Use `node.update` to preserve unrelated styling. Use `scene.remove` to delete a scene; at least one must remain.

Retry the exact same snapshot, batch and timestamp after a transport failure. A replay produces the same output; there is no persistent receipt registry. Sending a newly returned snapshot with the old expectedRevision must fail. If the user switches projects, use that project's own snapshot; do not substitute a similarly named scene or a previous conversation's project. Without a full snapshot, ask the user to supply it or create a new draft. IDs, request IDs and MCP sessions are not user identities or authorization.

## Handoff

Use `muweave_preview` to show the current canvas. The user can download a `.muweave.zip` through the host and open https://muweave.vercel.app/ → project list → 打开工程包. A host without download support can save the complete returned project as `project.json`; the same import picker accepts it. Do not place private project contents in public URLs, query strings or shared files.

The website imports a new local project, never overwrites an existing one by matching ID. Add pictures and narration there. PNG/MP4 rendering and packaging run in the browser; this MCP cannot start background exports or retrieve browser files. ChatGPT account changes do not clear or isolate the website's browser storage.
