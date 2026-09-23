import { unzip, zip, strToU8, strFromU8 } from 'fflate';
import { projectSchema, type Project } from '@muweave/schema';
import { uid, DomainError } from '@muweave/core';
import { store, sha256 } from './storage';
import { prepareAsset } from './media';
import { checkDraft, DRAFT_LIMITS } from '../../../packages/mcp/src/drafts';

const LIMIT = 250 * 1024 * 1024;
export async function exportBundle(p: Project, signal: AbortSignal) {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(p, null, 2)) };
  let size = files['project.json'].length;
  for (const a of Object.values(p.assets)) {
    signal.throwIfAborted();
    if (files['assets/' + a.file]) continue;
    const blob = await store.asset(a.sha256);
    size += blob.size;
    if (size > LIMIT) throw new Error('工程包超过 250 MB，请拆分工程');
    files['assets/' + a.file] = new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Blob>((resolve, reject) => {
    signal.throwIfAborted();
    const terminate = zip(files, { level: 0 }, (error, data) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    });
    const abort = () => {
      terminate();
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function importBundle(file: Blob) {
  if (
    file.type === 'application/json' ||
    (file instanceof File && file.name.toLowerCase().endsWith('.json'))
  ) {
    if (!file.size || file.size > DRAFT_LIMITS.bytes)
      throw new Error('分镜 JSON 需在 0–128 KiB 之间');
    const p = checkDraft(projectSchema.parse(JSON.parse(await file.text())));
    p.id = uid('project');
    p.revision = 0;
    p.createdAt = p.updatedAt = new Date().toISOString();
    return store.importProject(p, new Map());
  }
  if (!file.size || file.size > LIMIT) throw new Error('工程包大小需在 0–250 MB 之间');
  let size = 0,
    rejected = false;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    void file
      .arrayBuffer()
      .then((buffer) =>
        unzip(
          new Uint8Array(buffer),
          {
            filter: (entry) => {
              size += entry.originalSize;
              const valid =
                (entry.name === 'project.json' ||
                  /^assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(entry.name)) &&
                entry.originalSize <= 100 * 1024 * 1024 &&
                size <= LIMIT;
              if (!valid) rejected = true;
              return valid;
            },
          },
          (error, files) => (error ? reject(error) : resolve(files)),
        ),
      )
      .catch(reject);
  });
  if (rejected || !files['project.json'])
    throw new DomainError('INVALID_BUNDLE', '工程包结构或大小不符合要求');
  const p = projectSchema.parse(JSON.parse(strFromU8(files['project.json']))),
    blobs = new Map<string, Blob>();
  for (const asset of Object.values(p.assets)) {
    const bytes = files['assets/' + asset.file];
    if (
      !bytes ||
      bytes.byteLength !== asset.bytes ||
      (await sha256(bytes.slice().buffer)) !== asset.sha256
    )
      throw new Error('工程包素材校验失败：' + asset.name);
    const prepared = await prepareAsset(asset.file, new Blob([bytes.slice().buffer]), true);
    if (prepared.asset.kind !== asset.kind) throw new Error('工程包素材类型不匹配');
    // Keep content-addressed bytes and IDs so trims, history-free imports, and old bundles agree.
    p.assets[asset.id] = { ...prepared.asset, id: asset.id, name: asset.name };
    blobs.set(asset.sha256, prepared.blob);
  }
  p.id = uid('project');
  p.revision = 0;
  p.createdAt = p.updatedAt = new Date().toISOString();
  return store.importProject(p, blobs);
}
