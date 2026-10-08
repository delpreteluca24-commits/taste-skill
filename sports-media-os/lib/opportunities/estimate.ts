import type { Enums } from "@/lib/db/client";
import { EDITORIAL_FORMATS, type EditorialFormat } from "@/lib/rights/alternatives";
import type { ScoreComponentKey } from "@/lib/scoring/opportunity";

/**
 * OPPORTUNITY ENGINE — heuristic component estimators (pure: no DB, no AI).
 *
 * Each estimator returns { value, origin: "heuristic", reason } for one score
 * component of lib/scoring/opportunity.ts. Rules:
 * - value is 0–100, or null when we have nothing reliable to go on (never a guess)
 * - reason says WHY in plain words, with the numbers it used
 * - only stored data is used: trend metrics, event dates, sport, research counts,
 *   rights of linked assets. Nothing is invented.
 * AI (prompts/scoring) and humans (manual overrides) refine these later; a
 * heuristic never overwrites an AI or manual value (see ./scoring.ts).
 */

export type RadarSignal = Enums<"radar_signal">;
export type CompetitionLevel = Enums<"competition_level">;

export type Estimate = { value: number | null; origin: "heuristic"; reason: string };
export type Estimates = Record<ScoreComponentKey, Estimate>;

export type TrendFacts = {
  title: string;
  trend_score: number | null;
  curiosity_score: number | null;
  competition_level: CompetitionLevel | null;
  publisher_count: number | null;
  source_count: number | null;
  signals: RadarSignal[];
  last_seen_at: string | null;
  status?: Enums<"trend_status"> | null;
  is_sweet_spot?: boolean | null;
};

export type EventFacts = {
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  status?: Enums<"event_status"> | null;
};

export type SportFacts = { slug: string; name: string };

export type ResearchCounts = { sources: number; confirmedFacts: number; timelineItems: number };

export type AssetRights = { status: Enums<"rights_status">; usable: boolean };

/** What the production plan (stories.production_formats) needs, and the rights of the linked assets. */
export type RightsRoute = { productionFormats: EditorialFormat[]; assets: AssetRights[] };

export type EstimateInput = {
  angle?: string | null;
  /** opportunity-level signals/competition (manual opportunities have no trend) */
  signals?: RadarSignal[];
  competitionLevel?: CompetitionLevel | null;
  trend?: TrendFacts | null;
  event?: EventFacts | null;
  sport?: SportFacts | null;
  research?: ResearchCounts;
  rights?: RightsRoute;
  now?: Date;
};

const HOUR = 3_600_000;

