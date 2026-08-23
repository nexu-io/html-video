/**
 * ffmpeg concat arg builders for multi-frame export.
 *
 * Mixed-engine exports MUST use the concat filter (rebuild PTS). Same-engine
 * exports may use the concat demuxer + stream copy. Getting this wrong once
 * turned an 8s cut into ~35s — keep the choice table-tested.
 */

export interface ConcatFfmpegPlan {
  /** Full argv after `ffmpeg` (no binary name). */
  args: string[];
  /** When true, caller must write `listContents` to `listPath` before spawn. */
  needsListFile: boolean;
  listPath?: string;
  listContents?: string;
}

export function buildConcatFfmpegPlan(
  frameMp4s: string[],
  outputPath: string,
  listPath: string,
  opts: { reencode?: boolean; fps?: number } = {},
): ConcatFfmpegPlan {
  if (frameMp4s.length === 0) {
    throw new Error('No frames to concat');
  }
  const fps = opts.fps ?? 60;

  if (opts.reencode) {
    const n = frameMp4s.length;
    const inputs = frameMp4s.flatMap((p) => ['-i', p]);
    const filter = `${frameMp4s.map((_, i) => `[${i}:v]`).join('')}concat=n=${n}:v=1:a=0[v]`;
    return {
      needsListFile: false,
      args: [
        '-y',
        ...inputs,
        '-filter_complex',
        filter,
        '-map',
        '[v]',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(fps),
        '-movflags',
        '+faststart',
        outputPath,
      ],
    };
  }

  const listContents = frameMp4s.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  return {
    needsListFile: true,
    listPath,
    listContents,
    args: ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
  };
}

/** True when frames span more than one engine id (hyperframes + remotion, …). */
export function needsConcatReencode(engineIds: Iterable<string>): boolean {
  return new Set(engineIds).size > 1;
}
