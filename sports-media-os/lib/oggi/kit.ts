/**
 * "Kit video" for one story, built from fixed Italian templates (no AI, no
 * cost): three titles, a hook, a 30–45 s outline, description and hashtags.
 * Pure and deterministic, so the same story always gives the same kit.
 */
import { COMPETITION_WORDS, extractEntities, GENERIC_WORDS, normalizeText } from "@/lib/trends/text";
import type { Enums } from "@/types/database";

export type Signal = Enums<"radar_signal">;

export type KitInput = {
  title: string;
  sport: string | null;
  signals: readonly Signal[];
  publishers: readonly string[];
};

export type Kit = {
  titles: string[];
  hook: string;
  outline: { label: string; text: string }[];
  description: string;
  hashtags: string[];
};

/** Italian label for each radar signal, shown as "why now" chips. */
export const SIGNAL_LABEL: Record<Signal, string> = {
  upcoming_event: "evento in arrivo",
  just_finished: "appena finito",
  breaking: "ultim'ora",
  upset: "sorpresa",
  record: "record",
  rivalry: "rivalità",
  controversy: "polemica",
  statement: "dichiarazione",
  unusual_stat: "dato curioso",
  injury: "infortunio",
  transfer: "mercato",
  rising_trend: "in crescita",
};

/** Sport names are stored in English; the kit and the page speak Italian. */
const SPORT_IT: Record<string, string> = {
  "American Football": "Football americano",
  Athletics: "Atletica",
  Basketball: "Basket",
  Boxing: "Boxe",
  Cycling: "Ciclismo",
  "Football (Soccer)": "Calcio",
  "Ice Hockey": "Hockey",
  Swimming: "Nuoto",
  Volleyball: "Pallavolo",
};

export function italianSport(name: string | null): string | null {
  return name ? (SPORT_IT[name] ?? name) : null;
}

/**
 * A signal steers the hook only when the headline itself says so: the radar
 * flags "record" or "upset" loosely, and a wrong hook is worse than a neutral one.
 */
const EVIDENCE: Partial<Record<Signal, RegExp>> = {
  record: /record|primato|storic|historic/i,
  transfer: /mercato|firma|acquist|cession|trasfer|transfer|signs?\b/i,
  injury: /infortun|lesion|stop|ko\b|injur/i,
  controversy: /polemic|furia|rabbia|arbitr|\bvar\b|rigore|espuls|regol|squalific|caos|accus/i,
  upset: /sorpres|clamoros|incredibil|impres|colpaccio|ribalt|rimont|shock|upset|stun/i,
};

export function confirmedSignals(title: string, signals: readonly Signal[]): Signal[] {
  return signals.filter((s) => !EVIDENCE[s] || EVIDENCE[s]!.test(title));
}

/**
 * The part of a headline that tells the story: first sentence, and after a
 * short "Category:" prefix ("Futsal, Serie A: Napoli imbattuto…" → "Napoli imbattuto…").
 */
export function leadClause(headline: string): string {
  let lead = headline.split(/(?<=[.!?])\s+/)[0] ?? headline;
  const colon = lead.indexOf(":");
  if (colon > 0) {
    const before = lead.slice(0, colon).trim();
    const after = lead.slice(colon + 1).trim();
    if (before.length < 28 && after.length >= 15) lead = after;
  }
  return lead.replace(/[.!?]+$/, "").trim();
}

function isRealName(display: string): boolean {
  const words = normalizeText(display).split(/\s+/);
  return display.length >= 3 && !words.every((w) => COMPETITION_WORDS.has(w) || GENERIC_WORDS.has(w));
}

/** "Titolo notizia - Gazzetta" → "Titolo notizia"; whitespace collapsed. */
export function cleanHeadline(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, "")
    .trim();
}

