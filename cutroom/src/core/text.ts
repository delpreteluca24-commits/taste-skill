/** Language helpers for Italian + English creator speech. Conservative by design: a false positive here
 *  cuts or highlights a real word, so lists only contain unambiguous items. */

export function norm(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}€$%']/gu, '')
    .replace(/^'+|'+$/g, '');
}

/** Pure vocal fillers: always safe to remove. */
const VOCAL_FILLERS = new Set(['ehm', 'ehmm', 'emh', 'uhm', 'uhmm', 'umm', 'um', 'uh', 'eh', 'ehh', 'mmm', 'mm', 'hmm', 'ah', 'er', 'erm']);

/** Discourse markers that are filler only at the very start of a sentence. */
const LEADING_MARKERS = new Set(['allora', 'quindi', 'dunque', 'cioe', 'tipo', 'praticamente', 'diciamo', 'insomma', 'so', 'well', 'okay', 'ok', 'like', 'basically', 'senti', 'ecco']);

export function isVocalFiller(w: string): boolean {
  return VOCAL_FILLERS.has(norm(w));
}

export function isLeadingMarker(w: string): boolean {
  return LEADING_MARKERS.has(norm(w));
}

const ALERT_WORDS = new Set([
  'gratis', 'gratuito', 'gratuita', 'errore', 'errori', 'attenzione', 'mai', 'sempre', 'segreto', 'segreti',
  'nuovo', 'nuova', 'migliore', 'peggiore', 'incredibile', 'importante', 'problema', 'soluzione', 'subito',
  'stop', 'vietato', 'unico', 'unica', 'esclusivo', 'esclusiva', 'top', 'perfetto', 'perfetta', 'record',
  'free', 'mistake', 'never', 'always', 'secret', 'best', 'worst', 'warning', 'new', 'only', 'huge', 'problem', 'solution',
]);

const NUMBER_WORDS = new Set([
  'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'venti', 'trenta', 'cinquanta',
  'cento', 'mille', 'milione', 'milioni', 'miliardo', 'miliardi', 'doppio', 'meta',
  'two', 'three', 'four', 'five', 'ten', 'twenty', 'hundred', 'thousand', 'million', 'billion', 'double', 'half',
]);

const CURRENCY = /[€$£]|^(euro|dollari|dollars?|bucks|percento|percent|%)$/i;

export function isNumberLike(w: string): boolean {
  const n = norm(w);
  return /\d/.test(n) || NUMBER_WORDS.has(n) || CURRENCY.test(n);
}

/** Alert words strong enough to deserve an on-screen pop-up on their own ("SEMPRE" alone says nothing). */
const POPUP_WORDS = new Set([
  'gratis', 'gratuito', 'gratuita', 'errore', 'errori', 'attenzione', 'segreto', 'segreti', 'incredibile', 'problema',
  'soluzione', 'vietato', 'record', 'esclusivo', 'esclusiva', 'free', 'mistake', 'secret', 'warning', 'problem', 'solution',
]);
export const isPopupWord = (w: string) => POPUP_WORDS.has(norm(w));

export function isAlertWord(w: string): boolean {
  const n = norm(w);
  return ALERT_WORDS.has(n) || /issim[oaie]$/.test(n);
}

/** Parse "1.000", "10k", "3,5" into a number (for counters). */
export function parseNumber(w: string): number | null {
  const s = w.replace(/[€$£%\s]/g, '');
  const k = /^(\d+(?:[.,]\d+)?)k$/i.exec(s);
  if (k) return parseFloat(k[1].replace(',', '.')) * 1000;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseInt(s.replace(/\./g, ''), 10);
  if (/^\d+(,\d+)?$/.test(s)) return parseFloat(s.replace(',', '.'));
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return null;
}

