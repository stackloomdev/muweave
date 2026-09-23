import type { Project } from '@muweave/schema';
import { audioClips } from './index';

// Native and browser exports use the same sample-based offsets and gain rules.
export function audioMixArgs(
  project: Project,
  video: string,
  assetPath: (id: string) => string,
  durationSeconds: number,
  output: string,
) {
  const args = [
    '-y',
    '-v',
    'error',
    '-nostdin',
    '-i',
    video,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
  ];
  const filters: string[] = [];
  const labels = ['[1:a]'];
  audioClips(project).forEach((clip, index) => {
    args.push('-i', assetPath(clip.assetId));
    const label = 'a' + index;
    filters.push(
      `[${index + 2}:a]atrim=start=${clip.trimStartUs / 1e6}:end=${clip.trimEndUs / 1e6},` +
        `asetpts=PTS-STARTPTS,volume=${clip.gain},adelay=${Math.round((clip.startUs * 48000) / 1e6)}S:all=1[${label}]`,
    );
    labels.push(`[${label}]`);
  });
  filters.push(
    `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,` +
      `atrim=duration=${durationSeconds}[mix]`,
  );
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[mix]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-b:a',
    '192k',
    '-t',
    String(durationSeconds),
    '-movflags',
    '+faststart',
    output,
  );
  return args;
}
