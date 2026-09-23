# Codex / native WebMCP

Start Muweave following the root README. Open its static-site URL in the Codex in-app browser using the currently installed Browser plugin's documented initialization and tab navigation APIs. Plugin paths and APIs vary by installation; do not hardcode a developer's cache path.

Discover the tab's native WebMCP tools. On a supported browser the page registers 16 tools; discovery plus a successful call establishes the connection. If tools are unavailable, inspect browser support and page errors. Manual UI editing remains available. HTTP access alone is not evidence of native WebMCP support.

## Edit loop

1. `app.get_capabilities` → inspect the current build's limits.
2. `project.list`, then `project.open`, or `project.create` with a title.
3. `project.get_state` with `scope: "summary"`; read `scope: "scene"` for stable node IDs and properties.
4. `project.apply_commands` using the latest `expectedRevision` and a fresh `requestId`.
5. Read back the target scene, inspect the visible canvas, and use `project.validate` for missing references, timings and text overflow.

Example payload to `project.apply_commands` (replace the revision and IDs with those actually read):

```json
{
  "projectId": "welcome",
  "expectedRevision": 0,
  "requestId": "edit-title-001",
  "label": "更新第一张标题",
  "commands": [
    {
      "type": "node.update",
      "sceneId": "scene-1",
      "nodeId": "title",
      "changes": { "text": "语音不只是文字" }
    }
  ]
}
```

Use `changes`, not `patch`. Omitted properties remain unchanged. Atomic batches support at most 500 commands. Do not bypass the browser transaction service. On a revision conflict, read the latest state; do not blindly force a new revision. Retry an uncertain submission with its exact original body and request ID.

## Import host-generated files

1. Generate the image or narration using the host's own tools. Keep production notes out of speech and captions.
2. Call `assets.prepare_import` for the target project.
3. Click the visible **选择 Agent 素材** button in the asset panel and use the Browser plugin's documented file chooser API to select one local file. The returned input ID is `muweave-agent-file`. No upload URL, HTTP server or direct filesystem access is used by the page.
4. Read `assets.import_status` with the returned `importId` until `status` is `ready`. The response includes measured metadata or an actionable import error.
5. Refresh the project's revision and call `assets.import` with the same `importId`, current `expectedRevision` and a new `requestId`.
6. Use the returned `asset.id` in `node.add` or `narration.set`. Read measured `durationUs` for audio; never estimate it from script length.

Importing an asset alone does not place it on the canvas. For narration, use `fitDuration: true` to fit the scene to the actual trimmed audio. Captions use scene-local times; do not invent aligned timestamps from word counts.

## Rhythm and export

`timeline.analyze` returns edge-trim suggestions and gap information without changing the project. Review suggestions, then submit `narration.set` and `timeline.set_gap` as needed. Internal pauses remain intact. Use `preview.seek` to show the relevant point in the visible canvas.

`variant.create` creates an independent 4:3 cover; node commands target it by passing both the source `sceneId` and the `variantId`. Reflow dense content after creation. Export with `export.start`, then poll `jobs.get` at reasonable intervals. A successful job supplies a download URL; check status and report before claiming completion. `jobs.cancel` cancels a queued or running job.

All exports run in this page. MP4 uses ffmpeg.wasm, PNG uses Canvas, and bundles use browser ZIP processing. `engine` is optional; native mode is removed. Keep the owning page open until completion. Poll the returned job rather than starting duplicates; a fresh retry after failure/cancellation needs a new request ID.

Completed files and reports remain in IndexedDB after reload. `jobs.get` returns a temporary `blob:` URL that belongs to the current browser session; use the page download link rather than requesting it from a shell. Refresh tool discovery after navigation. Project storage is scoped to the browser origin; export/import a bundle to move between hosts or devices.

| Tool                                                             | Purpose                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| `app.get_capabilities`                                           | Build limits and command names                       |
| `project.list`, `project.create`, `project.open`                 | Project lifecycle                                    |
| `project.get_state`, `project.apply_commands`                    | Versioned edits                                      |
| `project.history`                                                | List, undo, redo                                     |
| `assets.prepare_import`, `assets.import_status`, `assets.import` | Host-file handoff                                    |
| `project.validate`                                               | Timing/reference/overflow checks; not factual review |
| `timeline.analyze`                                               | Non-destructive edge/gap analysis                    |
| `preview.seek`                                                   | Move the visible preview                             |
| `export.start`, `jobs.get`, `jobs.cancel`                        | Export lifecycle                                     |

The authoritative command types and field constraints live in `packages/schema/src/index.ts`. In particular, time values are integer microseconds and scene order commands must include every scene exactly once.
