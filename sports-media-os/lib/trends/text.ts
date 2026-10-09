/**
 * Text utilities shared by the radar signal detector (lib/radar/signals.ts) and
 * the trend clusterer (lib/trends/cluster.ts). Pure and deterministic: the
 * same headline always yields the same tokens, keywords and entities.
 *
 * Languages: English and Italian (the project's two editorial languages).
 */

/** lowercase, strip diacritics (è → e), unify apostrophes/quotes/dashes, collapse spaces */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// prettier-ignore
export const STOPWORDS_EN: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on", "at", "by", "for", "with", "from", "as",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did", "will", "would",
  "can", "could", "should", "may", "might", "must", "shall", "this", "that", "these", "those", "it", "its", "he",
  "she", "they", "them", "his", "her", "their", "we", "our", "you", "your", "i", "me", "my", "not", "no", "so",
  "than", "then", "there", "here", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "all",
  "any", "both", "each", "few", "more", "most", "other", "some", "such", "only", "own", "same", "too", "very",
  "just", "also", "after", "before", "over", "under", "again", "about", "into", "out", "up", "down", "off",
  "against", "between", "through", "during", "while", "via", "vs", "v", "s", "t", "amid", "despite", "per",
]);

// prettier-ignore
export const STOPWORDS_IT: ReadonlySet<string> = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
  "del", "dello", "della", "dei", "degli", "delle", "al", "allo", "alla", "ai", "agli", "alle", "dal", "dallo",
  "dalla", "dai", "dagli", "dalle", "nel", "nello", "nella", "nei", "negli", "nelle", "sul", "sullo", "sulla",
  "sui", "sugli", "sulle", "e", "ed", "o", "ma", "se", "che", "chi", "cui", "non", "si", "ci", "ne", "piu", "meno",
  "come", "anche", "gia", "ancora", "dopo", "prima", "sono", "ha", "hanno", "era", "essere", "stato", "stata",
  "questo", "questa", "questi", "queste", "quello", "quella", "suo", "sua", "suoi", "sue", "loro", "mio", "tuo",
  "nostro", "ecco", "contro", "senza", "sopra", "sotto", "verso", "dove", "quando", "perche", "cosa", "tutto",
  "tutti", "molto", "poco", "l", "d", "all", "dell", "nell", "sull", "dall", "c", "lui", "lei", "noi", "voi",
]);

/**
 * Words too common in sports headlines to tell two stories apart. They are
 * dropped from keywords and break entity sequences ("Inter Win" ≠ an entity).
 * Signals are detected on the raw text, so these words still count there.
 */
// prettier-ignore
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  // en
  "win", "wins", "won", "beat", "beats", "match", "matches", "game", "games", "season", "team", "teams", "player",
  "players", "coach", "manager", "club", "clubs", "fans", "live", "video", "videos", "watch", "report", "reports",
  "update", "updates", "news", "breaking", "exclusive", "official", "highlights", "preview", "review", "result",
  "results", "score", "scores", "says", "said", "sport", "sports", "today", "tonight", "week", "weekend", "day",
  "first", "last", "next", "time", "year", "years", "big", "top", "best", "new", "now", "how", "why", "what",
  "analysis", "opinion", "column", "podcast", "gallery", "photos", "ratings", "reaction", "verdict",
  // it
  "vittoria", "vince", "vincono", "partita", "partite", "gara", "gare", "squadra", "squadre", "giocatore",
  "giocatori", "allenatore", "tecnico", "tifosi", "oggi", "notizie", "notizia", "ufficiale", "diretta", "risultato",
  "risultati", "giornata", "stagione", "gol", "pagelle", "commento", "foto", "anno", "anni", "settimana", "ora",
  "ultime", "nuovo", "nuova",
]);

/**
 * Competition/tournament words: they name the CONTEXT, not the story, so two
 * different stories at the same tournament ("Sinner wins Shanghai Masters",
 * "Sinner withdraws from Paris Masters") must not share them, neither as
 * names nor as keywords.
 */
// prettier-ignore
export const COMPETITION_WORDS: ReadonlySet<string> = new Set([
  "masters", "open", "cup", "coppa", "league", "champions", "europa", "conference", "serie", "premier", "liga",
  "laliga", "bundesliga", "ligue", "eredivisie", "grand", "prix", "slam", "tour", "world", "championship",
  "championships", "mondiale", "mondiali", "nations", "super", "supercoppa", "final", "finals", "finale", "atp",
  "wta", "nba", "nfl", "nhl", "mlb", "uefa", "fifa", "fia", "f1", "motogp", "olympics", "olimpiadi", "giro",
  "playoff", "playoffs", "euro", "copa", "fa", "efl", "series", "stadium", "stadio", "arena",
]);

export function isStopword(token: string): boolean {
  return STOPWORDS_EN.has(token) || STOPWORDS_IT.has(token);
}

