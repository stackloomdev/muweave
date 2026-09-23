import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpHandler, MAX_REQUEST_BYTES } from '../apps/mcp/src/http';
import { createNodeHandler } from '../apps/mcp/src/node';
import { WIDGET_URI } from '../apps/mcp/src/server';
import { createDraft, editDraft, DRAFT_LIMITS } from '../packages/mcp/src/drafts';
import { blankScene } from '@muweave/core';
import { type Project } from '@muweave/schema';

const time = '2026-09-24T00:00:00.000Z';
const input = (title = 'A-private') => ({
  projectId: 'same-project',
  createdAt: time,
  title,
  scenes: [blankScene('same-scene', title)],
});
const edit = (snapshot: Project, title: string) => ({
  projectId: snapshot.id,
  snapshot,
  editedAt: time,
  batch: {
    expectedRevision: snapshot.revision,
    requestId: 'same-request',
    commands: [{ type: 'project.rename' as const, title }],
  },
});
let http: Server, url: URL;
const clients: Client[] = [];
async function client() {
  const c = new Client({ name: 'isolation-test', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(url));
  clients.push(c);
  return c;
}
const project = (result: any): Project => {
  expect(result.isError).not.toBe(true);
  return result.structuredContent.project;
};

beforeAll(async () => {
  const handle = createMcpHandler({
    siteOrigin: 'https://muweave.vercel.app',
    widgetHtml: '<html>public component, no user data</html>',
  });
  const nodeHandler = createNodeHandler(handle, 'http://127.0.0.1');
  http = createServer(async (req, res) => {
    if (req.headers['x-test-parsed-body'] === 'yes') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const parsed = JSON.parse(Buffer.concat(chunks).toString());
      Object.defineProperty(req, 'body', { get: () => parsed });
    }
    await nodeHandler(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/api/mcp`);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

describe('remote MCP request isolation over real HTTP', () => {
  it('discovers only stateless tools and public resources, with no data lookup route', async () => {
    const c = await client();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'muweave_apply_commands',
      'muweave_capabilities',
      'muweave_create_draft',
      'muweave_preview',
      'muweave_validate',
    ]);
    const create = tools.find((t) => t.name === 'muweave_create_draft')!;
    expect(create._meta?.ui).toEqual({ resourceUri: WIDGET_URI });
    expect(create.inputSchema.required).toContain('scenes');
    expect((await c.listResources()).resources.map((r) => r.uri)).toEqual([WIDGET_URI]);
    const a = project(
      await c.callTool({ name: 'muweave_create_draft', arguments: input('secret-A') }),
    );
    expect(a.title).toBe('secret-A');
    const b = await client();
    const missing = await b.callTool({ name: 'muweave_preview', arguments: { projectId: a.id } });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing)).not.toContain('secret-A');
    for (const name of ['project.list', 'project.get_state', 'assets.get', 'jobs.get']) {
      const r = await b.callTool({
        name,
        arguments: { projectId: a.id, assetId: 'a', jobId: 'j' },
      });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r)).not.toContain('secret-A');
    }
    await expect(b.readResource({ uri: `project://${a.id}` })).rejects.toThrow();
    expect(JSON.stringify(await b.readResource({ uri: WIDGET_URI }))).not.toContain('secret-A');
  });
  it('keeps 24 concurrent clients isolated even with identical project/request/scene IDs', async () => {
    const outputs = await Promise.all(
      Array.from({ length: 24 }, async (_, index) => {
        const c = await client();
        const p = project(
          await c.callTool({ name: 'muweave_create_draft', arguments: input(`private-${index}`) }),
        );
        const edited = project(
          await c.callTool({
            name: 'muweave_apply_commands',
            arguments: edit(p, `edited-${index}`),
          }),
        );
        return { index, p, edited };
      }),
    );
    for (const { index, p, edited } of outputs) {
      expect(p.title).toBe(`private-${index}`);
      expect(p.revision).toBe(0);
      expect(edited.title).toBe(`edited-${index}`);
      expect(edited.revision).toBe(1);
      expect(edited.scenes[0].title).toBe(`private-${index}`);
    }
  });
  it('rejects mismatched project, stale revision and invalid batch without changing later requests', async () => {
    const c = await client(),
      p = createDraft(input());
    const good = edit(p, 'edited');
    for (const bad of [
      { ...good, projectId: 'another-project' },
      { ...good, batch: { ...good.batch, expectedRevision: 8 } },
      {
        ...good,
        batch: {
          ...good.batch,
          commands: [...good.batch.commands, { type: 'scene.remove', sceneId: 'missing' }],
        },
      },
    ]) {
      expect((await c.callTool({ name: 'muweave_apply_commands', arguments: bad })).isError).toBe(
        true,
      );
    }
    expect(
      project(
        await c.callTool({ name: 'muweave_preview', arguments: { projectId: p.id, snapshot: p } }),
      ),
    ).toEqual(p);
    const next = project(await c.callTool({ name: 'muweave_apply_commands', arguments: good }));
    expect(next.title).toBe('edited');
    expect(next.revision).toBe(1);
    expect(
      (await c.callTool({ name: 'muweave_apply_commands', arguments: { ...good, snapshot: next } }))
        .isError,
    ).toBe(true);
  });
  it('retries deterministically without retaining request receipts or mutating the supplied snapshot', async () => {
    const a = await client(),
      b = await client(),
      args = input();
    const p = project(await a.callTool({ name: 'muweave_create_draft', arguments: args }));
    expect(project(await b.callTool({ name: 'muweave_create_draft', arguments: args }))).toEqual(p);
    const request = edit(p, 'repeatable');
    const one = await a.callTool({ name: 'muweave_apply_commands', arguments: request });
    const two = await b.callTool({ name: 'muweave_apply_commands', arguments: request });
    expect(two).toEqual(one);
    expect(p.title).toBe('A-private');
    expect(p.revision).toBe(0);
  });
  it('rejects files, media references, unexpected identity fields and oversized drafts', async () => {
    const c = await client(),
      p = createDraft(input());
    const media = structuredClone(p);
    media.assets.voice = {
      id: 'voice',
      name: 'private.wav',
      kind: 'audio',
      file: 'a'.repeat(64) + '.wav',
      sha256: 'a'.repeat(64),
      mime: 'audio/wav',
      bytes: 44,
    };
    for (const snapshot of [
      media,
      { ...p, file: '/private/users/B/project.json' },
      { ...p, userId: 'B' },
    ]) {
      expect(
        (await c.callTool({ name: 'muweave_preview', arguments: { projectId: p.id, snapshot } }))
          .isError,
      ).toBe(true);
    }
    const huge = structuredClone(p);
    huge.scenes = Array.from({ length: 4 }, (_, i) => ({
      ...huge.scenes[0],
      id: `s${i}`,
      notes: '字'.repeat(20000),
    }));
    const result = await c.callTool({
      name: 'muweave_preview',
      arguments: { projectId: huge.id, snapshot: huge },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'DRAFT_LIMIT' } });
    const unsafeTime = { ...p, updatedAt: 'not-a-date' };
    expect(() => editDraft(edit(unsafeTime, 'x'))).toThrow();
    expect(DRAFT_LIMITS.bytes).toBe(128 * 1024);
  });
  it('handles Vercel-style already-consumed requests without a shared body cache', async () => {
    const responses = await Promise.all(
      ['helper-A', 'helper-B'].map(async (title) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'x-test-parsed-body': 'yes',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'muweave_create_draft', arguments: input(title) },
          }),
        });
        expect(r.status).toBe(200);
        return (await r.json()).result.structuredContent.project.title;
      }),
    );
    expect(responses).toEqual(['helper-A', 'helper-B']);
  });
  it('does not cache results or mint sessions; rejects origins and bounded-body overflow', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'muweave_create_draft', arguments: input() },
    });
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    };
    const ok = await fetch(url, { method: 'POST', headers, body });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('no-store');
    expect(ok.headers.has('mcp-session-id')).toBe(false);
    const denied = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://other.example' },
      body,
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('A-private');
    const tooBig = await fetch(url, {
      method: 'POST',
      headers,
      body: ' '.repeat(MAX_REQUEST_BYTES + 1),
    });
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers.get('cache-control')).toContain('no-store');
    const stream = await fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream' } });
    expect(stream.status).toBe(405);
  });
});
