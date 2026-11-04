import type { Enums } from "@/lib/db/client";
import { normalizeText } from "@/lib/trends/text";
import { Constants } from "@/types/database";

/**
 * Editorial signals the Sports Radar looks for — it is NOT a news feed.
 *
 * - Text signals (breaking, upset, record, rivalry, controversy, statement,
 *   unusual_stat, injury, transfer) come from EN + IT lexicons and patterns
 *   matched on the headline/summary. Every hit returns the matched words, so a
 *   signal can always be explained ("upset ← stuns, shock").
 * - upcoming_event / just_finished come from the linked event's schedule.
 * - rising_trend comes from coverage velocity (lib/trends/metrics.ts).
 *
 * Matching runs on normalized text (lowercase, no diacritics: "più" → "piu").
 */

export type RadarSignal = Enums<"radar_signal">;
export const RADAR_SIGNALS = Constants.public.Enums.radar_signal;

export const TEXT_SIGNALS = [
  "breaking",
  "upset",
  "record",
  "rivalry",
  "controversy",
  "statement",
  "unusual_stat",
  "injury",
  "transfer",
] as const satisfies readonly RadarSignal[];
export type TextSignal = (typeof TEXT_SIGNALS)[number];

export const SIGNAL_LABELS: Record<RadarSignal, string> = {
  upcoming_event: "Upcoming event",
  just_finished: "Just finished",
  breaking: "Breaking",
  upset: "Upset",
  record: "Record",
  rivalry: "Rivalry",
  controversy: "Controversy",
  statement: "Statement",
  unusual_stat: "Unusual stat",
  injury: "Injury",
  transfer: "Transfer",
  rising_trend: "Rising trend",
};

export const SIGNAL_DESCRIPTIONS: Record<RadarSignal, string> = {
  upcoming_event: "Linked event starts within the next 72 hours",
  just_finished: "Linked event finished in the last 24 hours",
  breaking: "Breaking or officially confirmed news",
  upset: "Surprise result, shock, underdog win",
  record: "Record, first ever, all-time, historic",
  rivalry: "Derby, clásico, rivalry",
  controversy: "VAR, bans, suspensions, polemics, rows",
  statement: "Someone said, slammed, admitted, revealed",
  unusual_stat: "Streaks, most/fewest with numbers, consecutive runs",
  injury: "Injury, ruled out, surgery",
  transfer: "Transfer market, signings, loans, contracts",
  rising_trend: "Coverage accelerating: more sources in the last 6h than the previous 6h",
};

/**
 * number words (EN + IT) that count as a number for statistical patterns
 * ("sei" is left out: in Italian it is mostly the verb "you are")
 */
const NUMBER_WORDS =
  "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|" +
  "due|tre|quattro|cinque|sette|otto|nove|dieci|undici|dodici|quindici|venti|trenta|cinquanta|cento";
const NUM = `(?:\\d+|${NUMBER_WORDS})`;

type Rule = { re: RegExp; requiresNumber?: boolean };
const r = (source: string, opts: Omit<Rule, "re"> = {}): Rule => ({ re: new RegExp(`\\b(?:${source})\\b`, "g"), ...opts });

/**
 * Lexicons per signal. Patterns are documented by example in
 * tests/unit/radar-signals.test.ts; add terms there when you add them here.
 * Matches do not overlap and the first alternative wins, so longer phrases
 * ("shock win") are listed before their parts ("shock").
 */
