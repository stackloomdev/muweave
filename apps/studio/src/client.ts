import { type Project, type Job, type Batch, batchSchema } from '@muweave/schema';
import { DomainError, duration, uid, validateProject } from '@muweave/core';
import { configureAssetUrls } from '@muweave/renderer';
import { store } from './storage';
import { prepareAsset } from './media';
export { DomainError as ApiError } from '@muweave/core';
export { store } from './storage';
export { importBundle } from './bundles';
export { analyzeTimeline } from './media';
const urls = new Map<string, string>(),
  outputs = new Map<string, string>();
const key = (hash: string, scope = 'editor') => scope + ':' + hash;
configureAssetUrls((p, id, jobId) => {
  const asset = p.assets[id],
    url = asset && urls.get(key(asset.sha256, jobId));
  if (!url) throw new DomainError('MISSING_ASSET', '素材尚未准备好：' + id);
  return url;
});
export async function prepareAssets(p: Project, scope?: string, signal?: AbortSignal) {
  for (const asset of Object.values(p.assets)) {
    signal?.throwIfAborted();
    const k = key(asset.sha256, scope);
    if (!urls.has(k)) {
      const blob = await store.asset(asset.sha256);
      signal?.throwIfAborted();
      if (!urls.has(k)) urls.set(k, URL.createObjectURL(blob));
    }
  }
}
export function releaseAssets(scope: string) {
  for (const [k, url] of urls)
    if (k.startsWith(scope + ':')) {
      URL.revokeObjectURL(url);
      urls.delete(k);
    }
}
export async function loadProject(id: string) {
  const p = await store.get(id);
  await prepareAssets(p);
  return p;
}
export const apply = (id: string, batch: Batch) => store.mutate(id, batch);
export async function getJob(id: string): Promise<Job> {
  const record = await store.job(id);
  if (record.output && record.job.status === 'succeeded' && !outputs.has(id))
    outputs.set(id, URL.createObjectURL(record.output));
  return { ...record.job, downloadUrl: outputs.get(id) };
}
export async function getJobs(id: string) {
  return Promise.all((await store.jobs(id)).map((r) => getJob(r.job.id)));
}
export async function importFile(
  projectId: string,
  file: File,
  expectedRevision: number,
  requestId: string,
) {
  const prepared = await prepareAsset(file.name, file),
    p = await store.get(projectId);
  prepared.asset = Object.values(p.assets).find((a) => a.sha256 === prepared.asset.sha256) ?? {
    ...prepared.asset,
    id: 'asset_' + prepared.asset.sha256.slice(0, 24),
  };
  const result = await store.mutate(
    projectId,
    {
      expectedRevision,
      requestId,
      label: '导入 ' + prepared.asset.name,
      commands: [{ type: 'asset.add', asset: prepared.asset }],
    },
    prepared,
  );
  return { ...result, asset: prepared.asset };
}
export async function validate(id: string) {
  const p = await store.get(id),
    issues = validateProject(p);
  for (const a of Object.values(p.assets))
    try {
      await store.asset(a.sha256);
    } catch {
      issues.push({
        code: 'MISSING_ASSET',
        message: '素材缺失：' + a.name,
        objectId: a.id,
        severity: 'error',
      });
    }
  return { revision: p.revision, durationUs: duration(p), issues };
}
export const capabilities = () => ({
  app: 'Muweave',
  schemaVersion: 1,
  formats: ['mp4', 'png', 'bundle', 'srt'],
  storage: 'IndexedDB',
  execution: 'browser',
  backendRequired: false,
  generation:
    'Generate with host tools, then use assets.prepare_import and the browser file chooser.',
  exportEngines: { wasm: ['mp4'], browser: ['png', 'bundle', 'srt'] },
  commandTypes: batchSchema.shape.commands.element.options.map((o) => o.shape.type.value),
  constraints: {
    width: 1920,
    height: 1080,
    fps: 30,
    maxAssetBytes: 100 * 1024 * 1024,
    maxBundleBytes: 250 * 1024 * 1024,
  },
  requiresOpenPageForExport: true,
});
type StagedImport = {
  projectId: string;
  status: 'waiting' | 'processing' | 'ready' | 'failed';
  prepared?: Awaited<ReturnType<typeof prepareAsset>>;
  error?: string;
};
const staged = new Map<string, StagedImport>();
export async function prepareImport(projectId: string) {
  await store.get(projectId);
  if (staged.size >= 50) throw new Error('当前页面导入记录已满，请刷新页面后继续');
  const importId = uid('import');
  staged.set(importId, { projectId, status: 'waiting' });
  return {
    importId,
    inputId: 'muweave-agent-file',
    next: 'Click 选择 Agent 素材 and use the browser file chooser. Wait for assets.import_status=ready, then call assets.import. No upload server is used.',
  };
}
function stagedImport(id: string) {
  const ticket = staged.get(id);
  if (!ticket) throw new DomainError('INVALID_IMPORT', '素材导入已失效，请重新准备导入');
  return ticket;
}
export function importStatus(id: string) {
  const t = stagedImport(id);
  return { importId: id, status: t.status, asset: t.prepared?.asset, error: t.error };
}
export async function stageImport(id: string, file: File) {
  const t = stagedImport(id);
  if (t.status !== 'waiting' && t.status !== 'failed')
    throw new Error('此导入已选择文件，请重新准备导入');
  t.status = 'processing';
  t.error = undefined;
  try {
    t.prepared = await prepareAsset(file.name, file);
    const p = await store.get(t.projectId);
    t.prepared.asset =
      Object.values(p.assets).find((a) => a.sha256 === t.prepared!.asset.sha256) ??
      t.prepared.asset;
    t.status = 'ready';
  } catch (error) {
    t.status = 'failed';
    t.error = (error as Error).message;
    throw error;
  }
  return importStatus(id);
}
export async function commitImport(
  projectId: string,
  importId: string,
  expectedRevision: number,
  requestId: string,
) {
  const t = stagedImport(importId);
  if (t.projectId !== projectId || t.status !== 'ready' || !t.prepared)
    throw new DomainError('ASSET_NOT_READY', '请先通过浏览器选择文件，并等待素材处理完成');
  const result = await store.mutate(
    projectId,
    {
      expectedRevision,
      requestId,
      label: '导入 ' + t.prepared.asset.name,
      commands: [{ type: 'asset.add', asset: t.prepared.asset }],
    },
    t.prepared,
  );
  return { ...result, asset: t.prepared.asset };
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
