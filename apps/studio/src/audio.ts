import type { Project } from '@muweave/schema';
import { audioClips, duration } from '@muweave/core';
import { assetUrl } from '@muweave/renderer';
export class AudioTransport {
  private context?: AudioContext;
  private sources: AudioBufferSourceNode[] = [];
  private cache = new Map<string, AudioBuffer>();
  private epoch = 0;
  private offset = 0;
  private generation = 0;
  async play(p: Project, fromUs: number) {
    this.stop();
    const generation = this.generation;
    this.context ??= new AudioContext();
    await this.context.resume();
    const clips = audioClips(p);
    await Promise.all(
      clips.map(async (c) => {
        const key = p.id + ':' + p.assets[c.assetId].sha256;
        if (!this.cache.has(key)) {
          const r = await fetch(assetUrl(p, c.assetId));
          if (!r.ok) throw new Error('无法加载音频');
          this.cache.set(key, await this.context!.decodeAudioData(await r.arrayBuffer()));
        }
      }),
    );
    if (generation !== this.generation) return false;
    this.offset = fromUs;
    this.epoch = this.context.currentTime + 0.05;
    for (const c of clips) {
      const length = c.trimEndUs - c.trimStartUs,
        end = c.startUs + length;
      if (end <= fromUs) continue;
      const skip = Math.max(0, fromUs - c.startUs),
        buffer = this.cache.get(p.id + ':' + p.assets[c.assetId].sha256)!;
      const source = this.context.createBufferSource(),
        gain = this.context.createGain();
      source.buffer = buffer;
      gain.gain.value = c.gain;
      source.connect(gain).connect(this.context.destination);
      source.start(
        this.epoch + Math.max(0, c.startUs - fromUs) / 1e6,
        (c.trimStartUs + skip) / 1e6,
        Math.min((length - skip) / 1e6, buffer.duration - (c.trimStartUs + skip) / 1e6),
      );
      this.sources.push(source);
    }
    return true;
  }
  timeUs() {
    return Math.max(
      this.offset,
      this.offset + Math.round(((this.context?.currentTime ?? 0) - this.epoch) * 1e6),
    );
  }
  stop() {
    this.generation++;
    for (const s of this.sources)
      try {
        s.stop();
        s.disconnect();
      } catch {}
    this.sources = [];
  }
  close() {
    this.stop();
    void this.context?.close();
  }
}
