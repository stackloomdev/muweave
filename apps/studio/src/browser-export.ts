import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { type Project, type Job, browserReportSchema } from '@muweave/schema';
import { duration, audioClips, audioMixArgs } from '@muweave/core';
import { CanvasRenderer, assetUrl, loadAssets, releaseJobAssets } from '@muweave/renderer';

const FRAME_BATCH = 60;
const FRAME_BYTE_BUDGET = 24 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
type Progress = (progress: number, stage: string) => void;

export async function renderBrowserVideo(
  project: Project,
  job: Job,
  signal: AbortSignal,
  progress: Progress,
) {
  const started = performance.now();
  const ffmpeg = new FFmpeg();
  let log = '';
  ffmpeg.on('log', ({ message }) => {
    log = (log + '\n' + message).slice(-3500);
  });
  const terminate = () => ffmpeg.terminate();
  signal.addEventListener('abort', terminate, { once: true });
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.append(container);
  const renderer = new CanvasRenderer(container, project.width, project.height, job.id, signal);
  const frames = Math.ceil((duration(project) * project.fps) / 1e6);
  const totalSeconds = frames / project.fps;
  const segments: string[] = [];
  let maxBufferedFrames = 0;
  let maxBufferedPngBytes = 0;
  let execProgress: ((fraction: number) => void) | undefined;
  ffmpeg.on('progress', ({ progress: fraction }) => {
    if (Number.isFinite(fraction)) execProgress?.(Math.min(1, Math.max(0, fraction)));
  });
  async function exec(args: string[]) {
    signal.throwIfAborted();
    log = '';
    const code = await ffmpeg.exec(args, -1, { signal });
    signal.throwIfAborted();
    if (code !== 0) throw new Error('浏览器编码失败：' + log.slice(-900));
  }
  try {
    signal.throwIfAborted();
    progress(0.01, '准备浏览器编码器，首次加载约 31 MB');
    await ffmpeg.load({ coreURL, wasmURL }, { signal });
    const loadSeconds = (performance.now() - started) / 1000;
    progress(0.03, '准备字体与图片');
    await loadAssets(project, job.id, signal);
    let frame = 0;
    while (frame < frames) {
      const startFrame = frame;
      let bytesInBatch = 0;
      const names: string[] = [];
      while (frame < frames && names.length < FRAME_BATCH && bytesInBatch < FRAME_BYTE_BUDGET) {
        signal.throwIfAborted();
        await renderer.render(project, Math.round((frame * 1e6) / project.fps));
        const png = await renderer.pngBytes();
        bytesInBatch += png.byteLength;
        const name = `frame-${String(names.length).padStart(3, '0')}.png`;
        await ffmpeg.writeFile(name, png, { signal });
        names.push(name);
        frame++;
        progress(
          0.04 + (0.76 * (startFrame + names.length / 2)) / frames,
          `绘制画面 ${frame} / ${frames}`,
        );
        // Yield between deterministic frames so editing and cancellation remain responsive.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      maxBufferedFrames = Math.max(maxBufferedFrames, names.length);
      maxBufferedPngBytes = Math.max(maxBufferedPngBytes, bytesInBatch);
      const segment = `part-${String(segments.length).padStart(5, '0')}.mp4`;
      const label = `编码画面 ${startFrame + 1}–${frame} / ${frames}`;
      execProgress = (value) =>
        progress(0.04 + (0.76 * (startFrame + names.length * (0.5 + value / 2))) / frames, label);
      progress(0.04 + (0.76 * (startFrame + names.length / 2)) / frames, label);
      await exec([
        '-v',
        'error',
        '-framerate',
        String(project.fps),
        '-i',
        'frame-%03d.png',
        '-frames:v',
        String(names.length),
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        segment,
      ]);
      execProgress = undefined;
      for (const name of names) await ffmpeg.deleteFile(name, { signal });
      segments.push(segment);
      progress(0.04 + (0.76 * frame) / frames, `已编码 ${frame} / ${frames} 帧`);
    }
    progress(0.81, '连接画面片段');
    await ffmpeg.writeFile('segments.txt', segments.map((name) => `file '${name}'`).join('\n'), {
      signal,
    });
    await exec([
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'segments.txt',
      '-c',
      'copy',
      'video.mp4',
    ]);
    for (const name of segments) await ffmpeg.deleteFile(name, { signal });

    progress(0.83, '准备配音与背景音乐');
    const audioPaths = new Map<string, string>();
    for (const clip of audioClips(project)) {
      if (audioPaths.has(clip.assetId)) continue;
      signal.throwIfAborted();
      const response = await fetch(assetUrl(project, clip.assetId, job.id), { signal });
      if (!response.ok) throw new Error('配音素材读取失败');
      const path = `audio-${audioPaths.size}.input`;
      await ffmpeg.writeFile(path, new Uint8Array(await response.arrayBuffer()), { signal });
      audioPaths.set(clip.assetId, path);
    }
    progress(0.85, '合成配音，校准音画时间');
    execProgress = (value) => progress(0.85 + 0.06 * value, '合成配音，校准音画时间');
    await exec(
      audioMixArgs(project, 'video.mp4', (id) => audioPaths.get(id)!, totalSeconds, 'output.mp4'),
    );
    execProgress = undefined;
    await ffmpeg.deleteFile('video.mp4', { signal });
    for (const name of audioPaths.values()) await ffmpeg.deleteFile(name, { signal });

    progress(0.92, '检查整段视频可播放');
    await exec(['-v', 'error', '-xerror', '-i', 'output.mp4', '-f', 'null', '-']);
    progress(0.95, '检查成片尺寸与音画时长');
    log = '';
    const code = await ffmpeg.ffprobe(
      [
        '-v',
        'error',
        '-show_error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        'output.mp4',
        '-o',
        'probe.json',
      ],
      -1,
      { signal },
    );
    signal.throwIfAborted();
    // Core 0.12.10 can return -1 during ffprobe cleanup after writing complete JSON.
    // Require valid metadata below and the independent successful full decode above.
    if (code !== 0 && code !== -1) throw new Error('浏览器无法读取成片信息：' + log.slice(-900));
    const info = JSON.parse((await ffmpeg.readFile('probe.json', 'utf8', { signal })) as string);
    const video = info.streams?.find((stream: any) => stream.codec_type === 'video');
    const audio = info.streams?.find((stream: any) => stream.codec_type === 'audio');
    const measuredDuration = Number(info.format?.duration);
    if (
      info.error ||
      video?.width !== project.width ||
      video?.height !== project.height ||
      video.codec_name !== 'h264' ||
      Number(video.nb_frames) !== frames ||
      video.r_frame_rate !== `${project.fps}/1` ||
      audio?.codec_name !== 'aac' ||
      !Number.isFinite(measuredDuration) ||
      Math.abs(measuredDuration - totalSeconds) > 1 / project.fps + 0.01
    )
      throw new Error('成片尺寸、音轨或时长检查失败');
    const output = await ffmpeg.readFile('output.mp4', 'binary', { signal });
    if (typeof output === 'string' || output.byteLength > MAX_OUTPUT_BYTES)
      throw new Error('浏览器成片超过 100 MB，请缩短视频后重试');
    const blob = new Blob([output as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
    const report = browserReportSchema.parse({
      engine: 'ffmpeg.wasm',
      coreVersion: '0.12.10',
      threads: 1,
      revision: project.revision,
      frames,
      fps: project.fps,
      width: project.width,
      height: project.height,
      durationSeconds: totalSeconds,
      renderSeconds: (performance.now() - started) / 1000,
      loadSeconds,
      outputBytes: blob.size,
      chunks: segments.length,
      maxBufferedFrames,
      maxBufferedPngBytes,
      codec: 'h264',
      audioCodec: 'aac',
      fullDecode: 'passed',
    });
    return { blob, report };
  } finally {
    signal.removeEventListener('abort', terminate);
    ffmpeg.terminate();
    renderer.destroy();
    releaseJobAssets(job.id);
    container.remove();
  }
}
