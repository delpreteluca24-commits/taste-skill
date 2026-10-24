import type { Crop, FaceBox, RawAnalysis } from '../timeline';
import { clamp, round } from '../util';

export const OUT_ASPECT = 9 / 16;

/**
 * Reframing Agent: focus point (normalized) for one source span.
 * Picks the dominant face (size × score, with a centre prior so a bystander at the edge doesn't win),
 * median over the span → stable framing inside a shot (no wobbly auto-pan).
 */
export function focusForSpan(raw: RawAnalysis, srcStart: number, srcEnd: number): Crop {
  const samples = raw.faces.filter((f) => f.t >= srcStart - 0.25 && f.t <= srcEnd + 0.25 && f.boxes.length);
  if (!samples.length) return { x: 0.5, y: 0.42, mode: 'center' };
  const pick = (boxes: FaceBox[]) =>
    boxes.reduce((best, b) => {
      const cx = b.x + b.w / 2;
      const w = b.w * b.h * b.score * (1 - Math.abs(cx - 0.5) * 0.6);
      return w > best.w ? { b, w } : best;
    }, { b: boxes[0], w: -1 }).b;
  const xs = samples.map((s) => { const b = pick(s.boxes); return b.x + b.w / 2; }).sort((a, b) => a - b);
  const ys = samples.map((s) => { const b = pick(s.boxes); return b.y + b.h / 2; }).sort((a, b) => a - b);
  const med = (a: number[]) => a[Math.floor(a.length / 2)];
  // Coverage: if faces are seen in under a third of the span, treat it as a non-face shot.
  const expected = Math.max(1, (srcEnd - srcStart) * 2);
  if (samples.length / expected < 0.3) return { x: 0.5, y: 0.42, mode: 'center' };
  return { x: round(clamp(med(xs), 0, 1), 3), y: round(clamp(med(ys), 0, 1), 3), mode: 'face' };
}

/**
 * Source window (normalized, relative to the source frame) shown in the 9:16 output at `scale`.
 * Faces sit at ~38 % from the top of the window (headroom); windows never leave the frame.
 */
export function cropWindow(srcW: number, srcH: number, focus: Crop, scale: number) {
  const srcAspect = srcW / srcH;
  // Cover-fit window size before zoom (normalized to source dims).
  let w = 1;
  let h = 1;
  if (srcAspect > OUT_ASPECT) w = OUT_ASPECT / srcAspect;
  else h = srcAspect / OUT_ASPECT;
  w /= scale;
  h /= scale;
  const targetY = focus.mode === 'face' ? 0.38 : 0.5;
  const x = clamp(focus.x - w / 2, 0, 1 - w);
  const y = clamp(focus.y - h * targetY, 0, 1 - h);
  return { x, y, w, h };
}

/** Is the face fully inside the window? (QC: face cropping) */
export function faceInside(win: { x: number; y: number; w: number; h: number }, face: { x: number; y: number }, margin = 0.02) {
  return face.x >= win.x + margin && face.x <= win.x + win.w - margin && face.y >= win.y + margin && face.y <= win.y + win.h - margin;
}

/** Keep the framing still across a jump cut unless the subject really moved (> 6 % of the frame). */
export function stabilize(prev: Crop | null, next: Crop): Crop {
  if (!prev || prev.mode !== next.mode) return next;
  if (Math.abs(prev.x - next.x) < 0.06 && Math.abs(prev.y - next.y) < 0.06) return prev;
  return next;
}
