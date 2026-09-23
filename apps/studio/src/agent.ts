import { registerTools, type Definition } from '@muweave/webmcp';
import { type Project } from '@muweave/schema';
import { duration, timeline } from '@muweave/core';
import { measureText, loadAssets } from '@muweave/renderer';
import {
  store,
  loadProject,
  apply,
  validate,
  analyzeTimeline,
  capabilities,
  commitImport,
  importStatus,
  getJob,
} from './client';
import { startExport, cancelExport, browserExportCapabilities } from './exports';
const string = { type: 'string' },
  number = { type: 'integer', minimum: 0 },
  object = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
type Controller = {
  project: () => Project | null;
  sceneId: () => string;
  selectedIds: () => string[];
  open: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  seek: (us: number, sceneId?: string) => void;
  prepareImport: (projectId: string) => Promise<unknown>;
};
export function connectAgent(c: Controller) {
  const projectId = (i: any) => i.projectId ?? c.project()?.id;
  const p = async (i: any) => {
    const id = projectId(i);
    if (!id) throw new Error('请先创建或打开工程');
    return loadProject(id);
  };
  const tools: Definition[] = [
    {
      name: 'app.get_capabilities',
      description:
        'Read Muweave capabilities, browser export support and supported command names. Generation happens in your host tools, then assets are selected with the browser file chooser.',
      inputSchema: object({}),
      readOnly: true,
      execute: async () => ({
        ...capabilities(),
        browserExport: browserExportCapabilities(),
      }),
    },
    {
      name: 'project.list',
      description: 'List projects saved in this browser.',
      inputSchema: object({}),
      readOnly: true,
      execute: () => store.list(),
    },
    {
      name: 'project.create',
      description:
        'Create and open a browser-stored editable video project. example=true includes original three-scene sample content.',
      inputSchema: object({ title: string, example: { type: 'boolean' } }, ['title']),
      execute: async (i) => {
        const r = await store.create(i.title, i.example);
        await c.open(r.id);
        return { projectId: r.id, revision: r.revision };
      },
    },
    {
      name: 'project.open',
      description: 'Open an existing browser project by its ID.',
      inputSchema: object({ projectId: string }, ['projectId']),
      execute: async (i) => {
        await c.open(i.projectId);
        return { projectId: i.projectId };
      },
    },
    {
      name: 'project.get_state',
      description:
        'Read latest revision and stable scene/node IDs. Defaults to summary; use scope=scene for editable node properties or scope=full for the complete project. Notes are production data, not narration.',
      inputSchema: object({
        projectId: string,
        scope: { type: 'string', enum: ['summary', 'scene', 'full'] },
        sceneId: string,
      }),
      readOnly: true,
      execute: async (i) => {
        const doc = await p(i);
        if (i.scope === 'full') return doc;
        if (i.scope === 'scene')
          return {
            revision: doc.revision,
            scene: doc.scenes.find((s) => s.id === (i.sceneId ?? c.sceneId())),
            assets: doc.assets,
            variants: doc.variants,
          };
        return {
          projectId: doc.id,
          title: doc.title,
          revision: doc.revision,
          durationUs: duration(doc),
          activeSceneId: c.sceneId(),
          selectedNodeIds: c.selectedIds(),
          scenes: timeline(doc).map(({ scene, startUs }) => ({
            id: scene.id,
            title: scene.title,
            startUs,
            durationUs: scene.durationUs,
            nodeCount: scene.nodes.length,
            hasNarration: !!scene.narration,
            captionCount: scene.captions.length,
          })),
          assets: Object.values(doc.assets),
          variants: doc.variants.map(({ nodes, ...v }) => ({ ...v, nodeCount: nodes.length })),
        };
      },
    },
    {
      name: 'project.apply_commands',
      description:
        'Atomically edit via typed commands. Read the latest revision first. Retry only with the same requestId and identical body. Commands include node.update {sceneId,nodeId,changes}, scene.update {sceneId,changes}, node.add {sceneId,node}, scene.reorder {ids}, narration.set {sceneId,narration,fitDuration}, captions.set {sceneId,captions}, timeline.set_gap {gapUs}, variant.create {sceneId,id,title}. All times are integer microseconds. node fields: id,type(text/image/rect/ellipse/line),x,y,width,height,text,fontSize,fill,bold,assetId. Read scope=scene for examples. Changes are validated, never arbitrary code.',
      inputSchema: object(
        {
          projectId: string,
          expectedRevision: number,
          requestId: string,
          label: string,
          commands: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'project.rename',
                    'project.captions',
                    'scene.add',
                    'scene.duplicate',
                    'scene.remove',
                    'scene.reorder',
                    'scene.update',
                    'node.add',
                    'node.update',
                    'node.remove',
                    'node.reorder',
                    'nodes.group',
                    'narration.set',
                    'captions.set',
                    'music.set',
                    'timeline.set_gap',
                    'variant.create',
                  ],
                },
                sceneId: string,
                variantId: string,
                nodeId: string,
                changes: { type: 'object' },
                node: { type: 'object' },
                scene: { type: 'object' },
                newId: string,
                afterId: string,
                id: string,
                ids: { type: 'array', items: string },
                groupId: { type: ['string', 'null'] },
                title: string,
                visible: { type: 'boolean' },
                gapUs: number,
                narration: { type: ['object', 'null'] },
                fitDuration: { type: 'boolean' },
                captions: { type: 'array', items: { type: 'object' } },
                music: { type: ['object', 'null'] },
              },
              required: ['type'],
              additionalProperties: false,
            },
          },
        },
        ['expectedRevision', 'requestId', 'commands'],
      ),
      execute: async (i) => {
        const { projectId: id, ...batch } = i;
        const r = await apply(id ?? projectId(i), batch);
        await c.refresh();
        return r;
      },
    },
    {
      name: 'project.history',
      description:
        'Read history or undo/redo one atomic edit. Mutation requires expectedRevision and requestId.',
      inputSchema: object({
        projectId: string,
        action: { type: 'string', enum: ['list', 'undo', 'redo'] },
        expectedRevision: number,
        requestId: string,
      }),
      execute: async (i) => {
        if (!i.action || i.action === 'list') return store.history(projectId(i));
        const r = await store.mutate(projectId(i), {
          action: i.action,
          expectedRevision: i.expectedRevision,
          requestId: i.requestId,
        });
        await c.refresh();
        return r;
      },
    },
    {
      name: 'assets.prepare_import',
      description:
        'Prepare a browser file handoff for one image/audio/font. Opens the asset panel with 选择 Agent 素材. Click it and use the browser file chooser to select the generated file, then read assets.import_status and call assets.import. No HTTP upload or local-path input.',
      inputSchema: object({ projectId: string }),
      execute: (i) => c.prepareImport(projectId(i)),
    },
    {
      name: 'assets.import_status',
      description:
        'Read browser file handoff status and measured asset metadata. Wait for ready before committing.',
      inputSchema: object({ importId: string }, ['importId']),
      readOnly: true,
      execute: async (i) => importStatus(i.importId),
    },
    {
      name: 'assets.import',
      description:
        'Commit a prepared browser file into the project. Returns assetId and measured metadata; attach it with node.add or narration.set.',
      inputSchema: object(
        { projectId: string, importId: string, expectedRevision: number, requestId: string },
        ['importId', 'expectedRevision', 'requestId'],
      ),
      execute: async (i) => {
        const { projectId: id, ...body } = i,
          r = await commitImport(
            id ?? projectId(i),
            body.importId,
            body.expectedRevision,
            body.requestId,
          );
        await c.refresh();
        return r;
      },
    },
    {
      name: 'project.validate',
      description:
        'Check timings, missing files and text overflow. This does not fact-check prose.',
      inputSchema: object({ projectId: string }),
      readOnly: true,
      execute: async (i) => {
        const doc = await p(i);
        await loadAssets(doc);
        const report = await validate(doc.id);
        return { ...report, issues: [...report.issues, ...measureText(doc)] };
      },
    },
    {
      name: 'timeline.analyze',
      description:
        'Analyze narration edges and inter-scene gaps. Returns non-destructive trim suggestions; preserves sentence-internal pauses. No changes until commands are submitted.',
      inputSchema: object({ projectId: string }),
      readOnly: true,
      execute: async (i) => analyzeTimeline(await p(i)),
    },
    {
      name: 'preview.seek',
      description:
        'Move visible preview to an absolute time in integer microseconds, optionally choosing a scene.',
      inputSchema: object({ timeUs: number, sceneId: string }, ['timeUs']),
      execute: async (i) => {
        c.seek(i.timeUs, i.sceneId);
        return { timeUs: i.timeUs };
      },
    },
    {
      name: 'export.start',
      description:
        'Export a frozen revision entirely in this browser: ffmpeg.wasm for MP4, Canvas for PNG, browser ZIP for bundles. Keep this page open until jobs.get succeeds. Edits can continue; variantId selects a static cover.',
      inputSchema: object(
        {
          projectId: string,
          expectedRevision: number,
          requestId: string,
          format: { type: 'string', enum: ['mp4', 'png', 'bundle'] },
          engine: { type: 'string', enum: ['wasm', 'browser'] },
          sceneId: string,
          variantId: string,
        },
        ['expectedRevision', 'requestId', 'format'],
      ),
      execute: async (i) => {
        const { projectId: id, ...body } = i;
        return startExport(id ?? projectId(i), {
          ...body,
        });
      },
    },
    {
      name: 'jobs.get',
      description:
        'Read browser-persisted export state and a temporary Blob download URL. Use the page download link; Blob URLs belong to this browser session.',
      inputSchema: object({ jobId: string }, ['jobId']),
      readOnly: true,
      execute: async (i) => {
        return getJob(i.jobId);
      },
    },
    {
      name: 'jobs.cancel',
      description: 'Cancel a queued or running export and terminate its browser worker.',
      inputSchema: object({ jobId: string }, ['jobId']),
      execute: (i) => cancelExport(i.jobId),
    },
  ];
  return registerTools(tools);
}