export const SIGNAL_RULES: Record<TextSignal, Rule[]> = {
  breaking: [
    r("breaking(?: news)?|just in|officially|official|confirmed|announces?|announced"),
    r("ultim'ora|ultima ora|ultimissim[oaie]|ufficiale|ufficialmente|annuncia(?:to)?|confermat[oaie]"),
  ],
  upset: [
    r("shock (?:win|defeat|loss|exit)|surprise (?:win|defeat|loss|exit)|upsets?|stuns?|stunned|stunning|shocks?|shocked|shocking|giant[- ]?kill(?:ing|ers?)|underdogs?|against all odds"),
    r("clamoros[oaie]|sorpres[ae]|a sorpresa|colpaccio|impresa|ribalt(?:one|a|ata)|beffa|cenerentola|crollo"),
  ],
  record: [
    r("records?|record-breaking|first[- ]ever|all[- ]time|historic|history|makes history|milestone|unprecedented|never before"),
    r("storic[oaie]|primato|per la prima volta|prima volta nella storia|nella storia|mai nessuno"),
  ],
  rivalry: [
    r("derby|derbies|clasico|el clasico|superclasico|rivalry|rivals?|grudge match|old firm|rematch|revenge"),
    r("derby d'italia|rivalita|rival[ei]|sfida infinita|vendetta|stracittadina"),
  ],
  controversy: [
    r("var|ban|bans|banned|controvers(?:y|ial)|row (?:over|with|after)|furious|fury|outrage|scandal|appeal|suspension|suspended|disallowed|investigation|charged|fined|protests?"),
    r("polemic(?:a|he|o|i)|squalific(?:a|he|ato|ata|ati)|scandalo|ricorso|moviola|bufera|furia|caos|protest[ae]|multat[oaie]|multa|inchiesta|indagine|sospes[oaie]|espuls(?:o|i|ione)"),
  ],
  statement: [
    r("says|said|slams?|slammed|blasts?|hits back|fires back|claims?|admits?|admitted|reveals?|revealed|insists?|warns?|speaks out|responds?|press conference|interview"),
    r("attacca|dichiara(?:zioni)?|parla|ha detto|rivela|ammette|intervista|conferenza(?: stampa)?|risponde|sbotta|tuona|replica|frecciata"),
  ],
  unusual_stat: [
    r("streak|consecutive|in a row|unbeaten|winless|straight (?:wins?|defeats?|losses|games|matches|titles)"),
    r(`${NUM} (?:straight|successive)`),
    r("most|fewest|highest|lowest|longest|fastest|youngest|oldest", { requiresNumber: true }),
    r("\\d{2,}(?:st|nd|rd|th) (?:goal|win|title|appearance|cap|career)"),
    r("consecutiv[oaie]|di fila|striscia|imbattut[oaie]|serie (?:positiva|negativa|utile)"),
    r("il piu giovane|il piu anziano|piu veloce|(?:piu|meno) (?:gol|vittorie|sconfitte|punti)", { requiresNumber: true }),
  ],
  injury: [
    r("injury|injuries|injured|ruled out|sidelined|hamstring|acl|ankle|knee injury|fracture|surgery|concussion|out for (?:weeks|months|the season)|fitness doubt|retires hurt"),
    r("infortun(?:io|i|ato|ata|ati)|lesione|frattura|crociato|distorsione|risentimento|affaticamento|operat[oaie]|ai box|out per"),
  ],
  transfer: [
    r("transfers?|sign|signs|signed|signing|joins|joined|loan|here we go|bid|release clause|contract extension|agrees terms|free agent|medical|deal agreed"),
    r("calciomercato|mercato|trattativa|acquisto|cessione|prestito|visite mediche|firma|clausola|rinnovo|ingaggio"),
  ],
};

const HAS_NUMBER = new RegExp(`\\b${NUM}\\b`);

export type SignalMatch = { signal: RadarSignal; terms: string[] };
export type SignalDetection = {
  signals: RadarSignal[];
  /** every detected signal with the words that triggered it (explainable) */
  matches: SignalMatch[];
};

/** Signals in canonical enum order (stable for storage and tests). */
export function sortSignals(signals: Iterable<RadarSignal>): RadarSignal[] {
  const set = new Set(signals);
  return RADAR_SIGNALS.filter((s) => set.has(s));
}

/** Detect text signals in a headline/summary (EN + IT). */
export function detectTextSignals(...texts: (string | null | undefined)[]): SignalDetection {
  const text = normalizeText(texts.filter(Boolean).join(" \n "));
  if (!text) return { signals: [], matches: [] };
  const hasNumber = HAS_NUMBER.test(text);
  const matches: SignalMatch[] = [];

  for (const signal of TEXT_SIGNALS) {
    const terms = new Set<string>();
    for (const rule of SIGNAL_RULES[signal]) {
      if (rule.requiresNumber && !hasNumber) continue;
      rule.re.lastIndex = 0;
      for (const m of text.matchAll(rule.re)) terms.add(m[0]);
    }
    if (terms.size) matches.push({ signal, terms: [...terms].sort() });
  }
  return { signals: matches.map((m) => m.signal), matches };
}

export type EventTiming = {
  status: Enums<"event_status">;
  starts_at: string | null;
  ends_at: string | null;
};

export const UPCOMING_WINDOW_HOURS = 72;
export const JUST_FINISHED_WINDOW_HOURS = 24;

/**
 * Event-based signals:
 * - upcoming_event: scheduled/live and starting within the next 72h
 * - just_finished: finished, ended (or started, when the end is unknown) in the last 24h
 */
export function detectEventSignals(event: EventTiming | null | undefined, now: Date = new Date()): SignalMatch[] {
  if (!event) return [];
  const t = now.getTime();
  const start = event.starts_at ? Date.parse(event.starts_at) : NaN;
  const end = event.ends_at ? Date.parse(event.ends_at) : start;
  const out: SignalMatch[] = [];
  if ((event.status === "scheduled" || event.status === "live") && Number.isFinite(start)) {
    const hours = (start - t) / 3_600_000;
    if (event.status === "live" || (hours >= 0 && hours <= UPCOMING_WINDOW_HOURS)) {
      out.push({ signal: "upcoming_event", terms: [event.status === "live" ? "live now" : `starts in ${Math.max(0, Math.round(hours))}h`] });
    }
  }
  if (event.status === "finished" && Number.isFinite(end)) {
    const hours = (t - end) / 3_600_000;
    if (hours >= 0 && hours <= JUST_FINISHED_WINDOW_HOURS) {
      out.push({ signal: "just_finished", terms: [`finished ${Math.round(hours)}h ago`] });
    }
  }
  return out;
}

/** rising_trend: at least 2 sources in the last 6h AND more than in the previous 6h. */
export function detectVelocitySignal(last6h: number, previous6h: number): SignalMatch | null {
  if (last6h >= 2 && last6h > previous6h) {
    return { signal: "rising_trend", terms: [`${last6h} sources in the last 6h vs ${previous6h} in the previous 6h`] };
  }
  return null;
}
