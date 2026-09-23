import { z } from 'zod';
import {
  projectSchema,
  batchSchema,
  idSchema,
  exportSchema,
  type Project,
  type Job,
  type Batch,
  type Asset,
} from '@muweave/schema';
import { applyBatch, clone, DomainError, uid, validateProject } from '@muweave/core';
import { createExample } from '../../../packages/core/src/example';

type Version = { project: Project; label: string; at: string };
type State = {
  project: Project;
  past: Version[];
  future: Version[];
  receipts: Record<string, { hash: string; revision: number }>;
};
export type JobRecord = {
  job: Job;
  snapshot: Project;
  requestKey: string;
  hash: string;
  owner: string;
  heartbeat: number;
  output?: Blob;
};
export type Change = { type: 'change' | 'job'; projectId: string; jobId?: string };
export const historySchema = z
  .object({
    action: z.enum(['undo', 'redo']),
    expectedRevision: z.number().int().min(0),
    requestId: idSchema,
  })
  .strict();
export const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function sha256(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function digest(value: unknown) {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, stable(val)]),
          )
        : v;
  return sha256(new TextEncoder().encode(JSON.stringify(stable(value))).buffer);
}

/** All edits and their receipts commit in one IndexedDB transaction, including across tabs. */
export class BrowserStore {
  private connection?: Promise<IDBDatabase>;
  private listeners = new Set<(change: Change) => void>();
  private channel?: BroadcastChannel;
  constructor(readonly name = 'muweave-v1') {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(name);
      this.channel.onmessage = (e) => this.listeners.forEach((fn) => fn(e.data));
    }
  }
  subscribe(fn: (change: Change) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(change: Change) {
    this.listeners.forEach((fn) => fn(change));
    this.channel?.postMessage(change);
  }
  private db() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined')
        return reject(new Error('当前浏览器无法保存工程，请使用支持 IndexedDB 的浏览器'));
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('projects', { keyPath: 'project.id' });
        r.result.createObjectStore('assets');
        const jobs = r.result.createObjectStore('jobs', { keyPath: 'job.id' });
        jobs.createIndex('projectId', 'job.projectId');
        jobs.createIndex('requestKey', 'requestKey', { unique: true });
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          this.connection = undefined;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        this.connection = undefined;
        reject(r.error);
      };
      r.onblocked = () => reject(new Error('请关闭其他旧版幕织页面后重新打开'));
    }));
  }
  private async transaction<T>(
    names: string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value: T, failure: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(
          failure ??
            (tx.error?.name === 'QuotaExceededError'
              ? new DomainError('STORAGE_FULL', '浏览器存储空间不足，请导出工程包备份后释放空间')
              : tx.error),
        );
      tx.onerror = () => {};
      // Only IDB requests are awaited inside fn; hashing and media work happen before opening tx.
      void fn(tx)
        .then((v) => {
          value = v;
        })
        .catch((error) => {
          failure = error;
          try {
            tx.abort();
          } catch {
            reject(error);
          }
        });
    });
  }
  private async state(tx: IDBTransaction, id: string): Promise<State> {
    const s = await request<State | undefined>(tx.objectStore('projects').get(idSchema.parse(id)));
    if (!s) throw new DomainError('NOT_FOUND', '找不到工程');
    s.project = projectSchema.parse(s.project);
    return s;
  }
  async init() {
    if (!(await this.list()).length) {
      try {
        await this.create('把好想法，编织成故事', true, 'welcome');
      } catch (e) {
        if (!(e instanceof DomainError && e.code === 'ALREADY_EXISTS')) throw e;
      }
    }
  }
  async list() {
    const states = await this.transaction(['projects'], 'readonly', (tx) =>
      request<State[]>(tx.objectStore('projects').getAll()),
    );
    return states
      .map(({ project: { id, title, revision, updatedAt } }) => ({
        id,
        title,
        revision,
        updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string) {
    return this.transaction(
      ['projects'],
      'readonly',
      async (tx) => (await this.state(tx, id)).project,
    );
  }
  history(id: string) {
    return this.transaction(['projects'], 'readonly', async (tx) => {
      const s = await this.state(tx, id);
      return {
        undoAvailable: !!s.past.length,
        redoAvailable: !!s.future.length,
        revision: s.project.revision,
        entries: s.past.map(({ label, at, project }) => ({
          label,
          at,
          revision: project.revision,
        })),
      };
    });
  }
  async create(title: string, example = false, id = uid('project')) {
    const p = createExample(id);
    p.title = title;
    if (!example) {
      p.scenes = p.scenes.slice(0, 1);
      p.scenes[0].nodes = p.scenes[0].nodes.filter((n) =>
        ['eyebrow', 'title', 'subtitle'].includes(n.id),
      );
      p.scenes[0].title = '新场景';
    }
    return this.importProject(p, new Map());
  }
  async importProject(input: Project, blobs: Map<string, Blob>) {
    const p = projectSchema.parse(input);
    const errors = validateProject(p).filter((x) => x.severity === 'error');
    if (errors.length) throw new DomainError('INVALID_PROJECT', errors[0].message);
    for (const a of Object.values(p.assets)) {
      const blob = blobs.get(a.sha256);
      if (!blob || blob.size !== a.bytes || (await sha256(await blob.arrayBuffer())) !== a.sha256)
        throw new DomainError('MISSING_ASSET', '工程包素材缺失或校验失败：' + a.name);
    }
    await this.transaction(['projects', 'assets'], 'readwrite', async (tx) => {
      if (await request(tx.objectStore('projects').get(p.id)))
        throw new DomainError('ALREADY_EXISTS', '工程已存在');
      for (const [hash, blob] of blobs) await request(tx.objectStore('assets').put(blob, hash));
      await request(
        tx
          .objectStore('projects')
          .add({ project: p, past: [], future: [], receipts: {} } satisfies State),
      );
    });
    this.emit({ type: 'change', projectId: p.id });
    return p;
  }
  async asset(hash: string): Promise<Blob> {
    const blob = await this.transaction(['assets'], 'readonly', (tx) =>
      request<Blob | undefined>(tx.objectStore('assets').get(hash)),
    );
    if (!blob) throw new DomainError('MISSING_ASSET', '浏览器中找不到素材，请重新导入工程包');
    return blob;
  }
  async mutate(
    id: string,
    raw: Batch | z.input<typeof historySchema>,
    imported?: { asset: Asset; blob: Blob },
  ) {
    const input = 'action' in raw ? historySchema.parse(raw) : batchSchema.parse(raw);
    const hash = await digest(input);
    if (
      imported &&
      ((await sha256(await imported.blob.arrayBuffer())) !== imported.asset.sha256 ||
        imported.blob.size !== imported.asset.bytes)
    )
      throw new DomainError('INVALID_ASSET', '素材校验失败');
    const result = await this.transaction(['projects', 'assets'], 'readwrite', async (tx) => {
      const s = await this.state(tx, id),
        receipt = Object.hasOwn(s.receipts, input.requestId)
          ? s.receipts[input.requestId]
          : undefined;
      if (receipt) {
        if (receipt.hash !== hash)
          throw new DomainError('REQUEST_ID_REUSED', '同一请求 ID 不能携带不同参数');
        return { ok: true, revision: receipt.revision, replayed: true };
      }
      if (input.expectedRevision !== s.project.revision)
        throw new DomainError('REVISION_CONFLICT', '工程已更新，请读取最新版本', {
          currentRevision: s.project.revision,
        });
      const previous = clone(s.project);
      if ('action' in input) {
        const source = input.action === 'undo' ? s.past : s.future,
          dest = input.action === 'undo' ? s.future : s.past;
        const entry = source.pop();
        if (!entry) throw new DomainError('HISTORY_EMPTY', '没有可撤销或重做的操作');
        dest.push({ project: previous, label: entry.label, at: new Date().toISOString() });
        s.project = projectSchema.parse(entry.project);
        s.project.revision = previous.revision + 1;
        s.project.updatedAt = new Date().toISOString();
      } else {
        s.project = applyBatch(s.project, input);
        s.past.push({ project: previous, label: input.label, at: new Date().toISOString() });
        s.past = s.past.slice(-40);
        s.future = [];
      }
      if (imported)
        await request(tx.objectStore('assets').put(imported.blob, imported.asset.sha256));
      for (const a of Object.values(s.project.assets)) {
        if (!(await request(tx.objectStore('assets').getKey(a.sha256))))
          throw new DomainError('MISSING_ASSET', '素材文件不存在：' + a.name);
      }
      s.receipts = { ...s.receipts, [input.requestId]: { hash, revision: s.project.revision } };
      await request(tx.objectStore('projects').put(s));
      return { ok: true, revision: s.project.revision, replayed: false };
    });
    this.emit({ type: 'change', projectId: id });
    return result;
  }
  async createJob(projectId: string, raw: unknown, owner: string) {
    const options = exportSchema.parse(raw),
      hash = await digest(options),
      requestKey = projectId + ':' + options.requestId;
    const record = await this.transaction(['projects', 'jobs'], 'readwrite', async (tx) => {
      const jobs = tx.objectStore('jobs');
      const existing: JobRecord | undefined = await request(
        jobs.index('requestKey').get(requestKey),
      );
      if (existing) {
        if (existing.hash !== hash)
          throw new DomainError('REQUEST_ID_REUSED', '同一导出请求 ID 不能携带不同参数');
        return existing;
      }
      const p = (await this.state(tx, projectId)).project;
      if (p.revision !== options.expectedRevision)
        throw new DomainError('REVISION_CONFLICT', '工程已更新，请读取最新版本');
      if (options.sceneId && !p.scenes.some((s) => s.id === options.sceneId))
        throw new DomainError('NOT_FOUND', '找不到场景');
      if (options.variantId && !p.variants.some((v) => v.id === options.variantId))
        throw new DomainError('NOT_FOUND', '找不到封面');
      const errors = validateProject(p).filter((x) => x.severity === 'error');
      if (errors.length) throw new DomainError('INVALID_PROJECT', errors[0].message);
      const job: Job = {
        id: uid('job'),
        projectId,
        revision: p.revision,
        format: options.format,
        engine: options.format === 'mp4' ? 'wasm' : 'browser',
        sceneId: options.sceneId,
        variantId: options.variantId,
        status: 'queued',
        progress: 0,
        createdAt: new Date().toISOString(),
      };
      const record: JobRecord = {
        job,
        snapshot: p,
        requestKey,
        hash,
        owner,
        heartbeat: Date.now(),
      };
      await request(jobs.add(record));
      return record;
    });
    this.emit({ type: 'job', projectId, jobId: record.job.id });
    return record;
  }
  async job(id: string) {
    const record = await this.transaction(['jobs'], 'readonly', (tx) =>
      request<JobRecord | undefined>(tx.objectStore('jobs').get(idSchema.parse(id))),
    );
    if (!record) throw new DomainError('NOT_FOUND', '找不到导出任务');
    return record;
  }
  async jobs(projectId: string) {
    const records = await this.transaction(['jobs'], 'readonly', (tx) =>
      request<JobRecord[]>(tx.objectStore('jobs').index('projectId').getAll(projectId)),
    );
    return records.sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  }
  async updateJob(id: string, owner: string | null, patch: Partial<Job>, output?: Blob) {
    const record = await this.transaction(['jobs'], 'readwrite', async (tx) => {
      const jobs = tx.objectStore('jobs'),
        record: JobRecord | undefined = await request(jobs.get(id));
      if (!record) throw new DomainError('NOT_FOUND', '找不到导出任务');
      if (owner !== null && owner !== record.owner)
        throw new DomainError('JOB_OWNER', '导出属于另一个页面');
      if (!['queued', 'running'].includes(record.job.status)) return record;
      record.job = {
        ...record.job,
        ...patch,
        progress: Math.max(record.job.progress, patch.progress ?? 0),
      };
      record.heartbeat = Date.now();
      if (output) record.output = output;
      await request(jobs.put(record));
      return record;
    });
    this.emit({ type: 'job', projectId: record.job.projectId, jobId: id });
    return record;
  }
  async close() {
    this.channel?.close();
    (await this.connection)?.close();
    this.connection = undefined;
  }
}

export const store = new BrowserStore();
