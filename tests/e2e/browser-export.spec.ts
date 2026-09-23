import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { create, state, edit, upload, start, waitJob, output, call, job, tone } from './helpers';

test('exports 1080p entirely in browser, preserves frozen audio, restores downloads, cancels and recovers', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [],
    forbidden: string[] = [],
    wasm: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('.wasm')) wasm.push(r.url());
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') ||
      url.pathname.startsWith('/api/')
    ) {
      forbidden.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const p = await create(page, '浏览器完整导出验收');
  const audio = await upload(page, p.id, 'tone.wav', 'audio/wav', tone(3));
  const image = await upload(
    page,
    p.id,
    'image.png',
    'image/png',
    await sharp({ create: { width: 120, height: 80, channels: 4, background: '#f9c79d' } })
      .png()
      .toBuffer(),
  );
  await edit(page, p.id, [
    { type: 'scene.remove', sceneId: 'scene-3' },
    ...['scene-1', 'scene-2'].flatMap((sceneId, i) => [
      {
        type: 'narration.set',
        sceneId,
        narration: { assetId: audio.id, trimStartUs: 250000, trimEndUs: 2350000, gain: 0.8 },
        fitDuration: true,
      },
      {
        type: 'captions.set',
        sceneId,
        captions: [
          {
            id: 'c' + i,
            startUs: 100000,
            endUs: 2000000,
            text: i ? '跨场景音轨连续' : '中文、图片与字幕一起导出',
          },
        ],
      },
    ]),
    {
      type: 'node.add',
      sceneId: 'scene-1',
      node: {
        id: 'image',
        type: 'image',
        assetId: image.id,
        x: 1720,
        y: 60,
        width: 120,
        height: 80,
      },
    },
  ]);
  const frozen = await state(page, p.id);
  await page.reload();
  await page.getByRole('button', { name: '导出作品' }).click();
  await expect(page.getByText('本机导出', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^视频 1920/ }).click();
  await expect.poll(async () => (await call(page, 'client', 'getJobs', [p.id])).length).toBe(1);
  const first = (await call(page, 'client', 'getJobs', [p.id]))[0];
  expect(first.engine).toBe('wasm');
  await edit(page, p.id, [
    {
      type: 'node.update',
      sceneId: 'scene-1',
      nodeId: 'title',
      changes: { text: '导出后才修改的文字' },
    },
  ]);
  const result = await waitJob(page, first.id);
  expect(result.revision).toBe(frozen.revision);
  expect(result.report).toMatchObject({
    engine: 'ffmpeg.wasm',
    width: 1920,
    height: 1080,
    frames: 126,
    chunks: 3,
    fullDecode: 'passed',
    verificationLocation: 'browser',
  });
  expect(result.report.maxBufferedFrames).toBeLessThanOrEqual(60);
  const snapshot = (await call(page, 'storage', 'store.job', [first.id])).snapshot;
  expect(snapshot.scenes[0].nodes.find((n: any) => n.id === 'title').text).toBe(
    frozen.scenes[0].nodes.find((n: any) => n.id === 'title').text,
  );
  expect(wasm.length).toBeGreaterThan(0);
  const bytes = await output(page, first.id),
    path = info.outputPath('browser.mp4');
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(path, bytes);
  // External test oracle only; the application does not call either executable.
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], {
      encoding: 'utf8',
    }),
  );
  expect(probe.streams.find((s: any) => s.codec_type === 'video').nb_frames).toBe('126');
  expect(Math.abs(Number(probe.format.duration) - 4.2)).toBeLessThan(0.05);
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-']);
  const pcm = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '48000', 'pipe:1'],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  for (const t of [0.5, 1.99, 2.01, 2.09, 2.11, 3.99, 4.01]) {
    const from = Math.round(t * 48000);
    let sum = 0;
    for (let i = from; i < from + 480; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    expect(Math.sqrt(sum / 480), 'audio near ' + t).toBeGreaterThan(0.08);
  }
  await page.reload();
  await page.getByRole('button', { name: '导出作品' }).click();
  await page.getByRole('button', { name: '预览', exact: true }).first().click();
  const player = page.getByLabel('成片预览');
  await expect.poll(() => player.evaluate((n) => (n as HTMLVideoElement).videoWidth)).toBe(1920);
  await player.evaluate((n) => {
    (n as HTMLVideoElement).currentTime = 1;
  });
  await expect
    .poll(() =>
      player.evaluate(
        (n) => !(n as HTMLVideoElement).seeking && (n as HTMLVideoElement).readyState >= 2,
      ),
    )
    .toBeTruthy();
  expect(await output(page, first.id)).toEqual(bytes);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载', exact: true }).first().click();
  expect((await download).suggestedFilename()).toBe(first.id + '.mp4');
  await page.screenshot({ path: info.outputPath('browser-export.png') });
  await edit(page, p.id, [
    { type: 'scene.update', sceneId: 'scene-2', changes: { durationUs: 30000000 } },
  ]);
  const cancel = await start(page, p.id, 'mp4');
  await expect
    .poll(async () => (await job(page, cancel.id)).progress, { timeout: 30000 })
    .toBeGreaterThan(0.04);
  const cancelRecord = await call(page, 'storage', 'store.job', [cancel.id]);
  const retryId = cancelRecord.requestKey.slice(p.id.length + 1);
  await expect(
    call(page, 'exports', 'startExport', [
      p.id,
      { format: 'png', expectedRevision: cancel.revision, requestId: retryId },
    ]),
  ).rejects.toThrow('同一导出请求');
  await expect(start(page, p.id, 'png')).rejects.toThrow('浏览器正在导出');
  expect(
    (
      await call(page, 'exports', 'startExport', [
        p.id,
        { format: 'mp4', expectedRevision: cancel.revision, requestId: retryId },
      ])
    ).id,
  ).toBe(cancel.id);
  // A second tab must not mistake the active renderer for an abandoned export.
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByText('已保存到浏览器')).toBeVisible();
  expect((await job(other, cancel.id)).status).toBe('running');
  await call(other, 'exports', 'cancelExport', [cancel.id]);
  await expect.poll(async () => (await job(page, cancel.id)).status).toBe('cancelled');
  await other.close();
  await edit(page, p.id, [
    { type: 'scene.update', sceneId: 'scene-2', changes: { durationUs: 2100000 } },
  ]);
  const retry = await start(page, p.id, 'mp4');
  await waitJob(page, retry.id);
  const interrupted = await start(page, p.id, 'mp4');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText('已保存到浏览器')).toBeVisible();
  await expect
    .poll(async () => (await job(page, interrupted.id)).status)
    .toMatch(/interrupted|failed/);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});
