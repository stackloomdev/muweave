import {
  projectSchema,
  nodeSchema,
  sceneSchema,
  type VisualNode,
  type Project,
} from '@muweave/schema';
const n = (
  id: string,
  type: VisualNode['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<VisualNode> = {},
) => nodeSchema.parse({ id, type, x, y, width, height, ...extra });
const text = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
  size = 36,
  extra: Partial<VisualNode> = {},
) =>
  n(id, 'text', x, y, width, height, {
    name: value.slice(0, 14),
    text: value,
    fontSize: size,
    ...extra,
  });
const rect = (id: string, x: number, y: number, w: number, h: number, fill: string, radius = 28) =>
  n(id, 'rect', x, y, w, h, { fill, radius });
export function createExample(id = 'welcome'): Project {
  const now = new Date().toISOString();
  const first = [
    text('eyebrow', 110, 76, 900, 55, 'MUWEAVE  /  创作手记 01', 26, { fill: '#568277' }),
    text('title', 106, 177, 1560, 155, '好想法，值得被看见。', 106, {
      bold: true,
      fill: '#153b37',
    }),
    text('subtitle', 110, 342, 1550, 80, '把零散的内容，编织成清晰、生动的图文故事。', 40, {
      fill: '#56716a',
    }),
    rect('card-1', 110, 480, 520, 345, '#dfebe2'),
    rect('card-2', 700, 480, 520, 345, '#eee4d2'),
    rect('card-3', 1290, 480, 520, 345, '#e9dfd5'),
    text('num-1', 152, 515, 140, 65, '01', 32, { fill: '#3e8070' }),
    text('num-2', 742, 515, 140, 65, '02', 32, { fill: '#9b7945' }),
    text('num-3', 1332, 515, 140, 65, '03', 32, { fill: '#a47259' }),
    text('label-1', 152, 640, 420, 65, '整理内容', 48, { bold: true }),
    text('label-2', 742, 640, 420, 65, '编排画面', 48, { bold: true }),
    text('label-3', 1332, 640, 420, 65, '让故事流动', 48, { bold: true }),
    text('body-1', 152, 731, 430, 65, '讲清楚一件真正重要的事', 27, { fill: '#59736a' }),
    text('body-2', 742, 731, 430, 65, '文字、图片，各在其位', 27, { fill: '#7a725e' }),
    text('body-3', 1332, 731, 430, 65, '配音与字幕，跟着画面走', 27, { fill: '#827062' }),
    n('orb-1', 'ellipse', 443, 512, 104, 104, { fill: '#80ac97' }),
    rect('shape-2', 1040, 510, 108, 88, '#c5a572', 13),
    ...[42, 72, 106, 64, 38].map((h, i) =>
      rect('wave-' + i, 1615 + i * 24, 570 - h / 2, 13, h, '#bd9477', 7),
    ),
    n('line', 'line', 110, 912, 1700, 2, { fill: '#d3d9cd' }),
    text('footer', 110, 958, 1400, 50, '你的想法  ×  Agent 的执行力  ×  可亲手调整的画布', 25, {
      fill: '#70847a',
    }),
    text('page', 1670, 949, 130, 60, '01 / 03', 25, { align: 'right', fill: '#70847a' }),
  ];
  const second = [
    text('eyebrow', 110, 76, 1400, 55, 'MUWEAVE  /  编排的艺术', 26, { fill: '#568277' }),
    text('title', 110, 173, 1650, 155, '让信息，有层次。', 110, { bold: true, fill: '#153b37' }),
    text('subtitle', 110, 340, 1600, 70, '一个画面，一个重点；复杂的内容，也可以清楚地表达。', 38, {
      fill: '#59736a',
    }),
    rect('panel', 110, 478, 1050, 405, '#dfebe2'),
    text('hero-word', 170, 550, 900, 100, '先看见重点，再读懂细节。', 57, { bold: true }),
    text(
      'hero-note',
      173,
      703,
      850,
      115,
      '标题建立方向，图示解释关系。\n留白，让理解有呼吸的空间。',
      33,
      { fill: '#527064' },
    ),
    rect('detail-a', 1220, 478, 590, 178, '#eee4d2'),
    rect('detail-b', 1220, 706, 590, 178, '#e9dfd5'),
    text('detail-text-a', 1270, 518, 500, 100, '文字保持可编辑\n修改，不必从头生成', 30, {
      fill: '#665b42',
    }),
    text('detail-text-b', 1270, 748, 500, 100, '素材保持独立\n比例变化，也能重新编排', 30, {
      fill: '#7b5f4e',
    }),
    text('footer', 110, 958, 1400, 50, '画面文案、口播和制作备注，分别管理。', 25, {
      fill: '#70847a',
    }),
    text('page', 1670, 949, 130, 60, '02 / 03', 25, { align: 'right', fill: '#70847a' }),
  ];
  const third = [
    text('eyebrow', 110, 76, 1400, 55, 'MUWEAVE  /  从画布到作品', 26, { fill: '#568277' }),
    text('title', 110, 173, 1670, 140, '好节奏，把故事连起来。', 100, {
      bold: true,
      fill: '#153b37',
    }),
    text('subtitle', 110, 340, 1600, 80, '画面切换、声音停顿、字幕出现，共用一条时间线。', 37, {
      fill: '#59736a',
    }),
    rect('track-bg', 110, 487, 1700, 365, '#e4ebe1'),
    ...[0, 1, 2].flatMap((v) => [
      rect('scene-bar-' + v, 164 + v * 529, 547, 490, 95, ['#89ad99', '#c8ad80', '#c49d86'][v], 18),
      text(
        'scene-text-' + v,
        194 + v * 529,
        574,
        430,
        60,
        ['开始 · 引出问题', '展开 · 解释关系', '收束 · 留下结论'][v],
        28,
        { fill: '#ffffff' },
      ),
    ]),
    ...Array.from({ length: 70 }, (_, i) =>
      rect(
        'audio-' + i,
        171 + i * 22,
        735 - (20 + Math.abs(Math.sin(i * 2.4)) * 55) / 2,
        9,
        20 + Math.abs(Math.sin(i * 2.4)) * 55,
        '#77a892',
        5,
      ),
    ),
    text('footer', 110, 958, 1400, 50, '准备好后，导出视频、静态封面，或带走整个工程。', 25, {
      fill: '#70847a',
    }),
    text('page', 1670, 949, 130, 60, '03 / 03', 25, { align: 'right', fill: '#70847a' }),
  ];
  return projectSchema.parse({
    schemaVersion: 1,
    id,
    revision: 0,
    title: '把好想法，编织成故事',
    createdAt: now,
    updatedAt: now,
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {},
    variants: [],
    scenes: [first, second, third].map((nodes, i) =>
      sceneSchema.parse({
        id: 'scene-' + (i + 1),
        title: ['好想法，值得被看见', '让信息，有层次', '把故事连起来'][i],
        durationUs: 6000000,
        nodes,
        narrationText: [
          '把零散的内容，编织成清晰、生动的图文故事。',
          '一个画面，一个重点。复杂的内容，也可以清楚地表达。',
          '画面切换、声音停顿、字幕出现，共用一条时间线。',
        ][i],
        notes: '这是制作备注，仅在编辑器可见。',
      }),
    ),
  });
}
