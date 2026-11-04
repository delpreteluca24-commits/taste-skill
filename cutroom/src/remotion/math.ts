import type { TransitionItem, ZoomItem } from '../core/timeline';

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** Camera scale at output time t: the strongest active move wins (moves never fight each other). */
export function zoomAt(zooms: ZoomItem[], t: number): number {
  let s = 1;
  for (const z of zooms) {
    if (t < z.start || t >= z.end) continue;
    const { from, to, ease, kind } = z.properties;
    let v: number;
    if (kind === 'jumpcut') v = to;
    else if (kind === 'pushin') v = from + (to - from) * easeInOut(Math.min(1, (t - z.start) / Math.max(0.01, z.end - z.start)));
    else {
      const p = ease <= 0 ? 1 : easeOutCubic(Math.min(1, (t - z.start) / ease));
      const out = Math.min(1, Math.max(0, (z.end - t) / 0.18));
      v = from + (to - from) * p * (0.35 + 0.65 * out);
    }
    if (v > s) s = v;
  }
  return s;
}

/** Focus point of the strongest active camera move that has one (e.g. zoom onto the ingredient plate). */
export function zoomFocusAt(zooms: ZoomItem[], t: number): { x: number; y: number; to: number } | null {
  let best: { v: number; x: number; y: number } | null = null;
  for (const z of zooms) {
    if (t < z.start || t >= z.end || z.properties.x === undefined || z.properties.y === undefined) continue;
    if (!best || z.properties.to > best.v) best = { v: z.properties.to, x: z.properties.x, y: z.properties.y };
  }
  return best ? { x: best.x, y: best.y, to: best.v } : null;
}

/** Transition overlay state at time t (applied around the cut point). */
export function transitionAt(trs: TransitionItem[], t: number) {
  for (const tr of trs) {
    if (t < tr.start || t >= tr.end) continue;
    const at = tr.properties.at;
    const half = Math.max(0.01, Math.max(at - tr.start, tr.end - at));
    const k = 1 - Math.min(1, Math.abs(t - at) / half); // 0 → 1 at the cut → 0
    const dir = t < at ? -1 : 1;
    return { kind: tr.properties.kind, k, dir };
  }
  return null;
}

export const GRADE_FILTER: Record<string, string> = {
  none: 'none',
  clean: 'contrast(1.04) saturate(1.06)',
  punchy: 'contrast(1.12) saturate(1.2) brightness(1.02)',
  cinematic: 'contrast(1.08) saturate(0.88) sepia(0.06)',
};
