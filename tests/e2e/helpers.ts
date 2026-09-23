import { expect, type Page } from '@playwright/test';
export async function call(
  page: Page,
  module: string,
  method: string,
  args: unknown[] = [],
): Promise<any> {
  return page.evaluate(
    async ({ module, method, args }) => {
      const path = '/src/' + module + '.ts';
      const api = await import(/* @vite-ignore */ path);
      const [target, member] = method.split('.');
      return member ? api[target][member](...args) : api[target](...args);
    },
    { module, method, args },
  );
}
export async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '打开工程列表' })).toBeVisible();
}
export async function create(page: Page, title: string, example = true) {
  await boot(page);
  const p = await call(page, 'client', 'store.create', [title, example]);
  await page.evaluate((id) => localStorage.setItem('muweave-project', id), p.id);
  return p;
}
export const state = (page: Page, id: string) => call(page, 'client', 'store.get', [id]);
export async function edit(page: Page, id: string, commands: unknown[]) {
  return call(page, 'client', 'store.mutate', [
    id,
    {
      expectedRevision: (await state(page, id)).revision,
      requestId: crypto.randomUUID(),
      commands,
    },
  ]);
}
export async function upload(page: Page, id: string, name: string, mime: string, data: Buffer) {
  return page.evaluate(
    async ({ id, name, mime, bytes }) => {
      const path = '/src/client.ts',
        api = await import(/* @vite-ignore */ path),
        p = await api.store.get(id);
      return (
        await api.importFile(
          id,
          new File([new Uint8Array(bytes)], name, { type: mime }),
          p.revision,
          crypto.randomUUID(),
        )
      ).asset;
    },
    { id, name, mime, bytes: [...data] },
  );
}
export async function start(page: Page, id: string, format: string, extra = {}) {
  return call(page, 'exports', 'startExport', [
    id,
    {
      format,
      ...extra,
      expectedRevision: (await state(page, id)).revision,
      requestId: crypto.randomUUID(),
    },
  ]);
}
export const job = (page: Page, id: string) => call(page, 'client', 'getJob', [id]);
export async function waitJob(page: Page, id: string) {
  await expect
    .poll(async () => (await job(page, id)).status, {
      timeout: 180000,
      intervals: [300, 700, 1200],
    })
    .toMatch(/succeeded|failed|interrupted/);
  const j = await job(page, id);
  expect(j.status, j.error).toBe('succeeded');
  return j;
}
export async function output(page: Page, id: string) {
  return Buffer.from(
    await page.evaluate(async (id) => {
      const path = '/src/storage.ts',
        { store } = await import(/* @vite-ignore */ path);
      return [...new Uint8Array(await (await store.job(id)).output.arrayBuffer())];
    }, id),
  );
}
export function tone(seconds = 4, edges = false) {
  const rate = 48000,
    count = rate * seconds,
    b = Buffer.alloc(44 + count * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      active = !edges || (t >= 0.3 && t < 1.3) || (t >= 1.65 && t < seconds - 0.5);
    b.writeInt16LE(active ? Math.round(Math.sin(t * 2 * Math.PI * 440) * 10000) : 0, 44 + i * 2);
  }
  return b;
}
