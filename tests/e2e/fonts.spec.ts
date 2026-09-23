import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { create, state, edit, start, waitJob, output, job as getJob } from './helpers';
test('uses bundled Google fonts with legacy-name migration and no external or API requests', async ({
  page,
}) => {
  const forbidden: string[] = [],
    fontRequests: string[] = [],
    fonts = new Map<string, number>();
  const manifest = JSON.parse(
    readFileSync(new URL('../../apps/studio/public/fonts/SOURCES.json', import.meta.url), 'utf8'),
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol !== 'blob:' && url.origin !== 'http://127.0.0.1:4285') ||
      url.pathname.startsWith('/api/')
    ) {
      forbidden.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  page.on('response', (r) => {
    if (r.ok() && r.url().endsWith('.woff2'))
      fonts.set(new URL(r.url()).pathname, Number(r.headers()['content-length']));
  });
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fontRequests.push(new URL(r.url()).pathname);
  });
  const p = await create(page, 'Google Fonts 字体验证');
  await edit(page, p.id, [
    {
      type: 'node.update',
      sceneId: 'scene-1',
      nodeId: 'label-1',
      changes: { text: 'Google Fonts · 中文', fontFamily: 'Manrope Variable' },
    },
  ]);
  expect(
    (await state(page, p.id)).scenes[0].nodes.find((n: any) => n.id === 'label-1').fontFamily,
  ).toBe('Roboto');
  await page.reload();
  await page.locator('.inspector-tabs').getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '整理内容', exact: true }).click();
  const picker = page.getByRole('combobox', { name: '字体', exact: true });
  await expect(picker).toHaveValue('Roboto');
  await expect(picker.locator('option')).toHaveText(['Noto Sans SC', 'Roboto']);
  await picker.selectOption('Noto Sans SC');
  await expect.poll(async () => (await state(page, p.id)).revision).toBe(2);
  await picker.selectOption('Roboto');
  await expect.poll(async () => (await state(page, p.id)).revision).toBe(3);
  const job = await start(page, p.id, 'png', { sceneId: 'scene-1' });
  await waitJob(page, job.id);
  const meta = await sharp(await output(page, job.id)).metadata();
  expect([meta.width, meta.height]).toEqual([1920, 1080]);
  expect([...fonts.keys()].some((f) => f.includes('/roboto-'))).toBe(true);
  expect([...fonts.keys()].some((f) => f.includes('/noto-sans-sc-'))).toBe(true);
  expect(fontRequests.every((f) => f.endsWith('.woff2'))).toBe(true);
  expect(fonts.size).toBeLessThan(
    manifest.fonts.reduce((sum: number, f: { files: unknown[] }) => sum + f.files.length, 0),
  );
  const initialFontBytes = [...fonts.values()].reduce((sum, bytes) => sum + bytes, 0);
  expect(initialFontBytes).toBeGreaterThan(0);
  expect(initialFontBytes).toBeLessThan(1_500_000);

  // Editing a new CJK glyph must load its subset before exporting, even after fonts.ready.
  const glyph = '龘';
  const rareSubset = manifest.fonts
    .find((f: { family: string }) => f.family === 'Noto Sans SC')
    .files.find((f: { unicodeRange: string }) =>
      f.unicodeRange.split(',').some((part: string) => {
        const [start, end = start] = part.trim().slice(2).split('-');
        return (
          glyph.codePointAt(0)! >= parseInt(start, 16) && glyph.codePointAt(0)! <= parseInt(end, 16)
        );
      }),
    );
  expect(rareSubset).toBeTruthy();
  const rarePath = '/fonts/' + rareSubset.file;
  expect(fontRequests).not.toContain(rarePath);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**' + rarePath, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    const requested = page.waitForRequest((r) => new URL(r.url()).pathname === rarePath);
    await edit(page, p.id, [
      {
        type: 'node.update',
        sceneId: 'scene-1',
        nodeId: 'label-1',
        changes: { text: '中文 ' + glyph },
      },
    ]);
    const pending = await start(page, p.id, 'png', { sceneId: 'scene-1' });
    await requested;
    await expect.poll(async () => (await getJob(page, pending.id)).status).toBe('running');
    expect(
      await page.evaluate((text) => document.fonts.check('400 24px "Noto Sans SC"', text), glyph),
    ).toBe(false);
    release();
    await waitJob(page, pending.id);
    expect(fonts.has(rarePath)).toBe(true);
    expect(
      await page.evaluate((text) => document.fonts.check('400 24px "Noto Sans SC"', text), glyph),
    ).toBe(true);
  } finally {
    release();
  }
  expect(forbidden).toEqual([]);
});
