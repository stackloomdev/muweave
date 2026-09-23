import { z } from 'zod';
import { DEFAULT_FONT_FAMILY, normalizeFontFamily } from './fonts';
export { BUILTIN_FONTS, DEFAULT_FONT_FAMILY, isBuiltinFont, normalizeFontFamily } from './fonts';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const usSchema = z.number().int().min(0).max(86_400_000_000);
const color = z.string().regex(/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/);
export const nodeSchema = z
  .object({
    id: idSchema,
    type: z.enum(['text', 'image', 'rect', 'ellipse', 'line']),
    name: z.string().max(200).default('图层'),
    x: z.number().min(-10000).max(20000),
    y: z.number().min(-10000).max(20000),
    width: z.number().min(1).max(10000),
    height: z.number().min(1).max(10000),
    rotation: z.number().min(-360).max(360).default(0),
    opacity: z.number().min(0).max(1).default(1),
    fill: color.default('#142d37'),
    stroke: color.optional(),
    strokeWidth: z.number().min(0).max(40).default(0),
    radius: z.number().min(0).max(500).default(0),
    locked: z.boolean().default(false),
    groupId: idSchema.optional(),
    text: z.string().max(20000).default(''),
    fontSize: z.number().min(8).max(500).default(48),
    fontFamily: z
      .string()
      .min(1)
      .max(150)
      .transform(normalizeFontFamily)
      .default(DEFAULT_FONT_FAMILY),
    bold: z.boolean().default(false),
    align: z.enum(['left', 'center', 'right']).default('left'),
    lineHeight: z.number().min(0.8).max(3).default(1.35),
    assetId: idSchema.optional(),
    fit: z.enum(['cover', 'contain']).default('cover'),
    enter: z.enum(['none', 'fade', 'slide', 'zoom']).default('none'),
    enterDurationUs: usSchema.default(500000),
  })
  .strict();
export type VisualNode = z.infer<typeof nodeSchema>;
function withoutDefaults<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.removeDefault() : field,
    ]),
  ) as { [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K] };
}
export const nodePatchSchema = z
  .object(withoutDefaults(nodeSchema.omit({ id: true, type: true }).shape))
  .partial()
  .strict();
export const captionSchema = z
  .object({ id: idSchema, startUs: usSchema, endUs: usSchema, text: z.string().min(1).max(2000) })
  .strict();
export const narrationSchema = z
  .object({
    assetId: idSchema,
    trimStartUs: usSchema,
    trimEndUs: usSchema,
    offsetUs: usSchema.default(0),
    gain: z.number().min(0).max(2).default(1),
  })
  .strict();
export const sceneSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    durationUs: usSchema.min(100000),
    gapUs: usSchema.max(10000000).default(0),
    background: color.default('#f7f2e8'),
    nodes: z.array(nodeSchema).max(500),
    narrationText: z.string().max(50000).default(''),
    notes: z.string().max(50000).default(''),
    narration: narrationSchema.optional(),
    captions: z.array(captionSchema).max(5000).default([]),
    transition: z.enum(['cut', 'crossfade']).default('cut'),
  })
  .strict();
export type Scene = z.infer<typeof sceneSchema>;
export const assetSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(250),
    kind: z.enum(['image', 'audio', 'font']),
    file: z.string().regex(/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mime: z.string().max(100),
    bytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    durationUs: usSchema.optional(),
    fontFamily: z.string().max(150).optional(),
    peaks: z.array(z.number().min(0).max(1)).max(500).optional(),
  })
  .strict();
export type Asset = z.infer<typeof assetSchema>;
export const variantSchema = z
  .object({
    id: idSchema,
    title: z.string().max(200),
    sourceSceneId: idSchema,
    width: z.number().int().min(100).max(4096),
    height: z.number().int().min(100).max(4096),
    background: color,
    nodes: z.array(nodeSchema).max(500),
  })
  .strict();
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    revision: z.number().int().min(0),
    title: z.string().min(1).max(200),
    createdAt: z.string(),
    updatedAt: z.string(),
    width: z.literal(1920),
    height: z.literal(1080),
    fps: z.literal(30),
    scenes: z.array(sceneSchema).min(1).max(200),
    assets: z.record(idSchema, assetSchema),
    variants: z.array(variantSchema).max(30).default([]),
    music: z
      .object({
        assetId: idSchema,
        gain: z.number().min(0).max(2).default(0.12),
        trimStartUs: usSchema.default(0),
      })
      .optional(),
    showCaptions: z.boolean().default(true),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
