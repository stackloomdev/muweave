import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { create, state, edit, start, waitJob, output } from './helpers';
test('uses bundled Google fonts with legacy-name migration and no external or API requests', async ({
  page,
}) => {
  const forbidden: string[] = [],
    fonts: string[] = [];
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
    if (r.ok() && r.url().endsWith('.ttf')) fonts.push(new URL(r.url()).pathname);
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
  expect(new Set(fonts)).toEqual(
    new Set(['/fonts/Roboto-Variable.ttf', '/fonts/NotoSansSC-Variable.ttf']),
  );
  expect(forbidden).toEqual([]);
});
