import { describe, it, expect } from 'vitest';
import {
  applyBatch,
  applyCommands,
  duration,
  timeline,
  audioClips,
  parseSrt,
  toSrt,
  blankScene,
  validateProject,
} from '@muweave/core';
import { nodePatchSchema, projectSchema, type Asset } from '@muweave/schema';
import { createExample } from '../packages/core/src/example';
const audio: Asset = {
  id: 'voice',
  name: 'voice.flac',
  kind: 'audio',
  file: 'a'.repeat(64) + '.flac',
  sha256: 'a'.repeat(64),
  mime: 'audio/flac',
  bytes: 1200,
  durationUs: 7000000,
};
describe('atomic editing and timing', () => {
  it('maps legacy fonts in scenes, covers and patches without altering other content', () => {
    const original = applyCommands(createExample(), [
      {
        type: 'variant.create',
        sceneId: 'scene-1',
        id: 'cover',
        title: '封面',
      },
    ]);
    const title = original.scenes[0].nodes.find((n) => n.id === 'title')!;
    title.fontFamily = 'Manrope Variable';
    const coverTitle = original.variants[0].nodes.find((n) => n.id === 'title')!;
    coverTitle.fontFamily = 'Noto Sans SC Variable';
    const normalized = projectSchema.parse(original);
    expect(normalized.scenes[0].nodes.find((n) => n.id === 'title')).toEqual({
      ...title,
      fontFamily: 'Roboto',
    });
    expect(normalized.variants[0].nodes.find((n) => n.id === 'title')).toEqual({
      ...coverTitle,
      fontFamily: 'Noto Sans SC',
    });
    expect(validateProject(normalized).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(nodePatchSchema.parse({ fontFamily: 'Manrope' })).toEqual({
      fontFamily: 'Roboto',
    });
    expect(nodePatchSchema.parse({ fontFamily: 'MuweaveFont_a123' })).toEqual({
      fontFamily: 'MuweaveFont_a123',
    });
    expect(title.fontFamily).toBe('Manrope Variable');
  });
  it('a text patch preserves existing styles and positioning', () => {
    const p = createExample(),
      title = p.scenes[0].nodes.find((n) => n.id === 'title')!;
    const q = applyBatch(p, {
      expectedRevision: 0,
      requestId: 'text-1',
      commands: [
        { type: 'node.update', sceneId: 'scene-1', nodeId: 'title', changes: { text: '修改标题' } },
      ],
    });
    expect(q.scenes[0].nodes.find((n) => n.id === 'title')).toEqual({ ...title, text: '修改标题' });
    expect(nodePatchSchema.parse({ text: 'hello' })).toEqual({ text: 'hello' });
    expect(p.scenes[0].nodes.find((n) => n.id === 'title')!.text).not.toBe('修改标题');
  });
  it('does not apply the first command if the second fails', () => {
    const p = createExample();
    expect(() =>
      applyBatch(p, {
        expectedRevision: 0,
        requestId: 'atomic',
        commands: [
          { type: 'project.rename', title: 'bad' },
          { type: 'node.remove', sceneId: 'scene-1', nodeId: 'missing' },
        ],
      }),
    ).toThrow();
    expect(p.title).toBe('把好想法，编织成故事');
    expect(p.revision).toBe(0);
  });
  it('rejects missing IDs in reorder and stale writes', () => {
    const p = createExample();
    expect(() =>
      applyCommands(p, [{ type: 'scene.reorder', ids: ['scene-1', 'scene-1', 'scene-3'] }]),
    ).toThrow();
    expect(() =>
      applyBatch(p, {
        expectedRevision: 3,
        requestId: 'stale',
        commands: [{ type: 'project.rename', title: 'x' }],
      }),
    ).toThrow('工程已更新');
  });
  it('keeps captions anchored to trimmed speech and ripples later scenes exactly', () => {
    const p = createExample();
    p.assets.voice = audio;
    p.scenes[0].durationUs = 7000000;
    p.scenes[0].narration = {
      assetId: 'voice',
      trimStartUs: 0,
      trimEndUs: 7000000,
      offsetUs: 0,
      gain: 1,
    };
    p.scenes[0].captions = [{ id: 'c1', startUs: 1000000, endUs: 4000000, text: '口播内容' }];
    const q = applyCommands(p, [
      {
        type: 'narration.set',
        sceneId: 'scene-1',
        narration: {
          assetId: 'voice',
          trimStartUs: 700000,
          trimEndUs: 6000000,
          offsetUs: 0,
          gain: 1,
        },
        fitDuration: true,
      },
    ]);
    expect(q.scenes[0].captions[0]).toMatchObject({ startUs: 300000, endUs: 3300000 });
    expect(timeline(q)[1].startUs).toBe(5300000);
    expect(audioClips(q)[0].trimStartUs).toBe(700000);
    expect(duration(q)).toBe(17300000);
    expect(toSrt(q)).not.toContain('制作备注');
  });
  it('does not add implicit gaps or round each scene separately', () => {
    const p = createExample();
    p.scenes = Array.from({ length: 100 }, (_, i) => ({
      ...blankScene('s' + i),
      durationUs: 1234567,
    }));
    expect(duration(p)).toBe(123456700);
    const q = applyCommands(p, [{ type: 'timeline.set_gap', gapUs: 250000 }]);
    expect(duration(q) - duration(p)).toBe(99 * 250000);
  });
  it('moves captions with trimmed speech even when the scene keeps its duration', () => {
    const p = createExample();
    p.assets.voice = audio;
    p.scenes[0].narration = {
      assetId: 'voice',
      trimStartUs: 0,
      trimEndUs: 5000000,
      offsetUs: 0,
      gain: 1,
    };
    p.scenes[0].captions = [{ id: 'c', startUs: 500000, endUs: 2000000, text: '同一段声音' }];
    const q = applyCommands(p, [
      {
        type: 'narration.set',
        sceneId: 'scene-1',
        fitDuration: false,
        narration: {
          assetId: 'voice',
          trimStartUs: 400000,
          trimEndUs: 4000000,
          offsetUs: 200000,
          gain: 1,
        },
      },
    ]);
    expect(q.scenes[0].durationUs).toBe(6000000);
    expect(q.scenes[0].captions[0]).toMatchObject({ startUs: 300000, endUs: 1800000 });
    expect(timeline(q)[1].startUs).toBe(6000000);
  });
  it('creates a separately editable cover without touching the video', () => {
    const p = createExample(),
      original = structuredClone(p.scenes[0].nodes);
    const q = applyCommands(p, [
      { type: 'variant.create', sceneId: 'scene-1', id: 'cover', title: '封面' },
      {
        type: 'node.update',
        sceneId: 'scene-1',
        variantId: 'cover',
        nodeId: 'title',
        changes: { text: '封面标题' },
      },
    ]);
    expect(q.variants[0].width / q.variants[0].height).toBe(4 / 3);
    expect(q.scenes[0].nodes).toEqual(original);
  });
  it('parses actual SRT timing and rejects invalid captions', () => {
    const c = parseSrt('1\r\n00:00:00,300 --> 00:00:01,400\r\n你好\r\n');
    expect(c[0]).toMatchObject({ startUs: 300000, endUs: 1400000, text: '你好' });
    expect(() => parseSrt('this is a production note')).toThrow();
    const p = createExample();
    expect(() =>
      applyCommands(p, [
        {
          type: 'captions.set',
          sceneId: 'scene-1',
          captions: [{ id: 'c', startUs: 2000000, endUs: 1000000, text: 'x' }],
        },
      ]),
    ).toThrow('字幕时间');
  });
});