const CTA_PATTERNS = [
  /\b(seguimi|seguici|iscriviti|iscrivetevi|commenta|commentate|condividi|salva|salvate|link in bio|vi aspett\w*|venite|venitemi|prenota\w*|provat\w*|scrivimi|scriveteci)\b/i,
  /\b(follow|subscribe|comment|share|save this|link in bio|book now|come visit|try it|dm me)\b/i,
];
const HOOK_PATTERNS = [
  /\?$/,
  /\b(ecco|segreto|errore|nessuno|tutti|perch[eé]|come mai|scopri|guarda|attenzione|incredibile|non crederai|il motivo|la verità|mai|primo|prima volta)\b/i,
  /\b(here'?s|secret|mistake|nobody|everyone|why|how to|watch|never|first time|the truth|you won'?t believe)\b/i,
];
const PROBLEM_PATTERNS = [/\b(problema|difficile|sbagli\w*|errore|non funziona|purtroppo|ma)\b/i, /\b(problem|hard|wrong|mistake|doesn'?t work|but)\b/i];
const PAYOFF_PATTERNS = [/\b(risultato|finalmente|ecco|pronta|pronto|pronti|fatto|ce l'abbiamo fatta|ed ecco)\b/i, /\b(result|finally|done|here it is|ready)\b/i];
const CURIOSITY_PATTERNS = [/\b(vediamo|scopriamo|indovina|sai cosa|vuoi sapere|tra poco|alla fine)\b/i, /\b(let'?s see|guess|want to know|stay till|at the end)\b/i];
const INTRO_PATTERNS = [
  /^(ciao|salve|buongiorno|buonasera|hey|ehi)\s+(a tutti|ragazzi|raga|amici|gente|everyone|guys)\b/i,
  /^(benvenut[ie]|bentornat[ie]|welcome( back)?)\b/i,
  /^(oggi|in questo video)\s+(vi|ti)\s+(parlo|mostro|faccio vedere|spiego|racconto)\b/i,
  /^(hi|hey) (guys|everyone|there)\b/i,
  /^in this video\b/i,
];

export const matchesAny = (text: string, patterns: RegExp[]) => patterns.some((p) => p.test(text.trim()));
export const isCtaText = (t: string) => matchesAny(t, CTA_PATTERNS);
export const isHookText = (t: string) => matchesAny(t, HOOK_PATTERNS);
export const isProblemText = (t: string) => matchesAny(t, PROBLEM_PATTERNS);
export const isPayoffText = (t: string) => matchesAny(t, PAYOFF_PATTERNS);
export const isCuriosityText = (t: string) => matchesAny(t, CURIOSITY_PATTERNS);
export const isIntroText = (t: string) => matchesAny(t, INTRO_PATTERNS);

const STOP = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'e', 'ed', 'o',
  'che', 'chi', 'non', 'si', 'ci', 'vi', 'mi', 'ti', 'del', 'della', 'dei', 'delle', 'al', 'alla', 'ai', 'alle', 'nel', 'nella',
  'sul', 'sulla', 'è', 'e', 'sono', 'ho', 'ha', 'hanno', 'abbiamo', 'poi', 'anche', 'come', 'ma', 'se', 'piu', 'molto',
  'nostro', 'nostra', 'questo', 'questa', 'quello', 'quella', 'the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'are', 'it',
  'this', 'that', 'we', 'you', 'i', 'in', 'on', 'for', 'with', 'so', 'just', 'then',
]);

export const isStopWord = (w: string) => STOP.has(norm(w));

/** Short headline from a sentence (≤ maxWords), for title cards / hooks. */
export function headline(text: string, maxWords = 6): string {
  const words = text.replace(/[.!?…]+$/g, '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && (isLeadingMarker(words[i]) || isVocalFiller(words[i]))) i++;
  let out = words.slice(i, i + maxWords);
  while (out.length > 2 && isStopWord(out[out.length - 1])) out = out.slice(0, -1);
  return out.join(' ').replace(/[,;:]+$/g, '').toUpperCase();
}

/** Capitalized mid-sentence word → likely a proper noun / named thing (Whisper capitalizes names). */
export function isProperNounCandidate(word: string, prev: string | undefined): boolean {
  const clean = word.replace(/[^\p{L}'-]/gu, '');
  if (clean.length < 4) return false;
  if (!/^\p{Lu}/u.test(clean)) return false;
  if (!prev) return false;
  return !/[.!?]$/.test(prev);
}
