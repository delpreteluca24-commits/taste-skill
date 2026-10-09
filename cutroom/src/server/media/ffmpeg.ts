import { spawn } from 'node:child_process';

export interface RunResult { stdout: Buffer; stderr: string; code: number }

/** Run a binary, collect output. `onStderr` gets live lines (progress parsing). */
export function run(bin: string, args: string[], opts: { onStderr?: (line: string) => void; input?: Buffer } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    let partial = '';
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      err += s;
      if (err.length > 2_000_000) err = err.slice(-1_000_000);
      if (opts.onStderr) {
        partial += s;
        const lines = partial.split(/\r|\n/);
        partial = lines.pop() ?? '';
        lines.forEach(opts.onStderr);
      }
    });
    p.on('error', reject);
    p.on('close', (code) => resolve({ stdout: Buffer.concat(out), stderr: err, code: code ?? 1 }));
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

export async function ffmpeg(args: string[], onProgress?: (seconds: number) => void): Promise<RunResult> {
  const r = await run('ffmpeg', ['-hide_banner', '-y', ...args], {
    onStderr: onProgress
      ? (line) => {
          const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
          if (m) onProgress(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
        }
      : undefined,
  });
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}): ${r.stderr.split('\n').slice(-6).join('\n')}`);
  return r;
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  rotation: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.slice(-400)}`);
  const j = JSON.parse(r.stdout.toString());
  const v = (j.streams ?? []).find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = (j.streams ?? []).find((s: any) => s.codec_type === 'audio');
  let rotation = 0;
  if (v) {
    const sd = (v.side_data_list ?? []).find((x: any) => x.rotation !== undefined);
    rotation = sd ? Number(sd.rotation) : Number(v.tags?.rotate ?? 0);
  }
  const [n, d] = String(v?.avg_frame_rate ?? v?.r_frame_rate ?? '30/1').split('/').map(Number);
  const fps = d ? n / d : n || 30;
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    duration: parseFloat(j.format?.duration ?? v?.duration ?? a?.duration ?? '0'),
    width: v ? (rotated ? v.height : v.width) : 0,
    height: v ? (rotated ? v.width : v.height) : 0,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    rotation,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}