/** Cut at a word boundary, ending with "…" when shortened. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[,:;.\s]+$/, "")}…`;
}

function hashtag(word: string): string | null {
  const tag = word
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return tag.length >= 3 && tag.length <= 30 ? `#${tag}` : null;
}

const HOOK: Partial<Record<Signal, (s: string) => string>> = {
  upset: (s) => `Nessuno se l'aspettava: ${s}`,
  record: (s) => `È un record: ${s}`,
  breaking: (s) => `Notizia di poche ore fa: ${s}`,
  controversy: (s) => `Sta facendo discutere tutti: ${s}`,
  transfer: (s) => `Colpo di mercato: ${s}`,
  injury: (s) => `Brutta notizia: ${s}`,
  unusual_stat: (s) => `C'è un numero che nessuno ti ha detto: ${s}`,
};

const QUESTION: Partial<Record<Signal, string>> = {
  upset: "Te lo aspettavi?",
  record: "Lo rivedremo mai?",
  transfer: "Affare giusto o sbagliato?",
  controversy: "Da che parte stai?",
  injury: "Quanto pesa questa assenza?",
  rivalry: "Chi vince la prossima?",
};

/** First matching signal in priority order, so the strongest angle wins. */
function strongest<T>(signals: readonly Signal[], table: Partial<Record<Signal, T>>): T | undefined {
  const order: Signal[] = ["upset", "record", "controversy", "transfer", "injury", "breaking", "unusual_stat", "rivalry"];
  for (const s of order) if (signals.includes(s) && table[s] !== undefined) return table[s];
  return undefined;
}

export function buildKit(input: KitInput): Kit {
  const core = cleanHeadline(input.title);
  const lead = leadClause(core);
  const short = shorten(lead, 55);
  const sport = italianSport(input.sport);
  const signals = confirmedSignals(core, input.signals);
  // names from the story clause first, then the rest of the headline
  const names = [...extractEntities(lead), ...extractEntities(core)]
    .map((e) => e.display)
    .filter((n, i, all) => isRealName(n) && all.indexOf(n) === i)
    .slice(0, 3);
  const main = names[0] ?? null;

  const suffix = ", spiegato in 40 secondi";
  const titles = [
    shorten(core, 70),
    main ? `${main}: cosa è successo davvero` : shorten(`Cosa è successo davvero: ${short}`, 70),
    signals.includes("record") && main
      ? `Il record di ${main}, spiegato in 40 secondi`
      : lead.length <= 70 - suffix.length
        ? `${lead}${suffix}`
        : main
          ? `${main}: la storia in 40 secondi`
          : shorten(lead, 70),
  ].filter((t, i, all) => all.indexOf(t) === i);

  const hook = (strongest(signals, HOOK) ?? ((s: string) => `Fermati 3 secondi: ${s}`))(short);
  const question = strongest(signals, QUESTION) ?? "Tu cosa ne pensi?";
  const who = names.length ? names.join(", ") : (sport ?? "i protagonisti");

  const outline = [
    { label: "0–3 s · Gancio", text: hook },
    { label: "3–10 s · Contesto", text: `Chi e cosa: ${who}. Dove e quando, come riportato dalle fonti.` },
    { label: "10–25 s · Il fatto", text: `${core}. Racconta solo i dettagli che trovi nelle fonti.` },
    { label: "25–35 s · Perché conta", text: `Cosa cambia per ${main ?? "i tifosi"}: classifica, record, mercato o prossima partita.` },
    { label: "35–45 s · Chiusura", text: `Domanda ai follower: «${question}» Poi: «Seguimi per le storie dello sport.»` },
  ];

  const tags = new Set<string>();
  for (const n of [...names, ...(sport ? [sport] : [])]) {
    const t = hashtag(n);
    if (t) tags.add(t);
  }
  for (const t of ["#sport", "#shorts"]) tags.add(t);
  const hashtags = [...tags].slice(0, 7);

  const sources = input.publishers.length ? `\n\nFonti: ${[...new Set(input.publishers)].slice(0, 3).join(", ")}.` : "";
  const description = `${core}${sources}\n\n${hashtags.join(" ")}`;

  return { titles, hook, outline, description, hashtags };
}

/** The whole kit as plain text, ready to paste into notes or a teleprompter. */
export function kitText(kit: Kit): string {
  return [
    "TITOLI",
    ...kit.titles.map((t, i) => `${i + 1}. ${t}`),
    "",
    "GANCIO",
    kit.hook,
    "",
    "SCALETTA",
    ...kit.outline.map((o) => `${o.label}: ${o.text}`),
    "",
    "DESCRIZIONE",
    kit.description,
  ].join("\n");
}