const target = { sceneId: idSchema, variantId: idSchema.optional() };
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.rename'), title: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal('project.captions'), visible: z.boolean() }).strict(),
  z
    .object({ type: z.literal('scene.add'), scene: sceneSchema, afterId: idSchema.optional() })
    .strict(),
  z.object({ type: z.literal('scene.duplicate'), sceneId: idSchema, newId: idSchema }).strict(),
  z.object({ type: z.literal('scene.remove'), sceneId: idSchema }).strict(),
  z.object({ type: z.literal('scene.reorder'), ids: z.array(idSchema) }).strict(),
  z
    .object({
      type: z.literal('scene.update'),
      sceneId: idSchema,
      changes: z
        .object(
          withoutDefaults(
            sceneSchema.omit({ id: true, nodes: true, captions: true, narration: true }).shape,
          ),
        )
        .partial()
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('node.add'), ...target, node: nodeSchema }).strict(),
  z
    .object({
      type: z.literal('node.update'),
      ...target,
      nodeId: idSchema,
      changes: nodePatchSchema,
    })
    .strict(),
  z.object({ type: z.literal('node.remove'), ...target, nodeId: idSchema }).strict(),
  z.object({ type: z.literal('node.reorder'), ...target, ids: z.array(idSchema) }).strict(),
  z
    .object({
      type: z.literal('nodes.group'),
      ...target,
      ids: z.array(idSchema).min(1),
      groupId: idSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal('asset.add'), asset: assetSchema }).strict(),
  z
    .object({
      type: z.literal('narration.set'),
      sceneId: idSchema,
      narration: narrationSchema.nullable(),
      fitDuration: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal('captions.set'),
      sceneId: idSchema,
      captions: z.array(captionSchema).max(5000),
    })
    .strict(),
  z
    .object({ type: z.literal('music.set'), music: projectSchema.shape.music.unwrap().nullable() })
    .strict(),
  z.object({ type: z.literal('timeline.set_gap'), gapUs: usSchema.max(10000000) }).strict(),
  z
    .object({
      type: z.literal('variant.create'),
      sceneId: idSchema,
      id: idSchema,
      title: z.string().max(200).default('4:3 封面'),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const batchSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    requestId: idSchema,
    label: z.string().max(200).default('编辑工程'),
    commands: z.array(commandSchema).min(1).max(500),
  })
  .strict();
export type Batch = z.infer<typeof batchSchema>;
export type Issue = {
  code: string;
  message: string;
  objectId?: string;
  severity: 'error' | 'warning';
};
export type Job = {
  id: string;
  projectId: string;
  revision: number;
  format: 'mp4' | 'png' | 'bundle';
  engine?: 'browser' | 'wasm';
  downloadUrl?: string;
  stage?: string;
  variantId?: string;
  sceneId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  progress: number;
  createdAt: string;
  error?: string;
  file?: string;
  report?: Record<string, unknown>;
};
export const exportSchema = z
  .object({
    format: z.enum(['mp4', 'png', 'bundle']),
    engine: z.enum(['browser', 'wasm']).optional(),
    sceneId: idSchema.optional(),
    variantId: idSchema.optional(),
    expectedRevision: z.number().int().min(0),
    requestId: idSchema,
  })
  .strict()
  .refine((v) => v.format === 'png' || (!v.variantId && !v.sceneId), {
    message: 'sceneId 和 variantId 只适用于 PNG 导出',
  });
export const browserProgressSchema = z
  .object({
    runnerId: idSchema,
    progress: z.number().min(0).max(1),
    stage: z.string().max(100),
    error: z.string().max(2000).optional(),
  })
  .strict();
export const browserReportSchema = z
  .object({
    engine: z.literal('ffmpeg.wasm'),
    coreVersion: z.literal('0.12.10'),
    threads: z.literal(1),
    revision: z.number().int().min(0),
    frames: z.number().int().positive(),
    fps: z.literal(30),
    width: z.literal(1920),
    height: z.literal(1080),
    durationSeconds: z.number().positive(),
    renderSeconds: z.number().nonnegative(),
    loadSeconds: z.number().nonnegative(),
    outputBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    chunks: z.number().int().positive(),
    maxBufferedFrames: z.number().int().positive(),
    maxBufferedPngBytes: z.number().int().positive(),
    codec: z.literal('h264'),
    audioCodec: z.literal('aac'),
    fullDecode: z.literal('passed'),
  })
  .strict();
