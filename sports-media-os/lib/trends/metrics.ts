import type { Enums } from "@/lib/db/client";
import { detectVelocitySignal, sortSignals, SIGNAL_LABELS, type RadarSignal, type SignalMatch } from "@/lib/radar/signals";

/**
 * Radar metrics for one trend — every number is explained (no black box).
 *
 *   INTEREST (stored as trend_score, 0–100) = sum of five factors:
 *     volume       30  sources covering it, saturates at 10
 *     publishers   25  distinct publishers, saturates at 6
 *     momentum     20  (sources last 6h − previous 6h), saturates at +5
 *     recency      15  full when the newest source is ≤ 2h old, 0 at 48h (linear)
 *     credibility  10  average publisher credibility × 10 (unknown → neutral 5)
 *
 *   CURIOSITY (0–100) = 20 base + points per signal (CURIOSITY_POINTS),
 *     each scaled by how many sources carry it: points × (0.5 + 0.5 × share),
 *     capped at 100.
 *
 *   COMPETITION (editorial saturation among the outlets you track):
 *     high    ≥ 6 publishers, or ≥ 3 publishers that are ≥ 60% of the active ones
 *     medium  ≥ 3 publishers, or ≥ 2 publishers that are ≥ 40% of the active ones
 *     low     otherwise
 *
 *   RADAR SCORE = 0.4 × interest + 0.4 × curiosity + 0.2 × competition gap
 *     (gap: low 100, medium 60, high 20)
 *
 *   SWEET SPOT = interest ≥ 60 AND curiosity ≥ 60 AND competition ≠ high (and not expired)
 *
 *   STATUS (first rule that matches):
 *     expired    no new source for 72h
 *     declining  no new source for 12h, or coverage halved: last-6h sources < half
 *                of the previous 6h when the previous 6h had ≥ 2 (one quiet hour of a
 *                one-source story is not a decline)
 *     emerging   fewer than 3 sources
 *     rising     more sources in the last 6h than in the previous 6h
 *     peaking    otherwise (steady coverage)
 */

export const METRICS_VERSION = "radar-metrics-v1";

export type CompetitionLevel = Enums<"competition_level">;
export type TrendStatus = Enums<"trend_status">;

export const INTEREST_FACTORS = {
  volume: { max: 30, saturation: 10 },
  publishers: { max: 25, saturation: 6 },
  momentum: { max: 20, saturation: 5 },
  recency: { max: 15, fullHours: 2, zeroHours: 48 },
  credibility: { max: 10, unknownPoints: 5 },
} as const;

export const CURIOSITY_BASE = 20;
export const CURIOSITY_POINTS: Record<RadarSignal, number> = {
  upset: 25,
  record: 25,
  unusual_stat: 20,
  controversy: 20,
  rivalry: 15,
  breaking: 15,
  rising_trend: 10,
  statement: 10,
  transfer: 10,
  injury: 8,
  just_finished: 8,
  upcoming_event: 5,
};

export const COMPETITION_RULES = {
  high: { publishers: 6, saturatedMin: 3, saturation: 0.6 },
  medium: { publishers: 3, saturatedMin: 2, saturation: 0.4 },
} as const;

export const COMPETITION_GAP: Record<CompetitionLevel, number> = { low: 100, medium: 60, high: 20 };
export const RADAR_WEIGHTS = { interest: 0.4, curiosity: 0.4, competition_gap: 0.2 } as const;
export const SWEET_SPOT = { interest: 60, curiosity: 60 } as const;

export const STATUS_RULES = {
  expiredHours: 72,
  decliningHours: 12,
  /** the "coverage halved" rule needs at least this many sources in the previous 6h */
  halvedMinPrevious: 2,
  emergingBelowSources: 3,
  windowHours: 6,
} as const;

const HOUR = 3_600_000;

export type MetricSource = {
  id: string;
  /** epoch ms of publication (else retrieval) */
  time: number;
  /** distinct publisher identity (host name) */
  publisher: string;
  credibility: number | null;
  /** text signals of this source with matched terms */
  signals: SignalMatch[];
};

export type MetricsInput = {
  sources: readonly MetricSource[];
  now: Date;
  /** distinct publishers with any source in the analysis window (saturation base) */
  activePublishers: number;
  /** signals from the linked event (upcoming_event / just_finished) */
  eventSignals?: readonly SignalMatch[];
};

