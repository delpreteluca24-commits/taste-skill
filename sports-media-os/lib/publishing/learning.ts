/** Learning-loop math (pure). Ranks with ties averaged; null when undefined. */

function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation between predicted scores and real outcomes. Needs ≥ 3 pairs. */
export function spearman(pairs: readonly { predicted: number; actual: number }[]): number | null {
  if (pairs.length < 3) return null;
  const a = ranks(pairs.map((p) => p.predicted));
  const b = ranks(pairs.map((p) => p.actual));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return Math.round((num / Math.sqrt(da * db)) * 100) / 100;
}

/** Plain-language read of the correlation for the Analytics page. */
export function calibrationVerdict(rho: number | null, n: number): string {
  if (rho === null) return n < 3 ? `Log metrics for at least 3 published pieces to measure the score (now ${n}).` : "Not enough variation yet to measure.";
  if (n < 20) return `Early read on ${n} pieces (ρ ${rho}). Trust it after ~20.`;
  if (rho >= 0.3) return `The opportunity score predicts performance (ρ ${rho}). Keep the weights.`;
  if (rho > 0) return `Weak signal (ρ ${rho}). Review which sub-scores carry the wins.`;
  return `The score does not predict performance (ρ ${rho}). Revise the weights.`;
}
