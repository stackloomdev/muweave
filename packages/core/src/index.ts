import {
  batchSchema,
  nodeSchema,
  projectSchema,
  sceneSchema,
  isBuiltinFont,
  type Project,
  type Scene,
  type VisualNode,
  type Issue,
  type Command,
} from '@muweave/schema';
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export const uid = (prefix = 'id') =>
  prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
export const clone = <T>(v: T): T => structuredClone(v);
export const seconds = (us: number) => us / 1e6;
export function timeline(project: Project) {
  let startUs = 0;
  return project.scenes.map((scene, index) => {
    const item = {
      scene,
      startUs,
      endUs: startUs + scene.durationUs,
      holdEndUs: startUs + scene.durationUs + (index < project.scenes.length - 1 ? scene.gapUs : 0),
    };
    startUs = item.holdEndUs;
    return item;
  });
}
export const duration = (p: Project) => timeline(p).at(-1)!.holdEndUs;
export const timeLabel = (us: number) => {
  const s = Math.floor(us / 1e6);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
export const sceneAt = (p: Project, t: number) =>
  timeline(p).find((x) => t < x.holdEndUs) ?? timeline(p).at(-1)!;
export function getNodes(p: Project, sceneId: string, variantId?: string) {
  if (variantId) {
    const v = p.variants.find((v) => v.id === variantId);
    if (!v) throw new DomainError('NOT_FOUND', '找不到封面布局');
    return v.nodes;
  }
  return getScene(p, sceneId).nodes;
}
export function getScene(p: Project, id: string): Scene {
  const s = p.scenes.find((s) => s.id === id);
  if (!s) throw new DomainError('NOT_FOUND', '找不到场景：' + id);
  return s;
}
function reorder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  if (
    ids.length !== items.length ||
    new Set(ids).size !== items.length ||
    ids.some((id) => !items.some((i) => i.id === id))
  )
    throw new DomainError('INVALID_ORDER', '排序必须包含每个对象一次');
  return ids.map((id) => items.find((i) => i.id === id)!);
}
export function validateProject(p: Project): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, id?: string) =>
    issues.push({ code, message, objectId: id, severity: 'error' });
  const ids = new Set<string>();
  for (const s of p.scenes) {
    if (ids.has(s.id)) err('DUPLICATE_ID', '场景 ID 重复', s.id);
    ids.add(s.id);
    for (const c of s.captions)
      if (c.endUs <= c.startUs || c.endUs > s.durationUs)
        err('INVALID_TIMING', '字幕时间超出场景或倒置', c.id);
    if (new Set(s.captions.map((c) => c.id)).size !== s.captions.length)
      err('DUPLICATE_ID', '字幕 ID 重复', s.id);
    if (s.narration) {
      const n = s.narration,
        a = p.assets[n.assetId];
      if (!a || a.kind !== 'audio') err('MISSING_ASSET', '缺少配音素材', s.id);
      else if (
        !a.durationUs ||
        n.trimEndUs > a.durationUs ||
        n.trimStartUs >= n.trimEndUs ||
        n.offsetUs + n.trimEndUs - n.trimStartUs > s.durationUs
      )
        err('INVALID_TIMING', '配音裁剪或场景时长无效', s.id);
    }
  }
  if (p.music) {
    const a = p.assets[p.music.assetId];
    if (!a || a.kind !== 'audio') err('MISSING_ASSET', '缺少背景音乐');
    else if (p.music.trimStartUs >= (a.durationUs ?? 0)) err('INVALID_TIMING', '音乐裁剪超出素材');
  }
  if (new Set(p.variants.map((v) => v.id)).size !== p.variants.length)
    err('DUPLICATE_ID', '封面 ID 重复');
  for (const v of p.variants)
    if (!p.scenes.some((s) => s.id === v.sourceSceneId))
      err('NOT_FOUND', '封面来源场景不存在', v.id);
  for (const item of [
    ...p.scenes.map((s) => ({ ...s, width: p.width, height: p.height })),
    ...p.variants,
  ]) {
    const nodeIds = new Set<string>();
    for (const n of item.nodes) {
      if (nodeIds.has(n.id)) err('DUPLICATE_ID', '图层 ID 重复', n.id);
      nodeIds.add(n.id);
      if (n.type === 'image' && (!n.assetId || p.assets[n.assetId]?.kind !== 'image'))
        err('MISSING_ASSET', '图层缺少图片素材', n.id);
      if (
        n.type === 'text' &&
        !isBuiltinFont(n.fontFamily) &&
        !Object.values(p.assets).some((a) => a.kind === 'font' && a.fontFamily === n.fontFamily)
      )
        err('FONT_MISSING', '请导入字体后再使用：' + n.fontFamily, n.id);
      if (n.x < 0 || n.y < 0 || n.x + n.width > item.width + 1 || n.y + n.height > item.height + 1)
        issues.push({
          code: 'OUTSIDE_CANVAS',
          message: '图层超出画布，请检查裁切',
          objectId: n.id,
          severity: 'warning',
        });
    }
  }
  return issues;
}
export function applyCommands(original: Project, commands: Command[]): Project {
  const p = clone(original);
  for (const c of commands) {
    switch (c.type) {
      case 'project.rename':
        p.title = c.title;
        break;
      case 'project.captions':
        p.showCaptions = c.visible;
        break;
      case 'scene.add': {
        if (c.afterId) getScene(p, c.afterId);
        p.scenes.splice(
          c.afterId ? p.scenes.findIndex((s) => s.id === c.afterId) + 1 : p.scenes.length,
          0,
          clone(c.scene),
        );
        break;
      }
      case 'scene.duplicate': {
        const s = clone(getScene(p, c.sceneId));
        s.id = c.newId;
        s.title += ' · 副本';
        p.scenes.splice(p.scenes.findIndex((s) => s.id === c.sceneId) + 1, 0, s);
        break;
      }
      case 'scene.remove':
        getScene(p, c.sceneId);
        if (p.scenes.length === 1) throw new DomainError('LAST_SCENE', '至少保留一个场景');
        p.scenes = p.scenes.filter((s) => s.id !== c.sceneId);
        p.variants = p.variants.filter((v) => v.sourceSceneId !== c.sceneId);
        break;
      case 'scene.reorder':
        p.scenes = reorder(p.scenes, c.ids);
        break;
      case 'scene.update':
        Object.assign(getScene(p, c.sceneId), c.changes);
        break;
      case 'node.add':
        getNodes(p, c.sceneId, c.variantId).push(clone(c.node));
        break;
      case 'node.update': {
        const n = getNodes(p, c.sceneId, c.variantId).find((n) => n.id === c.nodeId);
        if (!n) throw new DomainError('NOT_FOUND', '找不到图层');
        if (n.locked && !(Object.keys(c.changes).length === 1 && c.changes.locked === false))
          throw new DomainError('NODE_LOCKED', '请先解锁图层');
        Object.assign(n, c.changes);
        break;
      }
      case 'node.remove': {
        const nodes = getNodes(p, c.sceneId, c.variantId),
          i = nodes.findIndex((n) => n.id === c.nodeId);
        if (i < 0) throw new DomainError('NOT_FOUND', '找不到图层');
        if (nodes[i].locked) throw new DomainError('NODE_LOCKED', '请先解锁图层');
        nodes.splice(i, 1);
        break;
      }
      case 'node.reorder': {
        const nodes = getNodes(p, c.sceneId, c.variantId),
          ordered = reorder(nodes, c.ids);
        nodes.splice(0, nodes.length, ...ordered);
        break;
      }
      case 'nodes.group': {
        const nodes = getNodes(p, c.sceneId, c.variantId);
        for (const id of c.ids) {
          const n = nodes.find((n) => n.id === id);
          if (!n || n.locked) throw new DomainError('INVALID_GROUP', '图层不存在或已锁定');
          n.groupId = c.groupId ?? undefined;
        }
        break;
      }
      case 'asset.add':
        if (p.assets[c.asset.id] && p.assets[c.asset.id].sha256 !== c.asset.sha256)
          throw new DomainError('DUPLICATE_ID', '素材 ID 冲突');
        p.assets[c.asset.id] = clone(c.asset);
        break;
      case 'narration.set': {
        const s = getScene(p, c.sceneId),
          previous = s.narration;
        s.narration = c.narration ?? undefined;
        if (c.narration) {
          const clipEnd = c.narration.offsetUs + c.narration.trimEndUs - c.narration.trimStartUs;
          if (c.fitDuration) s.durationUs = clipEnd;
          if (
            previous?.assetId === c.narration.assetId &&
            (previous.trimStartUs !== c.narration.trimStartUs ||
              previous.trimEndUs !== c.narration.trimEndUs ||
              previous.offsetUs !== c.narration.offsetUs)
          ) {
            const delta =
              c.narration.trimStartUs -
              previous.trimStartUs -
              (c.narration.offsetUs - previous.offsetUs);
            s.captions = s.captions
              .map((k) => ({
                ...k,
                startUs: Math.max(c.narration!.offsetUs, k.startUs - delta),
                endUs: Math.min(s.durationUs, clipEnd, k.endUs - delta),
              }))
              .filter((k) => k.endUs > k.startUs);
          } else if (c.fitDuration) s.captions = s.captions.filter((k) => k.endUs <= s.durationUs);
        }
        break;
      }
      case 'captions.set':
        getScene(p, c.sceneId).captions = clone(c.captions).sort((a, b) => a.startUs - b.startUs);
        break;
      case 'music.set':
        p.music = c.music ?? undefined;
        break;
      case 'timeline.set_gap':
        p.scenes.forEach((s) => (s.gapUs = c.gapUs));
        break;
      case 'variant.create': {
        const s = getScene(p, c.sceneId);
        p.variants.push({
          id: c.id,
          title: c.title,
          sourceSceneId: s.id,
          width: 1440,
          height: 1080,
          background: s.background,
          nodes: s.nodes.map((n) => ({
            ...clone(n),
            x: n.x * 0.75,
            y: n.y,
            width: n.width * 0.75,
            fontSize: Math.max(8, n.fontSize * 0.75),
          })),
        });
        break;
      }
    }
  }
  const parsed = projectSchema.parse(p),
    errors = validateProject(parsed).filter((i) => i.severity === 'error');
  if (errors.length) throw new DomainError(errors[0].code, errors[0].message, { issues: errors });
  return parsed;
}
export function applyBatch(p: Project, input: unknown): Project {
  const batch = batchSchema.parse(input);
  if (batch.expectedRevision !== p.revision)
    throw new DomainError('REVISION_CONFLICT', '工程已更新，请读取最新版本', {
      currentRevision: p.revision,
    });
  const result = applyCommands(p, batch.commands);
  result.revision = p.revision + 1;
  result.updatedAt = new Date().toISOString();
  return result;
}
export function audioClips(p: Project) {
  const clips = timeline(p).flatMap(({ scene, startUs }) =>
    scene.narration
      ? [{ ...scene.narration, startUs: startUs + scene.narration.offsetUs, sceneId: scene.id }]
      : [],
  );
  if (p.music) {
    const a = p.assets[p.music.assetId];
    clips.push({
      assetId: a.id,
      trimStartUs: p.music.trimStartUs,
      trimEndUs: Math.min(a.durationUs!, p.music.trimStartUs + duration(p)),
      offsetUs: 0,
      gain: p.music.gain,
      startUs: 0,
      sceneId: 'music',
    });
  }
  return clips;
}
const stamp = (us: number) => {
  const ms = Math.round(us / 1000),
    s = Math.floor(ms / 1000);
  return (
    String(Math.floor(s / 3600)).padStart(2, '0') +
    ':' +
    String(Math.floor(s / 60) % 60).padStart(2, '0') +
    ':' +
    String(s % 60).padStart(2, '0') +
    ',' +
    String(ms % 1000).padStart(3, '0')
  );
};
export function toSrt(p: Project) {
  let i = 0;
  return timeline(p)
    .flatMap(({ scene, startUs }) =>
      scene.captions.map(
        (c) =>
          String(++i) +
          '\n' +
          stamp(startUs + c.startUs) +
          ' --> ' +
          stamp(startUs + c.endUs) +
          '\n' +
          c.text +
          '\n',
      ),
    )
    .join('\n');
}
export function parseSrt(text: string) {
  return text
    .replaceAll('\r', '')
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block, i) => {
      const lines = block.split('\n');
      if (/^\d+$/.test(lines[0])) lines.shift();
      const match = lines
        .shift()
        ?.match(
          /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/,
        );
      if (!match)
        throw new DomainError('INVALID_SUBTITLES', '第 ' + (i + 1) + ' 条字幕缺少有效时间');
      const t = (o: number) =>
        (Number(match[o]) * 3600 + Number(match[o + 1]) * 60 + Number(match[o + 2])) * 1e6 +
        Number(match[o + 3]) * 1000;
      return { id: uid('caption'), startUs: t(1), endUs: t(5), text: lines.join('\n') };
    });
}
export function blankScene(id = uid('scene'), title = '新场景'): Scene {
  return sceneSchema.parse({
    id,
    title,
    durationUs: 6000000,
    nodes: [
      nodeSchema.parse({
        id: uid('title'),
        type: 'text',
        name: '标题',
        x: 140,
        y: 150,
        width: 1600,
        height: 200,
        text: '从一个想法开始。',
        fontSize: 96,
        bold: true,
      }),
    ],
  });
}
export { audioMixArgs } from './export-audio';
