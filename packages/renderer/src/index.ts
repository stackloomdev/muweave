import Konva from 'konva';
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamily,
  type Project,
  type VisualNode,
  type Issue,
} from '@muweave/schema';
import { timeline, sceneAt } from '@muweave/core';

export type FrameOptions = {
  sceneId?: string;
  variantId?: string;
  still?: boolean;
  captions?: boolean;
};
export function evaluateFrame(p: Project, timeUs: number, options: FrameOptions = {}) {
  if (options.variantId) {
    const v = p.variants.find((v) => v.id === options.variantId);
    if (!v) throw new Error('找不到封面布局');
    return {
      width: v.width,
      height: v.height,
      parts: [{ nodes: v.nodes, background: v.background, opacity: 1, localUs: 0, still: true }],
      caption: '',
    };
  }
  const entries = timeline(p),
    active = options.sceneId
      ? entries.find((x) => x.scene.id === options.sceneId)!
      : sceneAt(p, timeUs);
  if (!active) throw new Error('找不到场景');
  const localUs = Math.max(0, timeUs - active.startUs),
    parts = [];
  const fade = Math.min(400000, active.scene.durationUs / 3),
    index = entries.indexOf(active);
  if (!options.still && index > 0 && active.scene.transition === 'crossfade' && localUs < fade) {
    const prev = entries[index - 1];
    parts.push({
      nodes: prev.scene.nodes,
      background: prev.scene.background,
      opacity: 1,
      localUs: prev.scene.durationUs,
      still: false,
    });
  }
  parts.push({
    nodes: active.scene.nodes,
    background: active.scene.background,
    opacity: parts.length ? localUs / fade : 1,
    localUs,
    still: options.still ?? false,
  });
  const caption =
    options.captions !== false && p.showCaptions
      ? (active.scene.captions.find((c) => localUs >= c.startUs && localUs < c.endUs)?.text ?? '')
      : '';
  return { width: p.width, height: p.height, parts, caption };
}
const images = new Map<string, Promise<HTMLImageElement>>();
const releaseImages = new Map<string, () => void>();
const fonts = new Map<string, Promise<void>>();
function textFamilies(family: string): string[] {
  const primary = normalizeFontFamily(family);
  return primary === DEFAULT_FONT_FAMILY ? [primary] : [primary, DEFAULT_FONT_FAMILY];
}
const textFontFamily = (family: string) => textFamilies(family).join(', ');
let resolveAssetUrl: (p: Project, id: string, jobId?: string) => string = () => {
  throw new Error('素材存储未初始化');
};
const jobUrls = new Map<string, Set<string>>();
export function configureAssetUrls(resolver: typeof resolveAssetUrl) {
  resolveAssetUrl = resolver;
}
export function assetUrl(p: Project, id: string, jobId?: string) {
  const url = resolveAssetUrl(p, id, jobId);
  if (jobId) {
    if (!jobUrls.has(jobId)) jobUrls.set(jobId, new Set());
    jobUrls.get(jobId)!.add(url);
  }
  return url;
}
async function imageFor(url: string) {
  if (!images.has(url))
    images.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        releaseImages.set(url, () => {
          image.onload = image.onerror = null;
          image.src = '';
          reject(new DOMException('图片加载已取消', 'AbortError'));
        });
        image.onload = () => resolve(image);
        image.onerror = () => {
          images.delete(url);
          releaseImages.delete(url);
          reject(new Error('图片载入失败'));
        };
        image.src = url;
      }),
    );
  return images.get(url)!;
}
export function releaseJobAssets(jobId: string) {
  for (const url of jobUrls.get(jobId) ?? []) {
    releaseImages.get(url)?.();
    releaseImages.delete(url);
    images.delete(url);
  }
  jobUrls.delete(jobId);
}
export async function loadAssets(p: Project, jobId?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!signal) return loadAllAssets(p, jobId);
  let abort: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([loadAllAssets(p, jobId), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort!);
  }
}
async function loadAllAssets(p: Project, jobId?: string) {
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.values(p.assets).map(async (a) => {
      const url = assetUrl(p, a.id, jobId);
      if (a.kind === 'image') loaded.set(a.id, await imageFor(url));
      if (a.kind === 'font' && a.fontFamily) {
        const family = a.fontFamily;
        if (!fonts.has(family))
          fonts.set(
            family,
            (async () => {
              const face = new FontFace(family, 'url("' + url + '")');
              await face.load();
              document.fonts.add(face);
            })(),
          );
        await fonts.get(family);
      }
    }),
  );
  const families = new Map<string, string>();
  for (const n of [...p.scenes, ...p.variants].flatMap((s) =>
    s.nodes.filter((n) => n.type === 'text'),
  )) {
    for (const family of textFamilies(n.fontFamily)) {
      const key = (n.bold ? '700' : '400') + ' ' + n.fontSize + 'px "' + family + '"';
      families.set(key, (families.get(key) ?? '') + n.text);
    }
  }
  // Captions also need the bundled CJK font when a scene contains no text layers.
  if (p.showCaptions) {
    const captions = p.scenes.flatMap((s) => s.captions.map((c) => c.text)).join('');
    if (captions) families.set('400 40px "' + DEFAULT_FONT_FAMILY + '"', captions);
  }
  await Promise.all([...families].map(([f, text]) => document.fonts.load(f, text)));
  await document.fonts.ready;
  return loaded;
}
export function measureText(p: Project): Issue[] {
  return [...p.scenes, ...p.variants].flatMap((s) =>
    s.nodes
      .filter((n) => n.type === 'text')
      .flatMap((n) => {
        const t = new Konva.Text({
            text: n.text,
            width: n.width,
            fontSize: n.fontSize,
            fontFamily: textFontFamily(n.fontFamily),
            fontStyle: n.bold ? 'bold' : 'normal',
            lineHeight: n.lineHeight,
            wrap: 'word',
          }),
          height = t.height();
        t.destroy();
        return height > n.height + 2
          ? [
              {
                code: 'TEXT_OVERFLOW',
                message: '文字超过图层高度约 ' + Math.ceil(height - n.height) + ' 像素',
                objectId: n.id,
                severity: 'warning' as const,
              },
            ]
          : [];
      }),
  );
}
export type EditHooks = {
  selectedIds: string[];
  onSelect: (id: string, add: boolean) => void;
  onChange: (changes: { id: string; changes: Partial<VisualNode> }[]) => void;
  onEdit?: (id: string) => void;
};
export class CanvasRenderer {
  stage: Konva.Stage;
  layer: Konva.Layer;
  overlay: Konva.Layer;
  private serial = 0;
  constructor(
    container: HTMLDivElement,
    width = 1920,
    height = 1080,
    private jobId?: string,
    private signal?: AbortSignal,
  ) {
    this.stage = new Konva.Stage({ container, width, height });
    this.layer = new Konva.Layer();
    this.overlay = new Konva.Layer();
    this.stage.add(this.layer, this.overlay);
  }
  async render(
    p: Project,
    timeUs: number,
    options: FrameOptions = {},
    hooks?: EditHooks,
    displayWidth?: number,
  ) {
    const seq = ++this.serial,
      frame = evaluateFrame(p, timeUs, options),
      assets = await loadAssets(p, this.jobId, this.signal);
    if (seq !== this.serial) return;
    const scale = (displayWidth ?? frame.width) / frame.width;
    this.stage.width(frame.width * scale);
    this.stage.height(frame.height * scale);
    this.stage.scale({ x: scale, y: scale });
    this.layer.destroyChildren();
    this.overlay.destroyChildren();
    this.stage.off('click tap');
    const transformed = new Map<string, { id: string; changes: Partial<VisualNode> }>();
    let transformQueued = false;
    const commitTransform = (change: { id: string; changes: Partial<VisualNode> }) => {
      transformed.set(change.id, change);
      if (transformQueued) return;
      transformQueued = true;
      queueMicrotask(() => {
        transformQueued = false;
        if (seq === this.serial) hooks?.onChange([...transformed.values()]);
        transformed.clear();
      });
    };
    if (hooks)
      this.stage.on('click tap', (e) => {
        if (e.target === this.stage || e.target.name() === 'background') hooks.onSelect('', false);
      });
    for (const part of frame.parts) {
      const group = new Konva.Group({
        opacity: part.opacity,
        clipX: 0,
        clipY: 0,
        clipWidth: frame.width,
        clipHeight: frame.height,
      });
      group.add(
        new Konva.Rect({
          name: 'background',
          width: frame.width,
          height: frame.height,
          fill: part.background,
        }),
      );
      this.layer.add(group);
      for (const n of part.nodes) {
        let alpha = 1,
          dy = 0,
          zoom = 1;
        if (!part.still && n.enter !== 'none' && n.enterDurationUs) {
          const x = Math.max(0, Math.min(1, part.localUs / n.enterDurationUs)),
            ease = 1 - (1 - x) ** 3;
          alpha = ease;
          if (n.enter === 'slide') dy = 40 * (1 - ease);
          if (n.enter === 'zoom') zoom = 0.94 + 0.06 * ease;
        }
        const attrs = {
          id: n.id,
          x: n.x,
          y: n.y + dy,
          width: n.width,
          height: n.height,
          fill: n.fill,
          stroke: n.stroke,
          strokeWidth: n.strokeWidth,
          rotation: n.rotation,
          opacity: n.opacity * alpha,
          scaleX: zoom,
          scaleY: zoom,
          draggable: !!hooks && !n.locked,
        };
        let shape: Konva.Shape;
        if (n.type === 'text')
          shape = new Konva.Text({
            ...attrs,
            text: n.text,
            fontSize: n.fontSize,
            fontFamily: textFontFamily(n.fontFamily),
            fontStyle: n.bold ? 'bold' : 'normal',
            align: n.align,
            lineHeight: n.lineHeight,
            wrap: 'word',
          });
        else if (n.type === 'image') {
          const image = assets.get(n.assetId!);
          if (!image) throw new Error('缺少图片：' + n.id);
          const ratio =
            n.fit === 'cover'
              ? Math.max(n.width / image.width, n.height / image.height)
              : Math.min(n.width / image.width, n.height / image.height);
          if (n.fit === 'cover') {
            const w = n.width / ratio,
              h = n.height / ratio;
            shape = new Konva.Image({
              ...attrs,
              image,
              crop: { x: (image.width - w) / 2, y: (image.height - h) / 2, width: w, height: h },
              cornerRadius: n.radius,
            });
          } else
            shape = new Konva.Shape({
              ...attrs,
              sceneFunc(context) {
                context.drawImage(
                  image,
                  (n.width - image.width * ratio) / 2,
                  (n.height - image.height * ratio) / 2,
                  image.width * ratio,
                  image.height * ratio,
                );
              },
              hitFunc(context, target) {
                context.beginPath();
                context.rect(0, 0, n.width, n.height);
                context.closePath();
                context.fillStrokeShape(target);
              },
            });
        } else if (n.type === 'ellipse')
          shape = new Konva.Ellipse({
            ...attrs,
            x: n.x + n.width / 2,
            y: n.y + n.height / 2,
            radiusX: n.width / 2,
            radiusY: n.height / 2,
          });
        else if (n.type === 'line')
          shape = new Konva.Line({
            ...attrs,
            points: [0, 0, n.width, n.height],
            stroke: n.stroke ?? n.fill,
            strokeWidth: Math.max(1, n.strokeWidth || n.height),
          });
        else shape = new Konva.Rect({ ...attrs, cornerRadius: n.radius });
        group.add(shape);
        if (hooks) {
          shape.on('click tap', (e) => {
            e.cancelBubble = true;
            hooks.onSelect(n.id, !!(e.evt as MouseEvent).shiftKey);
          });
          shape.on('dblclick dbltap', () => hooks.onEdit?.(n.id));
          shape.on('mouseenter', () => {
            this.stage.container().style.cursor = n.locked ? 'default' : 'move';
          });
          shape.on('mouseleave', () => {
            this.stage.container().style.cursor = 'default';
          });
          shape.on('dragend', () => {
            const x = shape.x() - (n.type === 'ellipse' ? n.width / 2 : 0),
              y = shape.y() - (n.type === 'ellipse' ? n.height / 2 : 0);
            const related = n.groupId
              ? part.nodes.filter((k) => k.groupId === n.groupId && !k.locked)
              : [n];
            hooks.onChange(
              related.map((k) => ({ id: k.id, changes: { x: k.x + x - n.x, y: k.y + y - n.y } })),
            );
          });
          shape.on('transformend', () => {
            const w = Math.max(8, shape.width() * Math.abs(shape.scaleX())),
              h = Math.max(8, shape.height() * Math.abs(shape.scaleY()));
            commitTransform({
              id: n.id,
              changes: {
                x: shape.x() - (n.type === 'ellipse' ? w / 2 : 0),
                y: shape.y() - (n.type === 'ellipse' ? h / 2 : 0),
                width: w,
                height: h,
                rotation: shape.rotation(),
                ...(n.type === 'text'
                  ? {
                      fontSize: Math.max(8, Math.min(500, n.fontSize * Math.abs(shape.scaleY()))),
                    }
                  : {}),
              },
            });
          });
        }
      }
    }
    if (frame.caption) {
      const width = Math.min(frame.width - 200, 1600),
        t = new Konva.Text({
          text: frame.caption,
          x: (frame.width - width) / 2,
          y: frame.height - 122,
          width,
          fontSize: 40,
          lineHeight: 1.3,
          fontFamily: DEFAULT_FONT_FAMILY,
          fill: '#ffffff',
          align: 'center',
          padding: 15,
        });
      this.layer.add(
        new Konva.Rect({
          x: t.x() - 15,
          y: t.y(),
          width: width + 30,
          height: t.height(),
          fill: '#102a2be8',
          cornerRadius: 12,
        }),
        t,
      );
    }
    if (hooks?.selectedIds.length) {
      const nodes = this.layer.find(
        (node: Konva.Node) =>
          hooks.selectedIds.includes(node.id()) && !partLocked(p, node.id(), options),
      );
      const transformer = new Konva.Transformer({
        nodes,
        rotateEnabled: true,
        ignoreStroke: true,
        borderStroke: '#236d59',
        anchorStroke: '#236d59',
        anchorFill: '#ffffff',
        // Transformer dimensions are already in screen pixels, independent of stage scale.
        anchorSize: 8,
        anchorCornerRadius: 2,
        borderStrokeWidth: 1.25,
        padding: 3,
        rotateAnchorOffset: 24,
        keepRatio: false,
        flipEnabled: false,
        boundBoxFunc: (oldBox, newBox) =>
          newBox.width < 10 || newBox.height < 10 ? oldBox : newBox,
      });
      this.overlay.add(transformer);
    }
    this.stage.draw();
  }
  png() {
    this.overlay.hide();
    this.stage.draw();
    const url = this.stage.toDataURL({ pixelRatio: 1 });
    this.overlay.show();
    return url;
  }
  async pngBytes() {
    this.overlay.hide();
    this.stage.draw();
    const canvas = this.stage.toCanvas({ pixelRatio: 1 });
    this.overlay.show();
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('画面生成失败'))),
          'image/png',
        );
      });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  destroy() {
    this.serial++;
    this.stage.destroy();
  }
}
function partLocked(p: Project, id: string, options: FrameOptions) {
  const nodes = options.variantId
    ? p.variants.find((v) => v.id === options.variantId)?.nodes
    : p.scenes.find((s) => s.id === options.sceneId)?.nodes;
  return nodes?.find((n) => n.id === id)?.locked ?? false;
}
