import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'vitest';
import { BrowserStore, sha256 } from '../apps/studio/src/storage';
import { createExample } from '../packages/core/src/example';
import type { Asset } from '@muweave/schema';
const stores: BrowserStore[] = [];
function open(name: string = crypto.randomUUID()) {
  const s = new BrowserStore(name);
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});
const rename = (title: string, expectedRevision = 0, requestId: string = crypto.randomUUID()) => ({
  expectedRevision,
  requestId,
  label: '改名',
  commands: [{ type: 'project.rename' as const, title }],
});
test('commits a whole batch or nothing, rejects missing assets without persisting the edit', async () => {
  const s = open(),
    p = await s.create('原稿', true);
  await expect(
    s.mutate(p.id, {
      ...rename('错误批次'),
      commands: [
        { type: 'project.rename', title: '不能留下' },
        { type: 'scene.remove', sceneId: 'missing' },
      ],
    }),
  ).rejects.toThrow();
  expect(await s.get(p.id)).toEqual(p);
  const asset: Asset = {
    id: 'missing',
    sha256: '0'.repeat(64),
    file: '0'.repeat(64) + '.png',
    name: 'missing',
    bytes: 1,
    kind: 'image',
    mime: 'image/png',
  };
  await expect(
    s.mutate(p.id, { ...rename('x'), commands: [{ type: 'asset.add', asset }] }),
  ).rejects.toThrow('素材文件不存在');
  expect((await s.history(p.id)).undoAvailable).toBe(false);
});
test('persists receipts, revisions, and undo across reopening; rejects changed retries', async () => {
  const s = open(),
    p = await s.create('原稿', true),
    input = rename('下一稿');
  await s.mutate(p.id, input);
  await s.close();
  const reopened = open(s.name);
  expect(await reopened.mutate(p.id, input)).toMatchObject({ revision: 1, replayed: true });
  await expect(
    reopened.mutate(p.id, { ...input, commands: [{ type: 'project.rename', title: '错误重试' }] }),
  ).rejects.toThrow('同一请求');
  await reopened.mutate(p.id, { action: 'undo', expectedRevision: 1, requestId: 'undo' });
  expect(await reopened.get(p.id)).toMatchObject({ title: '原稿', revision: 2 });
  await reopened.mutate(p.id, { action: 'redo', expectedRevision: 2, requestId: 'redo' });
  expect(await reopened.get(p.id)).toMatchObject({ title: '下一稿', revision: 3 });
});
test('serializes independent connections and prevents stale concurrent overwrites', async () => {
  const first = open(),
    second = open(first.name),
    p = await first.create('初稿');
  const results = await Promise.allSettled([
    first.mutate(p.id, rename('A')),
    second.mutate(p.id, rename('B')),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect((await first.get(p.id)).revision).toBe(1);
  expect((await second.history(p.id)).entries).toHaveLength(1);
});
test('stores media and commands atomically and retains bytes through undo', async () => {
  const s = open(),
    p = await s.create('素材'),
    blob = new Blob(['test'], { type: 'image/png' });
  const hash = await sha256(await blob.arrayBuffer());
  const asset: Asset = {
    id: 'a',
    sha256: hash,
    file: hash + '.png',
    name: '测试',
    bytes: blob.size,
    kind: 'image',
    mime: blob.type,
  };
  await expect(
    s.mutate(
      p.id,
      { ...rename('x', 9), commands: [{ type: 'asset.add', asset }] },
      { asset, blob },
    ),
  ).rejects.toThrow('工程已更新');
  await expect(s.asset(hash)).rejects.toThrow();
  await s.mutate(
    p.id,
    { ...rename('x'), commands: [{ type: 'asset.add', asset }] },
    { asset, blob },
  );
  await s.mutate(p.id, { action: 'undo', expectedRevision: 1, requestId: 'undo' });
  expect((await s.get(p.id)).assets).toEqual({});
  expect(await (await s.asset(hash)).text()).toBe('test');
});
test('keeps export snapshots stable, retries idempotent, ownership and terminal states protected', async () => {
  const s = open(),
    p = await s.create('导出'),
    options = { format: 'mp4', expectedRevision: 0, requestId: 'export' };
  const r = await s.createJob(p.id, options, 'owner');
  await s.mutate(p.id, rename('编辑后'));
  expect((await s.createJob(p.id, options, 'different')).job.id).toBe(r.job.id);
  await expect(s.createJob(p.id, { ...options, format: 'png' }, 'owner')).rejects.toThrow(
    '同一导出',
  );
  expect((await s.job(r.job.id)).snapshot.title).toBe('导出');
  await expect(s.updateJob(r.job.id, 'different', { status: 'succeeded' })).rejects.toThrow(
    '另一个页面',
  );
  await s.updateJob(r.job.id, null, { status: 'cancelled' });
  await s.updateJob(r.job.id, 'owner', { status: 'succeeded' }, new Blob(['late']));
  expect((await s.job(r.job.id)).job.status).toBe('cancelled');
  expect((await s.job(r.job.id)).output).toBeUndefined();
});
test('validates complete imported bundles before adding a project or any blob', async () => {
  const s = open(),
    p = createExample('imported'),
    blob = new Blob(['fixture']);
  const hash = await sha256(await blob.arrayBuffer());
  p.assets.a = {
    id: 'a',
    sha256: hash,
    file: hash + '.png',
    name: 'a',
    bytes: blob.size,
    kind: 'image',
    mime: 'image/png',
  };
  await expect(s.importProject(p, new Map([[hash, new Blob(['wrong'])]]))).rejects.toThrow();
  expect(await s.list()).toHaveLength(0);
  await expect(s.asset(hash)).rejects.toThrow();
  await s.importProject(p, new Map([[hash, blob]]));
  expect((await s.get(p.id)).assets.a.sha256).toBe(hash);
});
test('normalizes legacy font names on import and history restoration', async () => {
  const s = open(),
    p = createExample('legacy');
  p.scenes[0].nodes[0].fontFamily = 'Manrope Variable';
  await s.importProject(p, new Map());
  expect((await s.get(p.id)).scenes[0].nodes[0].fontFamily).toBe('Roboto');
  await s.mutate(p.id, rename('改名'));
  await s.mutate(p.id, { action: 'undo', expectedRevision: 1, requestId: 'back' });
  expect((await s.get(p.id)).scenes[0].nodes[0].fontFamily).toBe('Roboto');
});
test('concurrent initializers produce one welcome project', async () => {
  const a = open(),
    b = open(a.name);
  await Promise.all([a.init(), b.init()]);
  expect(await a.list()).toHaveLength(1);
});

test('rejects still-only selectors on video exports', async () => {
  const s = open(),
    p = await s.create('封面');
  await s.mutate(p.id, {
    ...rename('x'),
    commands: [{ type: 'variant.create', sceneId: 'scene-1', id: 'cover', title: '封面' }],
  });
  await expect(
    s.createJob(
      p.id,
      { format: 'mp4', variantId: 'cover', expectedRevision: 1, requestId: 'invalid' },
      'owner',
    ),
  ).rejects.toThrow('只适用于 PNG');
  expect(await s.jobs(p.id)).toHaveLength(0);
});
test('receipt keys cannot collide with Object prototype properties', async () => {
  const s = open(),
    p = await s.create('稿件');
  const input = rename('修改', 0, '__proto__');
  await s.mutate(p.id, input);
  expect(await s.mutate(p.id, input)).toMatchObject({ replayed: true, revision: 1 });
});
