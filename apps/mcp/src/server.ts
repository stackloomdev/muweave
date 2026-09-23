import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { DomainError } from '@muweave/core';
import { commandSchema, type Project } from '@muweave/schema';
import {
  applyDraftSchema,
  createDraftSchema,
  snapshotSchema,
  createDraft,
  editDraft,
  readDraft,
  describeDraft,
  DRAFT_LIMITS,
} from '../../../packages/mcp/src/drafts';

export const WIDGET_URI = 'ui://muweave/draft-v1.html';
export type ServerOptions = { siteOrigin: string; widgetHtml: string };
export function draftResult(run: () => Project): CallToolResult {
  try {
    const p = run();
    return {
      content: [
        {
          type: 'text',
          text: `${p.title}：${p.scenes.length} 页，版本 ${p.revision}。完整工程在 structuredContent.project。此结果没有保存到服务器；下一次修改须传入这份快照。`,
        },
      ],
      structuredContent: describeDraft(p),
    };
  } catch (e) {
    const code =
      e instanceof DomainError
        ? e.code
        : e instanceof z.ZodError
          ? 'INVALID_INPUT'
          : 'PROCESSING_FAILED';
    const message = e instanceof DomainError ? e.message : '分镜数据不符合格式要求，请检查输入。';
    return {
      isError: true,
      content: [{ type: 'text', text: message }],
      structuredContent: { error: { code, message } },
    };
  }
}

/** Construct once per HTTP request. Never put projects, client credentials or tool results in module state. */
export function createMuweaveServer(options: ServerOptions) {
  const server = new McpServer(
    { name: 'muweave', version: '0.1.0' },
    {
      instructions:
        'Muweave transforms caller-supplied text/shape draft snapshots. It has no accounts, project database, session memory, file access or rendering jobs. Always pass the latest full project for the intended draft. IDs and MCP sessions do not retrieve data. Use the returned canvas to download a bundle; import it on the website for media and browser export. Keep notes separate from narration and captions.',
    },
  );
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const metadata = {
    securitySchemes: [{ type: 'noauth' }],
    ui: { resourceUri: WIDGET_URI },
    'openai/outputTemplate': WIDGET_URI,
  };
  server.registerTool(
    'muweave_capabilities',
    {
      title: '幕织分镜能力',
      description:
        'Read limits and editing commands for stateless Muweave drafts. No project or user data is stored.',
      inputSchema: z.object({}).strict(),
      annotations,
      _meta: { securitySchemes: [{ type: 'noauth' }] },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: '创建文字/形状分镜 → 传入完整快照修改 → 预览 → 下载工程包 → 网页导入素材并导出视频。工具不生成图片、配音或视频，也不查询历史工程。',
        },
      ],
      structuredContent: {
        mode: 'stateless',
        limits: DRAFT_LIMITS,
        timeUnit: 'integer-microseconds',
        width: 1920,
        height: 1080,
        fps: 30,
        commands: commandSchema.options
          .map((s) => s.shape.type.value)
          .filter((name) => !['asset.add', 'narration.set', 'music.set'].includes(name)),
        persistence: false,
        media: false,
        serverExport: false,
        retries:
          'Identical snapshot, batch and timestamp produce identical output. No cross-request receipt storage or global latest-version check.',
      },
    }),
  );
  server.registerTool(
    'muweave_create_draft',
    {
      title: '创建幕织分镜',
      description:
        'Create an editable 16:9 draft from explicit scenes. Text and shapes only. Choose stable projectId and UTC createdAt once, then reuse them on retries. Returns the complete unsaved project and canvas.',
      inputSchema: createDraftSchema,
      annotations,
      _meta: metadata,
    },
    async (input) => draftResult(() => createDraft(input)),
  );
  server.registerTool(
    'muweave_apply_commands',
    {
      title: '修改幕织分镜',
      description:
        'Transform a full caller-supplied snapshot using the same atomic editing commands as the editor. Require matching projectId and expectedRevision. Return a new snapshot; no server state changes. Reuse snapshot, batch and editedAt on retries.',
      inputSchema: applyDraftSchema,
      annotations,
      _meta: metadata,
    },
    async (input) => draftResult(() => editDraft(input)),
  );
  server.registerTool(
    'muweave_preview',
    {
      title: '预览幕织分镜',
      description:
        'Preview a complete caller-supplied text/shape project in a canvas. No ID-only project lookup. Includes scene timeline and validation issues; download the bundle from the component.',
      inputSchema: snapshotSchema,
      annotations,
      _meta: metadata,
    },
    async (input) => draftResult(() => readDraft(input)),
  );
  server.registerTool(
    'muweave_validate',
    {
      title: '检查幕织分镜',
      description:
        'Check schema, IDs, timing, references and canvas bounds of a complete draft snapshot. This is not a factual review of its writing.',
      inputSchema: snapshotSchema,
      annotations,
      _meta: { securitySchemes: [{ type: 'noauth' }] },
    },
    async (input) => draftResult(() => readDraft(input)),
  );
  server.registerResource(
    'muweave-canvas',
    WIDGET_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: 'Static canvas component. Contains no project or user content.',
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: options.widgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [options.siteOrigin] },
            },
            'openai/widgetDescription':
              '幕织分镜预览，可切换场景并下载工程包；在网页导入素材后导出视频。',
          },
        },
      ],
    }),
  );
  return server;
}
