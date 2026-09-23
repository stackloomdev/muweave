import type { Asset, Project } from '@muweave/schema';
import { DomainError, timeline, uid } from '@muweave/core';
import { sha256, store } from './storage';

const MAX_BYTES = 100 * 1024 * 1024;
export const ACCEPT_ASSETS =
  '.png,.jpg,.jpeg,.webp,.svg,.mp3,.wav,.m4a,.aac,.flac,.ogg,.ttf,.otf,.woff,.woff2';
export async function decodeAudio(blob: Blob) {
  // OfflineAudioContext decodes without requiring speaker access or a user gesture.
  const context = new OfflineAudioContext(2, 1, 48000);
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new DomainError('INVALID_ASSET', '浏览器无法解码该音频，请使用 WAV、MP3 或 FLAC 文件');
  }
}
export function encodeWav(audio: AudioBuffer): Blob {
  const channels = Math.min(2, audio.numberOfChannels),
    length = audio.length;
  if (44 + length * channels * 2 > MAX_BYTES)
    throw new DomainError('INVALID_ASSET', '解码后的音频超过 100 MB，请先截取需要的部分');
  const buffer = new ArrayBuffer(44 + length * channels * 2),
    view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, buffer.byteLength - 44, true);
  const pcm = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  for (let i = 0; i < length; i++)
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, pcm[c][i]));
      view.setInt16(
        44 + (i * channels + c) * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
    }
  return new Blob([buffer], { type: 'audio/wav' });
}
function audioMetadata(audio: AudioBuffer) {
  const durationUs = Math.round((audio.length * 1e6) / audio.sampleRate);
  if (durationUs < 100000 || durationUs > 3600e6)
    throw new DomainError('INVALID_ASSET', '音频时长需在 0.1 秒至 1 小时之间');
  const peaks = Array.from({ length: 160 }, (_, i) => {
    let peak = 0;
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const pcm = audio.getChannelData(c);
      for (
        let j = Math.floor((i * audio.length) / 160);
        j < Math.floor(((i + 1) * audio.length) / 160);
        j++
      )
        peak = Math.max(peak, Math.abs(pcm[j]));
    }
    return Math.min(1, peak);
  });
  return { durationUs, peaks };
}
async function rasterize(file: Blob, ext: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    ext === 'svg' &&
    /<script|<foreignObject|<!ENTITY|(?:href|url)\s*[=(]\s*["']?(?:https?:|file:|javascript:)/i.test(
      new TextDecoder().decode(bytes),
    )
  )
    throw new DomainError('INVALID_ASSET', 'SVG 包含外部资源或脚本');
  if (
    ext === 'gif' ||
    (ext === 'png' && new TextDecoder('latin1').decode(bytes).includes('acTL')) ||
    (ext === 'webp' && new TextDecoder('latin1').decode(bytes).includes('ANIM'))
  )
    throw new DomainError('INVALID_ASSET', '请先将动画图片导出为静态 PNG');
  const url = URL.createObjectURL(file),
    image = new Image();
  const canvas = document.createElement('canvas');
  try {
    image.src = url;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 40_000_000)
      throw new DomainError('INVALID_ASSET', '图片尺寸超出限制');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片解码失败'))), 'image/png'),
    );
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
    image.src = '';
    canvas.width = canvas.height = 0;
  }
}
export async function prepareAsset(
  name: string,
  input: Blob,
  preserveBytes = false,
): Promise<{ asset: Asset; blob: Blob }> {
  if (!input.size || input.size > MAX_BYTES)
    throw new DomainError('INVALID_ASSET', '素材大小必须在 0–100 MB 之间');
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  let blob = input,
    kind: Asset['kind'],
    outExt = ext,
    meta: Partial<Asset> = {};
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext)) {
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    const image = await rasterize(new Blob([input], { type: mime }), ext);
    blob = preserveBytes ? new Blob([input], { type: mime }) : image.blob;
    kind = 'image';
    outExt = preserveBytes ? ext : 'png';
    meta = { width: image.width, height: image.height };
  } else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
    const bytes = await input.arrayBuffer(),
      magic = [...new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    if (!['00010000', '4f54544f', '774f4646', '774f4632', '74727565'].includes(magic))
      throw new DomainError('INVALID_ASSET', '字体文件无效');
    await new FontFace('MuweaveImportCheck', bytes).load();
    kind = 'font';
    blob = new Blob([input], { type: 'font/' + ext });
  } else if (['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) {
    const audio = await decodeAudio(input);
    meta = audioMetadata(audio);
    blob = preserveBytes
      ? new Blob([input], { type: ext === 'm4a' ? 'audio/mp4' : 'audio/' + ext })
      : encodeWav(audio);
    kind = 'audio';
    outExt = preserveBytes ? ext : 'wav';
  } else throw new DomainError('INVALID_ASSET', '支持静态图片、音频与字体文件');
  if (blob.size > MAX_BYTES) throw new DomainError('INVALID_ASSET', '处理后的素材超过 100 MB');
  const hash = await sha256(await blob.arrayBuffer());
  if (kind === 'font') meta.fontFamily = 'MuweaveFont_' + hash.slice(0, 12);
  return {
    blob,
    asset: {
      id: uid('asset'),
      name: name.slice(0, 240),
      kind,
      mime: blob.type,
      file: hash + '.' + outExt,
      sha256: hash,
      bytes: blob.size,
      ...meta,
    },
  };
}

export async function analyzeTimeline(p: Project) {
  const gaps = timeline(p)
    .slice(0, -1)
    .filter((t) => t.scene.gapUs > 300000)
    .map((t) => ({ sceneId: t.scene.id, gapUs: t.scene.gapUs }));
  const trims = [];
  const decoded = new Map<string, AudioBuffer>();
  for (const scene of p.scenes) {
    if (!scene.narration) continue;
    const n = scene.narration,
      a = p.assets[n.assetId];
    if (!decoded.has(a.sha256))
      decoded.set(a.sha256, await decodeAudio(await store.asset(a.sha256)));
    const audio = decoded.get(a.sha256)!,
      rate = audio.sampleRate;
    const from = Math.round((n.trimStartUs * rate) / 1e6),
      to = Math.min(audio.length, Math.round((n.trimEndUs * rate) / 1e6));
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) =>
      audio.getChannelData(c),
    );
    const silent = (i: number) => channels.every((pcm) => Math.abs(pcm[i]) < 0.01);
    let left = from,
      right = to;
    while (left < to && silent(left)) left++;
    while (right > from && silent(right - 1)) right--;
    const leading = Math.round(((left - from) * 1e6) / rate),
      trailing = Math.round(((to - right) * 1e6) / rate);
    const leadingUs = leading >= 150000 ? leading : 0,
      trailingUs = trailing >= 150000 ? trailing : 0;
    const trimStartUs = n.trimStartUs + Math.max(0, leadingUs - 80000),
      trimEndUs = n.trimEndUs - Math.max(0, trailingUs - 120000);
    trims.push({
      sceneId: scene.id,
      leadingUs,
      trailingUs,
      suggestion: trimEndUs - trimStartUs >= 100000 ? { ...n, trimStartUs, trimEndUs } : null,
    });
  }
  return {
    gaps,
    trims,
    thresholdDb: -40,
    minimumSilenceUs: 150000,
    message: '只建议裁剪片段首尾，句中停顿保留；应用前可试听。',
  };
}