/** "3-0" style scorelines survive tokenization as one keyword (strong same-match evidence) */
const SCORELINE = /\b(\d{1,2})\s*-\s*(\d{1,2})\b/g;

/** Normalized word tokens (scorelines kept as "3-0"). */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  const scorelines: string[] = [];
  const rest = normalized.replace(SCORELINE, (_m, a: string, b: string) => {
    scorelines.push(`${a}-${b}`);
    return " ";
  });
  return [...rest.split(/[^a-z0-9]+/).filter(Boolean), ...scorelines];
}

/**
 * Light, language-agnostic stemming so "goals/goal", "injuries/injury",
 * "infortunio/infortuni", "squadra/squadre" meet. Not linguistically perfect,
 * only consistent — both sides of a comparison are stemmed the same way.
 */
export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  let t = token;
  if (t.endsWith("ies") && t.length > 4) t = `${t.slice(0, -3)}y`;
  else if (t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  while (t.length > 4 && /[aeio]$/.test(t)) t = t.slice(0, -1);
  return t;
}

/** Distinct stemmed keywords in first-seen order (stopwords, generic and competition words removed). */
export function keywordsOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokenize(text)) {
    const hasDigit = /\d/.test(token);
    if (isStopword(token) || GENERIC_WORDS.has(token) || COMPETITION_WORDS.has(token)) continue;
    if (!hasDigit && token.length < 3) continue;
    if (hasDigit && !token.includes("-") && token.length < 2) continue;
    const k = stem(token);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** particles allowed INSIDE a name ("Kevin De Bruyne", "Real Madrid de …") */
const NAME_PARTICLES: ReadonlySet<string> = new Set(["de", "da", "di", "del", "della", "van", "von", "der", "den", "dos", "do", "le", "la", "el", "al", "bin", "ter"]);

/** Italian elided articles before an apostrophe ("l'Inter" → "Inter") */
const ELIDED = /^(l|d|dell|all|nell|sull|dall|un|quell|sant)'/i;

export type EntityMention = {
  /** normalized key, e.g. "jannik sinner" */
  key: string;
  /** surface form as written, e.g. "Jannik Sinner" */
  display: string;
};

function cleanWord(raw: string): string {
  let w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  w = w.replace(ELIDED, "");
  w = w.replace(/['’]s$/i, "");
  return w;
}

const isCapitalized = (word: string) => /^\p{Lu}/u.test(word);

/**
 * Named entities from capitalized word sequences ("Jannik Sinner", "Real
 * Madrid", "AC Milan"). Sequences break at punctuation, commas, stopwords and
 * generic words. Title-cased headlines ("Bologna Stun Inter In Shock Win")
 * capitalize every word, so there each capitalized word is its own candidate.
 */
export function extractEntities(text: string): EntityMention[] {
  const mentions = new Map<string, EntityMention>();
  const segments = text.split(/[.!?;:|()[\]"“”«»,]|\s[-–—]\s/);

  for (const segment of segments) {
    const words = segment.split(/\s+/).map(cleanWord).filter(Boolean);
    // title case = every word of 4+ letters is capitalized (sentence case leaves verbs/nouns lowercase)
    const long = words.filter((w) => w.length >= 4 && /^\p{L}+$/u.test(w));
    const titleCase = long.length >= 3 && long.every(isCapitalized);

    let current: string[] = [];
    const flush = () => {
      // drop particles at the edges ("de", "la")
      while (current.length && NAME_PARTICLES.has(normalizeText(current[0]))) current.shift();
      while (current.length && NAME_PARTICLES.has(normalizeText(current[current.length - 1]))) current.pop();
      if (current.length) {
        const display = current.join(" ");
        const key = normalizeText(display);
        if (key.replace(/[^a-z0-9]/g, "").length >= 2 && !mentions.has(key)) mentions.set(key, { key, display });
      }
      current = [];
    };

    words.forEach((word, i) => {
      const norm = normalizeText(word);
      const breaks = isStopword(norm) || GENERIC_WORDS.has(norm);
      if (isCapitalized(word) && !breaks) {
        current.push(word);
        if (titleCase) flush();
        return;
      }
      const next = words[i + 1];
      if (!titleCase && current.length && NAME_PARTICLES.has(norm) && next && isCapitalized(next)) {
        current.push(word);
        return;
      }
      flush();
    });
    flush();
  }
  return [...mentions.values()];
}

/** Tokens of entity keys, without particles ("jannik sinner" → jannik, sinner). */
export function entityTermsOf(entities: readonly EntityMention[]): string[] {
  const out = new Set<string>();
  for (const e of entities) {
    for (const t of e.key.split(/[^a-z0-9]+/)) {
      if (t.length >= 2 && !NAME_PARTICLES.has(t) && !isStopword(t) && !COMPETITION_WORDS.has(t)) out.add(t);
    }
  }
  return [...out];
}
