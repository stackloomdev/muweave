import { z } from 'zod';
import { batchSchema, idSchema, projectSchema, sceneSchema, type Project } from '@muweave/schema';
import { applyBatch, DomainError, duration, timeline, validateProject } from '@muweave/core';

export const DRAFT_LIMITS = Object.freeze({
  scenes: 30,
  nodes: 600,
  captions: 600,
  bytes: 128 * 1024,
});
const dateTime = z.iso.datetime();
export const createDraftSchema = z
  .object({
    projectId: idSchema.describe(
      'Choose a stable unique draft ID and reuse it when retrying this exact request.',
    ),
    createdAt: dateTime.describe('ISO UTC timestamp. Reuse it when retrying.'),
    title: projectSchema.shape.title,
    scenes: z.array(sceneSchema).min(1).max(DRAFT_LIMITS.scenes),
  })
  .strict();
export const snapshotSchema = z
  .object({
    projectId: idSchema.describe(
      'Must match snapshot.id. This is a consistency check, not authentication.',
    ),
    snapshot: projectSchema.describe(
      'Complete draft from the latest tool result for this project. IDs alone cannot retrieve data.',
    ),
  })
  .strict();
export const applyDraftSchema = snapshotSchema
  .extend({
    batch: batchSchema,
    editedAt: dateTime.describe(
      'ISO UTC timestamp at or after snapshot.updatedAt. Reuse on retries.',
    ),
  })
  .strict();

export function checkDraft(p: Project): Project {
  p = projectSchema.parse(p);
  const nodes = [...p.scenes, ...p.variants].flatMap((s) => s.nodes);
  if (
    new TextEncoder().encode(JSON.stringify(p)).length > DRAFT_LIMITS.bytes ||
    p.scenes.length > DRAFT_LIMITS.scenes ||
    nodes.length > DRAFT_LIMITS.nodes ||
    p.scenes.reduce((n, s) => n + s.captions.length, 0) > DRAFT_LIMITS.captions
  ) {
    throw new DomainError(
      'DRAFT_LIMIT',
      '分镜超出首版限制：30 页、600 图层、600 条字幕、128 KiB。请拆分工程。',
    );
  }
  if (
    Object.keys(p.assets).length ||
    p.music ||
    p.scenes.some((s) => s.narration) ||
    nodes.some((n) => n.type === 'image' || n.assetId)
  ) {
    throw new DomainError(
      'MEDIA_NOT_SUPPORTED',
      '远程分镜只支持文字和形状。图片、音频与字体文件请在幕织网页导入。',
    );
  }
  if (
    !dateTime.safeParse(p.createdAt).success ||
    !dateTime.safeParse(p.updatedAt).success ||
    Date.parse(p.updatedAt) < Date.parse(p.createdAt)
  ) {
    throw new DomainError(
      'INVALID_TIMESTAMP',
      '工程时间必须为有效 UTC 时间，修改时间不能早于创建时间。',
    );
  }
  const errors = validateProject(p).filter((i) => i.severity === 'error');
  if (errors.length) throw new DomainError(errors[0].code, errors[0].message);
  return p;
}
export function readDraft(raw: unknown) {
  const { projectId, snapshot } = snapshotSchema.parse(raw);
  if (projectId !== snapshot.id)
    throw new DomainError(
      'PROJECT_MISMATCH',
      '工程 ID 与快照不一致。请使用同一工程的最新工具结果。',
    );
  return checkDraft(snapshot);
}
export function createDraft(raw: unknown): Project {
  const i = createDraftSchema.parse(raw);
  return checkDraft(
    projectSchema.parse({
      schemaVersion: 1,
      id: i.projectId,
      revision: 0,
      title: i.title,
      createdAt: i.createdAt,
      updatedAt: i.createdAt,
      width: 1920,
      height: 1080,
      fps: 30,
      scenes: i.scenes,
      assets: {},
      variants: [],
    }),
  );
}
export function editDraft(raw: unknown): Project {
  const i = applyDraftSchema.parse(raw);
  const p = readDraft({ projectId: i.projectId, snapshot: i.snapshot });
  if (Date.parse(i.editedAt) < Date.parse(p.updatedAt)) {
    throw new DomainError('INVALID_TIMESTAMP', '修改时间不能早于当前快照。');
  }
  // No receipt store: retries of an identical snapshot/batch/time are pure and repeatable.
  // Revision checks cannot establish the latest version across separate conversations.
  const result = applyBatch(p, i.batch);
  result.updatedAt = i.editedAt;
  return checkDraft(result);
}
export function describeDraft(p: Project) {
  return {
    project: p,
    summary: {
      projectId: p.id,
      revision: p.revision,
      sceneCount: p.scenes.length,
      durationUs: duration(p),
    },
    timeline: timeline(p).map(({ scene, startUs, endUs }) => ({
      sceneId: scene.id,
      title: scene.title,
      startUs,
      endUs,
    })),
    issues: validateProject(p),
    storage: 'caller-supplied-snapshot' as const,
  };
}
