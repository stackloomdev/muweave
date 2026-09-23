import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExample } from '../../packages/core/src/example';
import { boot, call, start, waitJob, output } from './helpers';

async function draft(title: string) {
  const c = new Client({ name: 'muweave-e2e', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4287/api/mcp')));
  try {
    const scenes = createExample().scenes.slice(0, 2);
    scenes[0].nodes.find((n) => n.id === 'title')!.text = title;
    return await c.callTool({
      name: 'muweave_create_draft',
      arguments: {
        projectId: 'identical-id',
        title,
        createdAt: '2026-09-24T00:00:00.000Z',
        scenes,
      },
    });
  } finally {
    await c.close();
  }
}
async function mountHost(page: Page, results: unknown[], downloads = true) {
  const resourceClient = new Client({ name: 'widget-resource-test', version: '1.0.0' });
  await resourceClient.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4287/api/mcp')),
  );
  let html: string;
  try {
    const { contents } = await resourceClient.readResource({ uri: 'ui://muweave/draft-v1.html' });
    expect(contents[0].mimeType).toBe('text/html;profile=mcp-app');
    if (!('text' in contents[0])) throw new Error('Expected a text HTML resource');
    html = contents[0].text;
    expect(html).not.toContain('工程 A · 语音里的信息');
  } finally {
    await resourceClient.close();
  }
  await page.route('https://muweave.vercel.app/fonts/**', async (route) => {
    await route.fulfill({
      contentType: 'font/woff2',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: await readFile(
        'apps/studio/public/fonts/woff2/' + basename(new URL(route.request().url()).pathname),
      ),
    });
  });
  await page.route('**/__mcp-test-host__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#ddd"></body></html>',
    }),
  );
  await page.goto('/__mcp-test-host__');
  await page.evaluate(
    ({ html, results, downloads }) => {
      const frames: HTMLIFrameElement[] = [];
      (window as any).hostDownloads = [];
      window.addEventListener('message', (e) => {
        const index = frames.findIndex((f) => f.contentWindow === e.source);
        if (index < 0 || !e.data || e.data.jsonrpc !== '2.0') return;
        const frame = frames[index],
          message = e.data;
        const reply = (result: unknown) =>
          frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
        if (message.method === 'ui/initialize')
          reply({
            protocolVersion: message.params.protocolVersion,
            hostInfo: { name: 'Muweave test host', version: '1.0.0' },
            hostCapabilities: { ...(downloads ? { downloadFile: {} } : {}), openLinks: {} },
            hostContext: {
              theme: 'light',
              displayMode: 'inline',
              availableDisplayModes: ['inline'],
              platform: 'web',
            },
          });
        else if (message.method === 'ui/notifications/initialized') {
          frame.contentWindow!.postMessage(
            { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } },
            '*',
          );
          frame.contentWindow!.postMessage(
            { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: results[index] },
            '*',
          );
        } else if (message.method === 'ui/download-file') {
          (window as any).hostDownloads.push({ index, params: message.params });
          reply({});
        } else if (message.id !== undefined) reply({});
      });
      for (let i = 0; i < results.length; i++) {
        const iframe = document.createElement('iframe');
        iframe.id = 'widget-' + i;
        iframe.title = 'Muweave ' + i;
        iframe.style.cssText = 'width:700px;height:1000px;border:0;vertical-align:top;';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        frames.push(iframe);
        document.body.append(iframe);
        iframe.srcdoc = html;
      }
    },
    { html, results, downloads },
  );
}

