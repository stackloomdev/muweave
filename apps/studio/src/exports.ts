import { type Job, exportSchema } from '@muweave/schema';
import { uid } from '@muweave/core';
import { CanvasRenderer, releaseJobAssets } from '@muweave/renderer';
import { store, type JobRecord } from './storage';
import { prepareAssets, releaseAssets, getJob } from './client';
import { exportBundle } from './bundles';
const owner = uid('browser'),
  runners = new Map<string, AbortController>();
let initialized: Promise<void> | undefined;
let active: { request: string; jobId?: string } | undefined;
let admissions: Promise<unknown> = Promise.resolve();
function releaseJob(id: string) {
  runners.get(id)?.abort();
  if (active?.jobId === id) active = undefined;
}
const live = (j: Job) => ['queued', 'running'].includes(j.status);
export async function initialize() {
  await store.init();
  await initializeExports();
}
export function initializeExports() {
  return (initialized ??= (async () => {
    if (navigator.locks)
      await new Promise<void>((resolve) => {
        void navigator.locks.request('muweave-owner-' + owner, async () => {
          resolve();
          await new Promise<void>((release) =>
            window.addEventListener('pagehide', () => release(), { once: true }),
          );
        });
      });
    for (const p of await store.list())
      for (const record of await store.jobs(p.id)) {
        if (!live(record.job) || record.owner === owner) continue;
        const interrupt = () =>
          store.updateJob(record.job.id, record.owner, {
            status: 'interrupted',
            stage: '页面已关闭',
            error: '导出页面已关闭，请重新导出',
          });
        if (navigator.locks)
          await navigator.locks.request(
            'muweave-owner-' + record.owner,
            { ifAvailable: true },
            async (lock) => {
              if (lock) await interrupt();
            },
          );
        else if (Date.now() - record.heartbeat > 600000) await interrupt();
      }
    store.subscribe((change) => {
      if (change.type !== 'job' || !change.jobId || !runners.has(change.jobId)) return;
      void store
        .job(change.jobId)
        .then((r) => {
          if (!live(r.job)) releaseJob(r.job.id);
        })
        .catch(() => {});
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) location.reload();
    });
    window.addEventListener('pagehide', () => {
      for (const controller of runners.values()) controller.abort();
    });
  })());
}
export function startExport(projectId: string, raw: unknown): Promise<Job> {
  const next = admissions.catch(() => {}).then(() => admitExport(projectId, raw));
  admissions = next;
  return next;
}
async function admitExport(projectId: string, raw: unknown): Promise<Job> {
  const options = exportSchema.parse(raw),
    request = projectId + ':' + options.requestId;
  await initializeExports();
  if (
    options.format === 'mp4' &&
    (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined')
  )
    throw new Error('当前浏览器不支持视频导出，请使用新版桌面浏览器');
  const activeJobId = active?.jobId;
  if (activeJobId && !live((await store.job(activeJobId)).job)) releaseJob(activeJobId);
  if (active && active.request !== request)
    throw new Error('浏览器正在导出，请等待完成或取消后再试');
  active ??= { request };
  const slot = active;
  try {
    const record = await store.createJob(projectId, options, owner);
    if (record.owner === owner && record.job.status === 'queued' && !runners.has(record.job.id)) {
      const controller = new AbortController();
      runners.set(record.job.id, controller);
      slot.jobId = record.job.id;
      void run(record, controller).finally(() => {
        runners.delete(record.job.id);
        if (active?.jobId === record.job.id) active = undefined;
      });
    } else if (!runners.has(record.job.id) && active === slot) active = undefined;
    return getJob(record.job.id);
  } catch (error) {
    // A rejected retry must never unlock another call's already running job.
    if (active === slot && !slot.jobId) active = undefined;
    throw error;
  }
}
export async function cancelExport(id: string) {
  const record = await store.updateJob(id, null, { status: 'cancelled', stage: '已取消' });
  releaseJob(id);
  return record.job;
}
export const browserExportCapabilities = () => ({
  wasm: typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined',
  threads: 1,
  requiresOpenPage: true,
});
async function run(record: JobRecord, controller: AbortController) {
  const { job, snapshot: project } = record,
    signal = controller.signal;
  let progress = 0,
    stage = '准备导出',
    lastSent = 0;
  const send = async () => {
    if (signal.aborted) return;
    lastSent = Date.now();
    const current = await store.updateJob(job.id, owner, { status: 'running', progress, stage });
    if (!live(current.job)) controller.abort();
  };
  const beforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnload);
  const heartbeat = setInterval(() => {
    void send().catch((e) => controller.abort(e));
  }, 3000);
  let container: HTMLDivElement | undefined, renderer: CanvasRenderer | undefined;
  try {
    await send();
    await prepareAssets(project, job.id, signal);
    signal.throwIfAborted();
    let blob: Blob, report: Record<string, unknown>;
    if (job.format === 'mp4') {
      const { renderBrowserVideo } = await import('./browser-export');
      const result = await renderBrowserVideo(project, job, signal, (value, label) => {
        progress = Math.max(progress, value);
        stage = label;
        if (Date.now() - lastSent > 700) void send().catch((e) => controller.abort(e));
      });
      blob = result.blob;
      report = { ...result.report, verificationLocation: 'browser' };
    } else if (job.format === 'png') {
      stage = '绘制封面';
      progress = 0.2;
      await send();
      container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
      container.setAttribute('aria-hidden', 'true');
      document.body.append(container);
      renderer = new CanvasRenderer(container, project.width, project.height, job.id, signal);
      await renderer.render(project, 0, {
        sceneId: job.sceneId,
        variantId: job.variantId,
        still: true,
      });
      blob = new Blob([(await renderer.pngBytes()) as Uint8Array<ArrayBuffer>], {
        type: 'image/png',
      });
      const variant = project.variants.find((v) => v.id === job.variantId);
      report = {
        engine: 'canvas',
        width: variant?.width ?? project.width,
        height: variant?.height ?? project.height,
        outputBytes: blob.size,
      };
    } else {
      stage = '打包工程与素材';
      progress = 0.2;
      await send();
      blob = await exportBundle(project, signal);
      report = { engine: 'browser', outputBytes: blob.size };
    }
    signal.throwIfAborted();
    stage = '保存到浏览器';
    progress = 0.99;
    await send();
    signal.throwIfAborted();
    await store.updateJob(
      job.id,
      owner,
      {
        status: 'succeeded',
        stage: '已完成',
        progress: 1,
        file: job.id + (job.format === 'bundle' ? '.muweave.zip' : '.' + job.format),
        report,
      },
      blob,
    );
  } catch (error) {
    await store
      .updateJob(job.id, owner, {
        status: 'failed',
        error: (error as Error)?.message || '导出已中断，请重试',
        stage: '导出失败',
      })
      .catch(() => {});
  } finally {
    clearInterval(heartbeat);
    window.removeEventListener('beforeunload', beforeUnload);
    renderer?.destroy();
    container?.remove();
    releaseJobAssets(job.id);
    releaseAssets(job.id);
  }
}