export type ExplainedFactor = {
  key: keyof typeof INTEREST_FACTORS;
  label: string;
  value: number | null;
  points: number;
  max: number;
  detail: string;
};

export type CuriosityFactor = {
  signal: RadarSignal;
  label: string;
  sources: number;
  share: number;
  points: number;
  max: number;
  terms: string[];
};

export type RadarExplanation = {
  version: string;
  computed_at: string;
  interest: { score: number; max: 100; factors: ExplainedFactor[] };
  curiosity: { score: number; base: number; raw: number; capped: boolean; factors: CuriosityFactor[] };
  competition: {
    level: CompetitionLevel;
    publisher_count: number;
    active_publishers: number;
    saturation: number;
    gap: number;
    rule: string;
  };
  radar: {
    score: number;
    weights: typeof RADAR_WEIGHTS;
    contributions: { interest: number; curiosity: number; competition_gap: number };
  };
  sweet_spot: { value: boolean; checks: { key: string; label: string; pass: boolean }[] };
  status: { value: TrendStatus; rule: string };
  velocity: { value: number; last_6h: number; previous_6h: number; unit: string };
};

export type TrendMetrics = {
  volume: number;
  publisherCount: number;
  last6h: number;
  previous6h: number;
  /** change in sources per hour between the last 6h and the previous 6h */
  velocity: number;
  hoursSinceLast: number | null;
  avgCredibility: number | null;
  interest: number;
  curiosity: number;
  competition: CompetitionLevel;
  radarScore: number;
  isSweetSpot: boolean;
  status: TrendStatus;
  signals: RadarSignal[];
  firstSeen: number | null;
  lastSeen: number | null;
  explanation: RadarExplanation;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function competitionLevel(publisherCount: number, activePublishers: number): { level: CompetitionLevel; saturation: number; rule: string } {
  const base = Math.max(activePublishers, publisherCount, 1);
  const saturation = round2(publisherCount / base);
  const pct = Math.round(saturation * 100);
  const H = COMPETITION_RULES.high;
  const M = COMPETITION_RULES.medium;
  if (publisherCount >= H.publishers) {
    return { level: "high", saturation, rule: `${publisherCount} publishers cover it (≥ ${H.publishers} = high)` };
  }
  if (publisherCount >= H.saturatedMin && saturation >= H.saturation) {
    return { level: "high", saturation, rule: `${pct}% of the ${base} publishers you track cover it (≥ ${H.saturation * 100}% with ≥ ${H.saturatedMin} = high)` };
  }
  if (publisherCount >= M.publishers) {
    return { level: "medium", saturation, rule: `${publisherCount} publishers cover it (${M.publishers}–${H.publishers - 1} = medium)` };
  }
  if (publisherCount >= M.saturatedMin && saturation >= M.saturation) {
    return { level: "medium", saturation, rule: `${pct}% of the ${base} publishers you track cover it (≥ ${M.saturation * 100}% with ≥ ${M.saturatedMin} = medium)` };
  }
  return { level: "low", saturation, rule: `only ${plural(publisherCount, "publisher")} (${pct}% of the ${base} you track) cover it` };
}

export function trendStatus(args: { volume: number; last6h: number; previous6h: number; hoursSinceLast: number | null }): { status: TrendStatus; rule: string } {
  const { volume, last6h, previous6h, hoursSinceLast } = args;
  const S = STATUS_RULES;
  if (hoursSinceLast === null || hoursSinceLast >= S.expiredHours) {
    return { status: "expired", rule: `no new source for ${S.expiredHours}h` };
  }
  if (hoursSinceLast >= S.decliningHours) {
    return { status: "declining", rule: `no new source for ${Math.floor(hoursSinceLast)}h (≥ ${S.decliningHours}h)` };
  }
  if (previous6h >= S.halvedMinPrevious && last6h < previous6h / 2) {
    return { status: "declining", rule: `coverage halved: ${last6h} sources in the last 6h vs ${previous6h} before` };
  }
  if (volume < S.emergingBelowSources) {
    return { status: "emerging", rule: `${plural(volume, "source")} so far (< ${S.emergingBelowSources})` };
  }
  if (last6h > previous6h) {
    return { status: "rising", rule: `${last6h} sources in the last 6h vs ${previous6h} in the previous 6h` };
  }
  return { status: "peaking", rule: `steady coverage: ${last6h} sources in the last 6h vs ${previous6h} before` };
}

/** Compute every radar metric of a trend from its sources. Pure. */
export function computeTrendMetrics(input: MetricsInput): TrendMetrics {
  const now = input.now.getTime();
  // a published date slightly in the future (feed clock skew) counts as now
  const times = input.sources.map((s) => Math.min(s.time, now));
  const volume = input.sources.length;
  const publisherCount = new Set(input.sources.map((s) => s.publisher)).size;
  const W = STATUS_RULES.windowHours * HOUR;
  const last6h = times.filter((t) => now - t < W).length;
  const previous6h = times.filter((t) => now - t >= W && now - t < 2 * W).length;
  const velocity = Math.round(((last6h - previous6h) / STATUS_RULES.windowHours) * 1000) / 1000;
  const lastSeen = times.length ? Math.max(...times) : null;
  const firstSeen = times.length ? Math.min(...times) : null;
  const hoursSinceLast = lastSeen === null ? null : (now - lastSeen) / HOUR;
  const rated = input.sources.map((s) => s.credibility).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  const avgCredibility = rated.length ? round2(rated.reduce((a, b) => a + b, 0) / rated.length) : null;

  // ---- interest ------------------------------------------------------------
  const F = INTEREST_FACTORS;
  const recencyShare =
    hoursSinceLast === null ? 0 : clamp((F.recency.zeroHours - hoursSinceLast) / (F.recency.zeroHours - F.recency.fullHours), 0, 1);
  const factors: ExplainedFactor[] = [
    {
      key: "volume",
      label: "Volume",
      value: volume,
      points: round2((Math.min(volume, F.volume.saturation) / F.volume.saturation) * F.volume.max),
      max: F.volume.max,
      detail: `${plural(volume, "source")} (full points at ${F.volume.saturation})`,
    },
    {
      key: "publishers",
      label: "Publishers",
      value: publisherCount,
      points: round2((Math.min(publisherCount, F.publishers.saturation) / F.publishers.saturation) * F.publishers.max),
      max: F.publishers.max,
      detail: `${plural(publisherCount, "distinct publisher")} (full points at ${F.publishers.saturation})`,
    },
    {
      key: "momentum",
      label: "Momentum",
      value: last6h - previous6h,
      points: round2((clamp(last6h - previous6h, 0, F.momentum.saturation) / F.momentum.saturation) * F.momentum.max),
      max: F.momentum.max,
      detail: `${last6h} sources in the last 6h vs ${previous6h} in the previous 6h (full points at +${F.momentum.saturation})`,
    },
    {
      key: "recency",
      label: "Recency",
      value: hoursSinceLast === null ? null : round2(hoursSinceLast),
      points: round2(recencyShare * F.recency.max),
      max: F.recency.max,
      detail:
        hoursSinceLast === null
          ? "no dated source"
          : `newest source ${hoursSinceLast < 1 ? "under 1h" : `${Math.floor(hoursSinceLast)}h`} old (full ≤ ${F.recency.fullHours}h, zero at ${F.recency.zeroHours}h)`,
    },
    {
      key: "credibility",
      label: "Credibility",
      value: avgCredibility,
      points: avgCredibility === null ? F.credibility.unknownPoints : round2(avgCredibility * F.credibility.max),
      max: F.credibility.max,
      detail:
        avgCredibility === null
          ? `no publisher credibility rated yet: neutral ${F.credibility.unknownPoints} points (rate connectors in Sources & connectors)`
          : `average credibility ${avgCredibility} of ${plural(rated.length, "rated source")}`,
    },
  ];
  const interest = round2(factors.reduce((sum, f) => sum + f.points, 0));

  // ---- signals & curiosity ---------------------------------------------------
  const perSignal = new Map<RadarSignal, { sources: Set<string>; terms: Set<string> }>();
  for (const s of input.sources) {
    for (const m of s.signals) {
      const cur = perSignal.get(m.signal) ?? { sources: new Set<string>(), terms: new Set<string>() };
      cur.sources.add(s.id);
      m.terms.forEach((t) => cur.terms.add(t));
      perSignal.set(m.signal, cur);
    }
  }
  const trendLevel: SignalMatch[] = [...(input.eventSignals ?? [])];
  const rising = detectVelocitySignal(last6h, previous6h);
  if (rising) trendLevel.push(rising);

  const curiosityFactors: CuriosityFactor[] = [];
  for (const signal of sortSignals([...perSignal.keys(), ...trendLevel.map((m) => m.signal)])) {
    const max = CURIOSITY_POINTS[signal];
    const textHit = perSignal.get(signal);
    const trendHit = trendLevel.filter((m) => m.signal === signal);
    const share = trendHit.length ? 1 : volume ? round2((textHit?.sources.size ?? 0) / volume) : 0;
    const terms = [...new Set([...(textHit?.terms ?? []), ...trendHit.flatMap((m) => m.terms)])].sort().slice(0, 8);
    curiosityFactors.push({
      signal,
      label: SIGNAL_LABELS[signal],
      sources: trendHit.length ? volume : (textHit?.sources.size ?? 0),
      share,
      points: round2(max * (0.5 + 0.5 * share)),
      max,
      terms,
    });
  }
  const raw = round2(CURIOSITY_BASE + curiosityFactors.reduce((sum, f) => sum + f.points, 0));
  const curiosity = Math.min(100, raw);
  const signals = curiosityFactors.map((f) => f.signal);

  // ---- competition, radar, sweet spot, status --------------------------------
  const comp = competitionLevel(publisherCount, input.activePublishers);
  const gap = COMPETITION_GAP[comp.level];
  const contributions = {
    interest: round2(interest * RADAR_WEIGHTS.interest),
    curiosity: round2(curiosity * RADAR_WEIGHTS.curiosity),
    competition_gap: round2(gap * RADAR_WEIGHTS.competition_gap),
  };
  const radarScore = round2(contributions.interest + contributions.curiosity + contributions.competition_gap);
  const st = trendStatus({ volume, last6h, previous6h, hoursSinceLast });
  const checks = [
    { key: "interest", label: `Interest ${interest} ≥ ${SWEET_SPOT.interest}`, pass: interest >= SWEET_SPOT.interest },
    { key: "curiosity", label: `Curiosity ${curiosity} ≥ ${SWEET_SPOT.curiosity}`, pass: curiosity >= SWEET_SPOT.curiosity },
    { key: "competition", label: `Competition ${comp.level} (must not be high)`, pass: comp.level !== "high" },
    { key: "active", label: `Still active (${st.status})`, pass: st.status !== "expired" },
  ];
  const isSweetSpot = checks.every((c) => c.pass);

  return {
    volume,
    publisherCount,
    last6h,
    previous6h,
    velocity,
    hoursSinceLast: hoursSinceLast === null ? null : round2(hoursSinceLast),
    avgCredibility,
    interest,
    curiosity,
    competition: comp.level,
    radarScore,
    isSweetSpot,
    status: st.status,
    signals,
    firstSeen,
    lastSeen,
    explanation: {
      version: METRICS_VERSION,
      computed_at: input.now.toISOString(),
      interest: { score: interest, max: 100, factors },
      curiosity: { score: curiosity, base: CURIOSITY_BASE, raw, capped: raw > 100, factors: curiosityFactors },
      competition: {
        level: comp.level,
        publisher_count: publisherCount,
        active_publishers: Math.max(input.activePublishers, publisherCount),
        saturation: comp.saturation,
        gap,
        rule: comp.rule,
      },
      radar: { score: radarScore, weights: RADAR_WEIGHTS, contributions },
      sweet_spot: { value: isSweetSpot, checks },
      status: { value: st.status, rule: st.rule },
      velocity: { value: velocity, last_6h: last6h, previous_6h: previous6h, unit: "change in sources per hour" },
    },
  };
}

/** Narrow a stored radar_explanation (Json) to its typed shape, or null when it is from another version. */
export function parseRadarExplanation(value: unknown): RadarExplanation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Partial<RadarExplanation>;
  if (typeof v.version !== "string" || !v.interest || !v.curiosity || !v.competition || !v.radar || !v.sweet_spot || !v.status) return null;
  if (!Array.isArray(v.interest.factors) || !Array.isArray(v.curiosity.factors)) return null;
  return v as RadarExplanation;
}