test('MCP canvas instances stay isolated and hand off a real bundle to the browser editor', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const [a, b] = await Promise.all([draft('工程 A · 语音里的信息'), draft('工程 B · 独立的故事')]);
  await mountHost(page, [a, b]);
  const first = page.frameLocator('#widget-0'),
    second = page.frameLocator('#widget-1');
  await expect(first.getByRole('heading', { level: 1 })).toHaveText('工程 A · 语音里的信息');
  await expect(second.getByRole('heading', { level: 1 })).toHaveText('工程 B · 独立的故事');
  await expect(first.getByRole('region', { name: '场景画布' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(second.getByRole('region', { name: '场景画布' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await first.getByRole('navigation').getByRole('button').nth(1).click();
  await expect(first.getByRole('navigation').getByRole('button').nth(1)).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(second.getByRole('navigation').getByRole('button').nth(0)).toHaveAttribute(
    'aria-current',
    'page',
  );
  // A sibling iframe must not be able to impersonate the host and replace another result.
  await second.locator('body').evaluate((_, forged) => {
    (
      window.parent.document.querySelector('#widget-0') as HTMLIFrameElement
    ).contentWindow!.postMessage(
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: forged },
      '*',
    );
  }, b);
  await first.getByRole('button', { name: '下载工程包', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).hostDownloads.length)).toBe(1);
  const file = await page.evaluate(
    () => (window as any).hostDownloads[0].params.contents[0].resource,
  );
  const bytes = Buffer.from(file.blob, 'base64');
  const p = JSON.parse(strFromU8(unzipSync(bytes)['project.json']));
  expect(p.title).toBe('工程 A · 语音里的信息');
  expect(JSON.stringify(p)).not.toContain('工程 B');
  const editor = await context.newPage();
  await boot(editor);
  await editor.getByRole('button', { name: '打开工程列表' }).click();
  const chooser = editor.waitForEvent('filechooser');
  await editor.getByRole('button', { name: '打开工程包', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: 'draft.muweave.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(
    editor.getByRole('button', { name: '工程 A · 语音里的信息', exact: true }),
  ).toBeVisible();
  const importedId = await editor.evaluate(() => localStorage.getItem('muweave-project')!);
  expect(importedId).not.toBe(p.id);
  const imported = await call(editor, 'client', 'store.get', [importedId]);
  expect(imported.scenes).toEqual(p.scenes);
  const exportJob = await start(editor, importedId, 'png', { sceneId: imported.scenes[0].id });
  expect((await waitJob(editor, exportJob.id)).status).toBe('succeeded');
  const png = await output(editor, exportJob.id);
  expect(png.readUInt32BE(16)).toBe(1920);
  expect(png.readUInt32BE(20)).toBe(1080);
  await page.screenshot({ path: 'test-results/mcp-two-canvases.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('unsupported host downloads show JSON handoff; JSON imports create new projects and reject media', async ({
  page,
  context,
}) => {
  const result = await draft('JSON 交接示例');
  await mountHost(page, [result], false);
  const widget = page.frameLocator('#widget-0');
  await expect(widget.getByRole('button', { name: '下载工程包', exact: true })).toBeDisabled();
  await expect(widget.getByText('当前宿主未提供文件下载。', { exact: false })).toBeVisible();
  const p = (result.structuredContent as any).project;
  const editor = await context.newPage();
  await boot(editor);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const previousId = await editor.evaluate(() => localStorage.getItem('muweave-project'));
    await editor.getByRole('button', { name: '打开工程列表' }).click();
    const chooser = editor.waitForEvent('filechooser');
    await editor.getByRole('button', { name: '打开工程包', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'project.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(p)),
    });
    await expect
      .poll(() => editor.evaluate(() => localStorage.getItem('muweave-project')))
      .not.toBe(previousId);
    await expect(editor.getByRole('button', { name: 'JSON 交接示例', exact: true })).toBeVisible();
    ids.push(await editor.evaluate(() => localStorage.getItem('muweave-project')!));
  }
  expect(new Set([...ids, p.id]).size).toBe(3);
  const invalid = structuredClone(p);
  invalid.scenes[0].nodes.push({
    ...invalid.scenes[0].nodes[0],
    id: 'foreign-image',
    type: 'image',
    assetId: 'guessed-asset',
  });
  const outcome = await editor.evaluate(async (snapshot) => {
    const path = '/src/bundles.ts';
    const { importBundle } = await import(/* @vite-ignore */ path);
    try {
      await importBundle(
        new File([JSON.stringify(snapshot)], 'project.json', { type: 'application/json' }),
      );
      return 'accepted';
    } catch {
      return 'rejected';
    }
  }, invalid);
  expect(outcome).toBe('rejected');
  const projects = await call(editor, 'client', 'store.list');
  expect(projects.filter((entry: any) => entry.title === p.title)).toHaveLength(2);
});
