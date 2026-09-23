import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import {
  create,
  state as readState,
  edit,
  upload,
  start,
  waitJob,
  output,
  call,
  tone,
  boot,
} from './helpers';
test('edits through the real UI, persists reload, undoes, and creates an independent cover', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('已保存到浏览器')).toBeVisible();
  const name = page.getByRole('textbox', { name: '场景名称' });
  await name.fill('画布编辑测试');
  await name.press('Tab');
  await expect(page.getByRole('button', { name: '选择场景 1 画布编辑测试' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '场景名称' })).toHaveValue('画布编辑测试');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '场景名称' })).toHaveValue('好想法，值得被看见');
  await page.getByRole('button', { name: '4:3 封面', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回视频' })).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-cover.png' });
  await page.getByRole('button', { name: '返回视频' }).click();
  await expect(page.getByRole('button', { name: '4:3 封面', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/public-studio.png' });
  await page.getByRole('button', { name: '添加场景', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: '场景名称' })).toHaveValue('新场景');
  await page.screenshot({ path: 'test-results/studio.png' });
  expect(errors).toEqual([]);
});
test('keeps scene deletion visible and supports adjacent selection, undo and keyboard deletion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1054, height: 720 });
  const p = await create(page, '场景删除回归');
  const state = () => readState(page, p.id);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '场景删除回归', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '选择场景 3 把故事连起来', exact: true }).click();
  await page.getByRole('button', { name: '添加场景', exact: true }).last().click();
  const created = page.getByRole('button', { name: '选择场景 4 新场景', exact: true });
  await expect(created).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '文案', exact: true }).click();
  const remove = page.getByRole('button', { name: '删除当前场景', exact: true });
  await expect(remove).toBeInViewport({ ratio: 1 });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(created).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '选择场景 3 把故事连起来', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('slider', { name: '播放位置', exact: true })).toHaveValue('12000000');
  expect((await state()).scenes).toEqual(p.scenes);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(created).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(created).toHaveCount(0);
  await remove.click();
  await expect(
    page.getByRole('button', { name: '选择场景 2 让信息，有层次', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await remove.click();
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAttribute('title', '至少保留一个场景');
  await expect(page.getByRole('slider', { name: '播放位置', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: '添加场景', exact: true }).last().click();
  const keyboardScene = page.getByRole('button', { name: '选择场景 2 新场景', exact: true });
  await keyboardScene.focus();
  await keyboardScene.press('Delete');
  await expect(keyboardScene).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: /^选择场景 / })).toHaveCount(1);
});
test('opens layer properties at the top and keeps resize handles usable on a fitted canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1054, height: 720 });
  const p = await create(page, '图层交互回归');
  await page.goto('/');
  await page.locator('.inspector-tabs').getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '整理内容', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文字内容', exact: true })).toBeInViewport({
    ratio: 1,
  });
  const canvas = page.getByLabel('创作画布');
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(400);
  const box = (await canvas.boundingBox())!;
  const scale = box.width / p.width;
  const original = p.scenes[0].nodes.find((n: { id: string }) => n.id === 'label-1');
  const x = box.x + (original.x + original.width) * scale + 3;
  const y = box.y + (original.y + original.height / 2) * scale;
  // The side handle must resize width only, even if the pointer also moves vertically.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 15, { steps: 10 });
  await page.mouse.up();
  const state = () => readState(page, p.id);
  await expect.poll(async () => (await state()).revision).toBe(1);
  const resized = (await state()).scenes[0].nodes.find((n: { id: string }) => n.id === 'label-1');
  expect(resized.width).toBeCloseTo(original.width + 40 / scale, 0);
  expect(resized.height).toBeCloseTo(original.height, 0);
  expect(resized.y).toBeCloseTo(original.y, 0);
  expect(resized.fontSize).toBeCloseTo(original.fontSize, 0);
});
test('drags a contained image without changing its logical frame', async ({ page }) => {
  const p = await create(page, '画布交互验证', false);
  const asset = await upload(
    page,
    p.id,
    'wide.png',
    'image/png',
    await sharp({ create: { width: 600, height: 200, channels: 4, background: '#d59c74' } })
      .png()
      .toBuffer(),
  );
  await edit(page, p.id, [
    {
      type: 'node.add',
      sceneId: p.scenes[0].id,
      node: {
        id: 'image',
        type: 'image',
        assetId: asset.id,
        x: 300,
        y: 250,
        width: 400,
        height: 400,
        fit: 'contain',
      },
    },
  ]);
  await page.goto('/');
  const canvas = page.getByLabel('创作画布');
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(600);
  const box = (await canvas.boundingBox())!,
    scale = box.width / 1920;
  await page.mouse.move(box.x + 500 * scale, box.y + 450 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 596 * scale, box.y + 522 * scale, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await readState(page, p.id)).revision).toBe(3);
  const node = (await readState(page, p.id)).scenes[0].nodes.find(
    (n: { id: string }) => n.id === 'image',
  );
  expect(node.x).toBeCloseTo(396, 0);
  expect(node.y).toBeCloseTo(322, 0);
  expect([node.width, node.height]).toEqual([400, 400]);
});
test('imports files through the UI, analyzes audio, exports PNG/SRT and round-trips a bundle', async ({
  page,
}) => {
  const p = await create(page, '媒体验证');
  await page.reload();
  const inputs = page.locator('input[type=file]');
  await inputs
    .nth(0)
    .setInputFiles({ name: 'measured.wav', mimeType: 'audio/wav', buffer: tone(4, true) });
  await expect.poll(async () => (await readState(page, p.id)).revision).toBe(1);
  const audio = Object.values((await readState(page, p.id)).assets)[0] as any;
  expect(audio.durationUs).toBe(4000000);
  expect(audio.mime).toBe('audio/wav');
  await inputs.nth(0).setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 120, height: 80, channels: 4, background: '#f9c79d' } })
      .png()
      .toBuffer(),
  });
  await expect.poll(async () => (await readState(page, p.id)).revision).toBe(2);
  await edit(page, p.id, [
    {
      type: 'narration.set',
      sceneId: 'scene-1',
      narration: { assetId: audio.id, trimStartUs: 0, trimEndUs: audio.durationUs },
      fitDuration: true,
    },
    {
      type: 'captions.set',
      sceneId: 'scene-1',
      captions: [{ id: 'caption', startUs: 300000, endUs: 1300000, text: '实际配音时间' }],
    },
    { type: 'variant.create', sceneId: 'scene-1', id: 'cover', title: '封面' },
  ]);
  const analysis = await call(page, 'media', 'analyzeTimeline', [await readState(page, p.id)]);
  expect(analysis.trims[0].leadingUs).toBeGreaterThan(290000);
  expect(analysis.trims[0].trailingUs).toBeGreaterThan(490000);
  await edit(page, p.id, [
    {
      type: 'narration.set',
      sceneId: 'scene-1',
      narration: analysis.trims[0].suggestion,
      fitDuration: true,
    },
  ]);
  const after = await readState(page, p.id);
  expect(after.scenes[0].captions[0].startUs).toBeLessThan(90000);
  expect(after.scenes[0].durationUs).toBeGreaterThan(3300000);
  const png = await start(page, p.id, 'png', { variantId: 'cover' });
  await edit(page, p.id, [{ type: 'project.rename', title: '导出期间仍可编辑' }]);
  expect((await waitJob(page, png.id)).revision).toBe(after.revision);
  const meta = await sharp(await output(page, png.id)).metadata();
  expect([meta.width, meta.height]).toEqual([1440, 1080]);
  const bundle = await start(page, p.id, 'bundle');
  await waitJob(page, bundle.id);
  const bytes = await output(page, bundle.id);
  await inputs
    .nth(1)
    .setInputFiles({ name: 'test.muweave.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByText('工程包已打开')).toBeVisible();
  const list = await call(page, 'client', 'store.list');
  const restored = await readState(
    page,
    list.find((x: any) => x.id !== p.id && x.id !== 'welcome').id,
  );
  expect(Object.keys(restored.assets)).toHaveLength(2);
  expect(restored.scenes[0].captions).toEqual(after.scenes[0].captions);
  await page.reload();
  await page.getByRole('button', { name: '播放预览' }).click();
  await expect(page.getByRole('button', { name: '暂停预览' })).toBeVisible();
  await page.getByRole('button', { name: '暂停预览' }).click();
  await page.getByRole('button', { name: '导出作品' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '单独下载字幕 SRT' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.srt$/);
});