function clamp(v: number) {
  return Math.round(Math.min(100, Math.max(0, v)));
}
function est(value: number, reason: string): Estimate {
  return { value: clamp(value), origin: "heuristic", reason };
}
function none(reason: string): Estimate {
  return { value: null, origin: "heuristic", reason };
}
function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function humanizeSignal(s: string) {
  return s.replace(/_/g, " ");
}
function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}
/** 5h / 2 days — for reasons */
export function formatHours(hours: number): string {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} days`;
}
function allSignals(input: EstimateInput): RadarSignal[] {
  return [...new Set([...(input.trend?.signals ?? []), ...(input.signals ?? [])])];
}

/* ------------------------------------------------------------------------- */
/* Reference baselines (editorial judgement, not measured data)              */
/* ------------------------------------------------------------------------- */

/**
 * AUDIENCE baseline per sport (0–100): relative size of the global short-form
 * sports audience (YouTube Shorts / TikTok / Reels), as an editorial starting
 * point. Football leads by a wide margin; niche sports start lower. It is a
 * baseline, not a measurement: AI scoring or a manual override refines it.
 * Unknown sports get no value (not guessed).
 */
export const SPORT_AUDIENCE_BASELINE: Readonly<Record<string, number>> = {
  football: 90,
  basketball: 78,
  "american-football": 70,
  "formula-1": 72,
  cricket: 70,
  tennis: 62,
  mma: 62,
  boxing: 58,
  baseball: 55,
  esports: 55,
  motogp: 50,
  "ice-hockey": 48,
  golf: 45,
  rugby: 45,
  athletics: 45,
  cycling: 40,
  volleyball: 38,
  swimming: 35,
};

/**
 * MONETIZATION baseline per sport (0–100): advertiser demand and typical
 * revenue per view of the sport's audience (premium audiences such as golf,
 * F1 and American football monetize better per view than their size suggests).
 */
export const SPORT_MONETIZATION_BASELINE: Readonly<Record<string, number>> = {
  "american-football": 80,
  "formula-1": 78,
  golf: 78,
  football: 70,
  basketball: 70,
  tennis: 68,
  baseball: 65,
  "ice-hockey": 60,
  motogp: 60,
  cricket: 58,
  cycling: 55,
  rugby: 55,
  esports: 55,
  athletics: 50,
  swimming: 50,
  mma: 50,
  boxing: 50,
  volleyball: 45,
};

/** Signals that make people want to know more (points added to a base of 40). */
const CURIOSITY_SIGNAL_POINTS: Partial<Record<RadarSignal, number>> = {
  upset: 20,
  record: 15,
  controversy: 15,
  unusual_stat: 15,
  statement: 10,
  rivalry: 10,
  transfer: 10,
  injury: 5,
  breaking: 5,
};

/** Formats that rely on someone else's footage/material (STORY ≠ FOOTAGE: everything else is original). */
export const FOOTAGE_FORMATS: ReadonlySet<EditorialFormat> = new Set<EditorialFormat>([
  "authorized_footage",
  "licensed_footage",
  "creator_provided",
  "public_sources",
  "screenshots",
]);

function formatLabel(f: EditorialFormat) {
  return EDITORIAL_FORMATS.find((x) => x.value === f)?.label.toLowerCase() ?? f;
}

/* ------------------------------------------------------------------------- */
/* Estimators                                                                */
/* ------------------------------------------------------------------------- */

function describeCoverage(t: Pick<TrendFacts, "source_count" | "publisher_count">): string | null {
  const parts: string[] = [];
  if (t.source_count !== null && t.source_count !== undefined) parts.push(plural(t.source_count, "source"));
  if (t.publisher_count !== null && t.publisher_count !== undefined) parts.push(`${plural(t.publisher_count, "publisher")}`);
  return parts.length ? parts.join(" from ") : null;
}

/** TREND — strength of the trend on the radar. */
export function estimateTrend(trend: TrendFacts | null | undefined): Estimate {
  if (!trend) return none("No linked trend, so trend strength is unknown. Set it manually if you have audience data.");
  const coverage = describeCoverage(trend);
  if (trend.trend_score !== null && trend.trend_score !== undefined) {
    const status = trend.status ? `, trend ${trend.status}` : "";
    return est(trend.trend_score, `Radar trend score ${Math.round(trend.trend_score)}${coverage ? ` (${coverage}${status})` : status}.`);
  }
  if (trend.publisher_count !== null || trend.source_count !== null) {
    const p = Math.min(trend.publisher_count ?? 0, 6);
    const s = Math.min(trend.source_count ?? 0, 10);
    return est(
      20 + 10 * p + 2 * s,
      `No radar score yet; estimated from coverage (${coverage}): the more independent publishers report it, the stronger the trend.`,
    );
  }
  return none("The trend has no radar score or coverage counts yet.");
}

type Part = { value: number; reason: string };

function eventTimeliness(event: EventFacts | null | undefined, now: number): Part | null {
  // a postponed/cancelled date says nothing about timing: trend recency decides
  if (!event || event.status === "postponed" || event.status === "cancelled") return null;
  const start = parseTime(event.starts_at);
  let end = parseTime(event.ends_at);
  const name = `"${event.title}"`;

  if (event.status === "live" || (start !== null && start <= now && (end === null ? now - start <= 3 * HOUR && event.status !== "finished" : now <= end))) {
    return { value: 100, reason: `${name} is live now: interest peaks during the event.` };
  }
  if (start !== null && start > now) {
    const hours = (start - now) / HOUR;
    if (hours <= 72) return { value: 100 - (hours / 72) * 20, reason: `${name} starts in ${formatHours(hours)} (within 72h): searches build before kick-off.` };
    if (hours <= 168) return { value: 60 - ((hours - 72) / 96) * 15, reason: `${name} starts in ${formatHours(hours)}: early, interest grows closer to the date.` };
    return { value: 30, reason: `${name} is more than a week away: too early to be timely.` };
  }
  // finished (or started long ago without an end time: use the start as the reference)
  if (end === null && start !== null) end = start;
  if (end === null) return null;
  const since = (now - end) / HOUR;
  const approx = event.ends_at ? "" : " (end time unknown, using the start time)";
  if (since <= 24) return { value: 95 - (since / 24) * 15, reason: `${name} finished ${formatHours(since)} ago${approx} (within 24h): reactions and analysis peak now.` };
  if (since <= 72) return { value: 60 - ((since - 24) / 48) * 20, reason: `${name} finished ${formatHours(since)} ago${approx}: the first wave of coverage has passed.` };
  if (since <= 168) return { value: 30, reason: `${name} finished ${formatHours(since)} ago${approx}: late for news, still fine for analysis.` };
  return { value: 15, reason: `${name} finished ${formatHours(since)} ago${approx}: the news cycle has moved on.` };
}

function trendRecency(trend: TrendFacts | null | undefined, now: number): Part | null {
  const seen = parseTime(trend?.last_seen_at);
  if (seen === null) return null;
  const hours = Math.max(0, (now - seen) / HOUR);
  const ago = `Trend last seen ${formatHours(hours)} ago`;
  if (hours <= 6) return { value: 90, reason: `${ago}: still being reported right now.` };
  if (hours <= 24) return { value: 75, reason: `${ago}: active within the last day.` };
  if (hours <= 72) return { value: 50, reason: `${ago}: cooling down.` };
  if (hours <= 168) return { value: 30, reason: `${ago}: mostly over.` };
  return { value: 15, reason: `${ago}: no recent activity.` };
}

const TIMELY_SIGNALS: RadarSignal[] = ["breaking", "just_finished", "upcoming_event"];

/**
 * TIMELINESS — an event upcoming within 72h or finished within 24h is timely;
 * otherwise trend recency decides. The more timely of the two counts.
 */
export function estimateTimeliness(input: EstimateInput): Estimate {
  const now = (input.now ?? new Date()).getTime();
  const parts = [eventTimeliness(input.event, now), trendRecency(input.trend, now)].filter((p): p is Part => p !== null);
  if (parts.length === 0) return none("No event date and no trend activity recorded, so timeliness is unknown.");
  parts.sort((a, b) => b.value - a.value);
  const [best, other] = parts;
  let value = best.value;
  let reason = best.reason + (other ? ` Also: ${other.reason}` : "");
  const timely = allSignals(input).filter((s) => TIMELY_SIGNALS.includes(s));
  if (timely.length > 0 && value < 100) {
    value += 10;
    reason += ` Signal ${timely.map(humanizeSignal).join(", ")} adds +10.`;
  }
  return est(value, reason);
}

/** CURIOSITY — the radar's curiosity score, otherwise the curiosity signals. */
export function estimateCuriosity(input: EstimateInput): Estimate {
  const signals = allSignals(input);
  const score = input.trend?.curiosity_score;
  if (score !== null && score !== undefined) {
    return est(score, `Radar curiosity score ${Math.round(score)}${signals.length ? ` (signals: ${signals.map(humanizeSignal).join(", ")})` : ""}.`);
  }
  const hits = signals.filter((s) => CURIOSITY_SIGNAL_POINTS[s]);
  if (hits.length === 0) {
    return none("No curiosity signals (upset, record, controversy, unusual stat…) detected. Score it with AI or manually.");
  }
  const points = hits.reduce((sum, s) => sum + (CURIOSITY_SIGNAL_POINTS[s] ?? 0), 0);
  return est(
    Math.min(90, 40 + points),
    `Curiosity signals ${hits.map((s) => `${humanizeSignal(s)} +${CURIOSITY_SIGNAL_POINTS[s]}`).join(", ")} on a base of 40 (capped at 90).`,
  );
}

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have how in into is it its of on or our that the their this to vs was were what when where who why will with after before over under about".split(" "),
);

export function significantWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  ];
}

/** Share (0–1) of the angle's significant words that already appear in the headline. */
export function angleOverlap(angle: string, headline: string): number {
  const a = significantWords(angle);
  if (a.length === 0) return 1;
  const h = new Set(significantWords(headline));
  return a.filter((w) => h.has(w)).length / a.length;
}

/** at or below this overlap, an angle counts as clearly different from the headline */
export const DISTINCT_ANGLE_MAX_OVERLAP = 0.34;

/**
 * ORIGINALITY — no reliable heuristic: left empty for AI/manual scoring, unless
 * the angle clearly differs from the trend headline (then a moderate 65).
 */
export function estimateOriginality(input: EstimateInput): Estimate {
  const angle = input.angle?.trim();
  if (!angle) return none("No angle yet. Originality depends on the take: add an angle, or score it with AI or manually.");
  if (significantWords(angle).length === 0) {
    return none("The angle is too short to compare with anything. Describe the take in a few words, or score originality with AI or manually.");
  }
  const headline = input.trend?.title?.trim();
  if (!headline) return none("No trend headline to compare the angle with. Score originality with AI or manually.");
  const overlap = angleOverlap(angle, headline);
  const pct = Math.round(overlap * 100);
  if (overlap <= DISTINCT_ANGLE_MAX_OVERLAP) {
    return est(65, `The angle differs clearly from the trend headline (${pct}% word overlap): a distinct take, not a repeat of the news. AI or a human can rate how strong it is.`);
  }
  return none(`The angle mostly repeats the trend headline (${pct}% word overlap). Originality needs AI or manual scoring.`);
}

/** AUDIENCE — sport baseline (SPORT_AUDIENCE_BASELINE) plus reach signals. */
export function estimateAudience(input: EstimateInput): Estimate {
  const sport = input.sport;
  if (!sport) return none("Sport unknown, so audience size is not estimated.");
  const base = SPORT_AUDIENCE_BASELINE[sport.slug];
  if (base === undefined) return none(`No audience baseline for ${sport.name} yet. Set it manually.`);
  let value = base;
  const notes: string[] = [];
  if (allSignals(input).includes("rivalry")) {
    value += 5;
    notes.push("rivalry +5 (pulls in both fan bases)");
  }
  if ((input.trend?.publisher_count ?? 0) >= 5) {
    value += 5;
    notes.push(`${input.trend?.publisher_count} publishers +5 (interest beyond core fans)`);
  }
  return est(value, `${sport.name} baseline ${base} (relative size of the short-form sports audience)${notes.length ? `; ${notes.join(", ")}` : ""}.`);
}

/** COMPETITION GAP — how much room is left: low competition = big gap. */
export function estimateCompetitionGap(input: EstimateInput): Estimate {
  const level = input.trend?.competition_level ?? input.competitionLevel ?? null;
  const sweet = input.trend?.is_sweet_spot ? " The radar flags it as a sweet spot." : "";
  if (level === "low") return est(80, `Competition is low: few creators cover it yet, so there is room to be first.${sweet}`);
  if (level === "medium") return est(55, `Competition is medium: some coverage exists; a sharper angle still stands out.${sweet}`);
  if (level === "high") return est(25, `Competition is high: the topic is crowded; only a clearly different angle will stand out.${sweet}`);
  const publishers = input.trend?.publisher_count;
  if (publishers !== null && publishers !== undefined) {
    const value = publishers <= 2 ? 70 : publishers <= 5 ? 55 : publishers <= 10 ? 40 : 25;
    return est(value, `No competition level on the radar; ${plural(publishers, "publisher")} already cover it (more coverage = less room).`);
  }
  return none("No competition data (level or publisher count) yet.");
}

/** PRODUCTION FEASIBILITY — research material on hand (original commentary is always possible). */
export function estimateProductionFeasibility(input: EstimateInput): Estimate {
  const r = input.research ?? { sources: 0, confirmedFacts: 0, timelineItems: 0 };
  const sourcePts = Math.min(r.sources, 5) * 7;
  const factPts = Math.min(r.confirmedFacts, 5) * 4;
  const timelinePts = r.timelineItems >= 3 ? 10 : r.timelineItems > 0 ? 5 : 0;
  const material = `${plural(r.sources, "source")}, ${plural(r.confirmedFacts, "confirmed fact")}, ${plural(r.timelineItems, "timeline item")}`;
  const hint =
    r.sources + r.confirmedFacts + r.timelineItems === 0
      ? " No research material yet: production starts from scratch."
      : r.confirmedFacts === 0
        ? " Confirmed facts would make it faster to produce."
        : "";
  return est(
    35 + sourcePts + factPts + timelinePts,
    `${material}. Base 35 (original commentary is always possible) + sources ${sourcePts} + facts ${factPts} + timeline ${timelinePts}.${hint}`,
  );
}

/**
 * RIGHTS SAFETY — STORY ≠ FOOTAGE. Production defaults to original formats, so
 * rights safety stays high (85). It drops only when the chosen production
 * formats depend on someone else's material and that material is RED or
 * YELLOW. A RED article used as a reference does not lower it.
 */
export function estimateRightsSafety(input: EstimateInput): Estimate {
  const formats = input.rights?.productionFormats ?? [];
  const footage = formats.filter((f) => FOOTAGE_FORMATS.has(f));
  if (footage.length === 0) {
    return est(
      85,
      formats.length
        ? `The production plan uses original formats only (${formats.map(formatLabel).join(", ")}): no third-party footage needed.`
        : "No production plan yet: production defaults to original formats (commentary, voiceover, graphics) that need no third-party footage. Story ≠ footage.",
    );
  }
  const uses = `The plan uses ${footage.map(formatLabel).join(", ")}`;
  const assets = input.rights?.assets ?? [];
  const red = assets.filter((a) => a.status === "red").length;
  const yellowPending = assets.filter((a) => a.status === "yellow" && !a.usable).length;
  const yellowApproved = assets.filter((a) => a.status === "yellow" && a.usable).length;
  const unchecked = assets.filter((a) => a.status === "unchecked").length;
  if (red > 0) {
    return est(25, `${uses} and ${plural(red, "linked asset")} ${red === 1 ? "is" : "are"} RED: RED material never enters production. Switch those parts to original formats to restore ~85.`);
  }
  if (yellowPending > 0) {
    return est(
      55,
      `${uses} and ${plural(yellowPending, "linked asset")} ${yellowPending === 1 ? "is" : "are"} YELLOW awaiting a human rights approval (never usable by automated workflows).`,
    );
  }
  if (yellowApproved > 0) {
    return est(75, `${uses}; ${plural(yellowApproved, "YELLOW asset")} approved by a human, usable only under the recorded conditions.`);
  }
  return est(85, `${uses}; no linked asset is YELLOW or RED${unchecked ? ` (${unchecked} still unchecked: classify before use)` : ""}.`);
}

/** MONETIZATION — sport baseline (SPORT_MONETIZATION_BASELINE), minus brand-safety risk. */
export function estimateMonetization(input: EstimateInput): Estimate {
  const sport = input.sport;
  if (!sport) return none("Sport unknown, so monetization is not estimated.");
  const base = SPORT_MONETIZATION_BASELINE[sport.slug];
  if (base === undefined) return none(`No monetization baseline for ${sport.name} yet. Set it manually.`);
  const signals = allSignals(input);
  let value = base;
  const notes: string[] = [];
  if (signals.includes("controversy")) {
    value -= 10;
    notes.push("controversy −10");
  }
  if (signals.includes("injury")) {
    value -= 5;
    notes.push("injury −5");
  }
  return est(
    value,
    `${sport.name} baseline ${base} (advertiser demand for this audience)` +
      (notes.length ? `; ${notes.join(", ")}: some advertisers avoid these topics (brand safety).` : "."),
  );
}

/** All nine components. */
export function estimateComponents(input: EstimateInput): Estimates {
  return {
    trend: estimateTrend(input.trend),
    timeliness: estimateTimeliness(input),
    curiosity: estimateCuriosity(input),
    originality: estimateOriginality(input),
    audience: estimateAudience(input),
    competition_gap: estimateCompetitionGap(input),
    production_feasibility: estimateProductionFeasibility(input),
    rights_safety: estimateRightsSafety(input),
    monetization: estimateMonetization(input),
  };
}

/**
 * WHY NOW — one or two sentences built only from stored data (event timing,
 * trend recency/coverage, signals). Returns null when there is nothing to say.
 */
export function buildWhyNow(input: Pick<EstimateInput, "trend" | "event" | "signals" | "now">): string | null {
  const now = (input.now ?? new Date()).getTime();
  const parts: string[] = [];
  const ev = input.event;
  if (ev && ev.status !== "postponed" && ev.status !== "cancelled") {
    const start = parseTime(ev.starts_at);
    const end = parseTime(ev.ends_at) ?? (ev.status === "finished" ? start : null);
    if (ev.status === "live" || (start !== null && start <= now && (end === null || now <= end) && now - start <= 3 * HOUR)) {
      parts.push(`${ev.title} is live now.`);
    } else if (start !== null && start > now && start - now <= 72 * HOUR) {
      parts.push(`${ev.title} starts in ${formatHours((start - now) / HOUR)}.`);
    } else if (end !== null && end <= now && now - end <= 24 * HOUR) {
      parts.push(`${ev.title} finished ${formatHours((now - end) / HOUR)} ago.`);
    }
  }
  const t = input.trend;
  if (t) {
    const seen = parseTime(t.last_seen_at);
    const coverage = describeCoverage(t);
    const bits = [
      seen !== null ? `seen ${formatHours(Math.max(0, now - seen) / HOUR)} ago` : null,
      coverage ? `across ${coverage}` : null,
      t.status ? `(${t.status})` : null,
    ].filter(Boolean);
    if (bits.length) parts.push(`Trend ${bits.join(" ")}.`);
    if (t.is_sweet_spot) parts.push("Flagged as a radar sweet spot.");
  }
  const signals = [...new Set([...(t?.signals ?? []), ...(input.signals ?? [])])];
  if (signals.length) parts.push(`Signals: ${signals.map(humanizeSignal).join(", ")}.`);
  return parts.length ? parts.join(" ") : null;
}
