import type { Op } from './ops';
import type { PresetId, SfxName, Timeline } from './timeline';
import { clamp, round } from './util';
import { clipAt } from './timemap';

export interface ChatContext {
  playhead: number;
  selection?: { start: number; end: number } | null;
}

export type Intent =
  | { kind: 'ops'; ops: Op[]; reply: string }
  | { kind: 'history'; action: 'undo' | 'redo'; reply: string }
  | { kind: 'export'; reply: string }
  | { kind: 'unknown'; reply: string };

const NUM = '(\\d+(?:[.,]\\d+)?|\\d+:\\d{2})';

export function parseTime(s: string): number {
  const m = /^(\d+):(\d{2})$/.exec(s.trim());
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return parseFloat(s.replace(',', '.'));
}

function durationFrom(text: string): number | null {
  const m = new RegExp(`${NUM}\\s*(secondi|second[io]?|sec|s\\b|seconds?|minut[oi]|minutes?|min\\b)`, 'i').exec(text);
  if (!m) return null;
  const v = parseTime(m[1]);
  return /min/i.test(m[2]) ? v * 60 : v;
}

const PRESET_WORDS: [RegExp, PresetId][] = [
  [/premium|elegante|professional/i, 'premium'],
  [/\bviral[ei]?\b/i, 'viral'],
  [/minimal[ei]?|pulit[oa] e semplice/i, 'minimal'],
  [/podcast/i, 'podcast'],
  [/educativ|educational|didattic|tutorial/i, 'educational'],
  [/storytelling|narrativ|racconto/i, 'storytelling'],
  [/cinematic|cinematografic|cinema/i, 'cinematic'],
  [/aggressiv|fast[ -]?paced|frenetic/i, 'fast'],
];

const SFX_WORDS: [RegExp, SfxName][] = [
  [/whoosh|swoosh/i, 'whoosh'], [/\bpop\b/i, 'pop'], [/click/i, 'click'], [/\bhit\b|colpo/i, 'hit'], [/riser/i, 'riser'],
  [/impact|impatto|boom/i, 'impact'], [/swipe/i, 'swipe'], [/notific/i, 'notification'], [/\bding\b|campanell/i, 'ding'],
];

const COLORS: Record<string, string> = { giall: '#FFD43B', yellow: '#FFD43B', verd: '#7CFF6B', green: '#7CFF6B', ross: '#FF4D4D', red: '#FF4D4D', blu: '#60A5FA', blue: '#60A5FA', arancio: '#FF9F1C', orange: '#FF9F1C', bianc: '#FFFFFF', white: '#FFFFFF', rosa: '#FF6EC7', pink: '#FF6EC7' };

const quoted = (text: string) => /["“«'']([^"”»'']{2,60})["”»'']/.exec(text)?.[1]?.trim() ?? null;

/** Strip Italian/English articles/prepositions at the start of a phrase. */
const stripLead = (p: string) => p.replace(/^(?:(?:di|dei|del|della|delle|degli|dello|i|il|la|le|lo|gli|l'|un|una|uno|the|a|an|about|of)\s+)+/i, '').replace(/[.?!]+$/, '').trim();

function graphicText(phrase: string): string {
  const money = /^([\d.,]+)\s*(euro|€)$/i.exec(phrase) ?? /^€\s*([\d.,]+)$/.exec(phrase);
  if (money) return `€${money[1]}`;
  return phrase.toUpperCase();
}

/** Output-time range named in the message ("il minuto iniziale", "da 10 a 20", "la parte finale"). */
function rangeFrom(text: string, duration: number, ctx: ChatContext): { start: number; end: number } | null {
  let m = new RegExp(`(?:da(?:l secondo)?|from)\\s+${NUM}\\s*(?:s|sec|secondi)?\\s+(?:a(?:l)?|to|fino a)\\s+${NUM}`, 'i').exec(text);
  if (m) return { start: parseTime(m[1]), end: parseTime(m[2]) };
  if (/(minuto iniziale|primo minuto|first minute)/i.test(text)) return { start: 0, end: Math.min(60, duration) };
  m = new RegExp(`(?:primi|first)\\s+${NUM}\\s*(secondi|seconds|s|sec)`, 'i').exec(text);
  if (m) return { start: 0, end: Math.min(parseTime(m[1]), duration) };
  if (/(parte finale|finale|the end|ending)/i.test(text)) return { start: round(duration * 0.7), end: duration };
  if (/(inizio|beginning|start)\b/i.test(text)) return { start: 0, end: Math.min(duration, Math.max(10, duration * 0.3)) };
  if (/(questa parte|qui|here|this part|selezione)/i.test(text) && ctx.selection) return ctx.selection;
  return null;
}

/**
 * Rule-based Chat Command Interpreter (IT/EN). Used when no LLM key is configured, and as the safety net
 * when the LLM output does not validate. Every match produces typed ops — never free-form edits.
 */
export function interpret(message: string, t: Timeline, ctx: ChatContext): Intent {
  const text = message.trim();
  const low = text.toLowerCase();
  const d = t.duration;
  const ops: Op[] = [];
  const said: string[] = [];

  if (/^(annulla|undo|torna indietro)\b(?!.*tagli)/i.test(low)) return { kind: 'history', action: 'undo', reply: 'Torno alla versione precedente.' };
  if (/^(ripristina|redo|rifai)\b/i.test(low)) return { kind: 'history', action: 'redo', reply: 'Riapplico la modifica.' };
  if (/^(esporta|export|scarica)\b/i.test(low)) return { kind: 'export', reply: 'Apro l\'export.' };

  // ── cuts ──
  let m = new RegExp(`(?:taglia|togli|elimina|rimuovi|cut|remove|trim)\\s+(?:i\\s+|the\\s+)?(?:primi|first)\\s+${NUM}`, 'i').exec(low);
  if (m) {
    const n = Math.min(parseTime(m[1]), d);
    ops.push({ op: 'remove_range', start: 0, end: n });
    said.push(`taglio i primi ${n}s`);
  }
  m = new RegExp(`(?:taglia|togli|elimina|rimuovi|cut|remove|trim)\\s+(?:gli\\s+|the\\s+)?(?:ultimi|last)\\s+${NUM}`, 'i').exec(low);
  if (m) {
    const n = Math.min(parseTime(m[1]), d);
    ops.push({ op: 'remove_range', start: round(d - n), end: d });
    said.push(`taglio gli ultimi ${n}s`);
  }
  m = new RegExp(`(?:taglia|togli|elimina|rimuovi|cut|remove)\\s+(?:da(?:l secondo)?|from)\\s+${NUM}\\s*(?:s|sec|secondi)?\\s+(?:a(?:l)?|to|fino a)\\s+${NUM}`, 'i').exec(low);
  if (m) {
    const a = parseTime(m[1]); const b = parseTime(m[2]);
    ops.push({ op: 'remove_range', start: Math.min(a, b), end: Math.max(a, b) });
    said.push(`taglio da ${Math.min(a, b)}s a ${Math.max(a, b)}s`);
  }
  if (!ops.length && /(taglia|elimina|togli|rimuovi|cut|remove|delete)\s+(questa parte|questo pezzo|questo|qui|this part|this)/i.test(low)) {
    if (ctx.selection && ctx.selection.end - ctx.selection.start > 0.05) {
      ops.push({ op: 'remove_range', start: ctx.selection.start, end: ctx.selection.end });
      said.push(`taglio la selezione (${ctx.selection.start.toFixed(1)}–${ctx.selection.end.toFixed(1)}s)`);
    } else {
      const c = clipAt(t.clips, ctx.playhead);
      if (c) {
        ops.push({ op: 'delete_elements', ids: [c.id] });
        said.push(`taglio l'inquadratura sotto il cursore (${c.start.toFixed(1)}–${c.end.toFixed(1)}s)`);
      }
    }
  }
  if (/(rimetti|ripristina|restore).*(tagli|parti tagliate|tutto|cuts)/i.test(low) || /annulla i tagli/i.test(low)) {
    ops.push({ op: 'restore_cuts' });
    said.push('ripristino le parti tagliate a mano');
  }

  // ── duration ──
  if (/(massimo|max|al massimo|non più di|meno di|entro|at most|under|durare|dura|lungo)/i.test(low) && !/(zoom|sottotitol)/i.test(low)) {
    const sec = durationFrom(low);
    if (sec && sec >= 5 && !ops.some((o) => o.op === 'remove_range')) {
      ops.push({ op: 'set_max_duration', seconds: sec });
      said.push(`porto il video sotto i ${sec}s tenendo hook, payoff e CTA`);
    }
  }

  // ── style presets ──
  if (/(stile|style|versione|version|preset|modalit|rendi|fai|make|più|more)/i.test(low)) {
    for (const [re, p] of PRESET_WORDS) {
      if (re.test(low) && !(p === 'fast' && /dinamic/i.test(low) && !/aggressiv/i.test(low))) {
        ops.push({ op: 'apply_preset', preset: p });
        said.push(`applico lo stile ${p.toUpperCase()}`);
        break;
      }
    }
  }

  // ── effects / sfx / graphics / zoom amounts ──
  const sfxWord = /(sfx|effetti sonori|suoni|sound effects?)/i;
  if (sfxWord.test(low)) {
    if (/(togli|rimuovi|senza|niente|\bno\b|elimina|remove)/i.test(low)) { ops.push({ op: 'sfx_amount', direction: 'none' }); said.push('tolgo gli SFX'); }
    else if (/(meno|riduci|less|fewer|pochi)/i.test(low)) { ops.push({ op: 'sfx_amount', direction: 'less' }); said.push('uso meno SFX'); }
    else if (/(più|aggiungi|more|add)/i.test(low) && !SFX_WORDS.some(([re]) => re.test(low))) { ops.push({ op: 'sfx_amount', direction: 'more' }); said.push('aggiungo SFX'); }
  } else if (/(togli|rimuovi|elimina|leva|remove|senza|no)\s+(tutti\s+)?(gli\s+)?(effetti|effects)/i.test(low)) {
    ops.push({ op: 'remove_effects' });
    said.push('tolgo zoom, grafiche, transizioni ed SFX (restano tagli e sottotitoli)');
  }
  const zoomHere = /(zoom)\s*(qui|here|in questo punto|adesso)/i.test(low) || /(qui|here).*zoom/i.test(low);
  if (zoomHere) {
    ops.push({ op: 'add_zoom', start: round(ctx.playhead), end: round(Math.min(d, ctx.playhead + 1.5)), scale: t.settings.emphasisZoom });
    said.push(`aggiungo un punch-in a ${ctx.playhead.toFixed(1)}s`);
  } else if (/zoom/i.test(low)) {
    if (/(togli|rimuovi|senza|niente|\bno)\s*(gli\s+|lo\s+)?zoom/i.test(low)) { ops.push({ op: 'update_settings', patch: { zoomDensity: 0, pushIn: false } }); said.push('tolgo gli zoom'); }
    else if (/(meno|riduci|less)/i.test(low)) { ops.push({ op: 'zoom_amount', direction: 'less' }); said.push('riduco gli zoom'); }
    else if (/(più|aggiungi|metti|more|add)/i.test(low)) { ops.push({ op: 'zoom_amount', direction: 'more' }); said.push('aumento gli zoom'); }
  }

  // ── graphics on a phrase / CTA ──
  const gm = /(?:metti|aggiungi|inserisci|mostra|add|put|show)\s+(?:una?\s+|la\s+|il\s+)?(grafica|scritta|testo|popup|pop-up|titolo|graphic|title|text|lower third|sottopancia|callout|contatore|counter)(?:\s+a\s+schermo\s+intero|\s+full ?screen)?(.*)$/i.exec(text);
  if (gm && !/\bcta\b|call to action/i.test(low)) {
    const rest = gm[2];
    const kind = /schermo intero|full ?screen/i.test(text) ? 'fullscreen' : /lower third|sottopancia/i.test(gm[1]) ? 'lowerThird' : /contatore|counter/i.test(gm[1]) ? 'counter' : /titolo|title/i.test(gm[1]) ? 'title' : 'keyword';
    const phraseM = /(?:quando\s+(?:parlo|dico|nomino|si parla|parla)\s*(?:di|dei|del|della|delle|degli)?|su|sul|sulla|on|when i (?:say|mention|talk about))\s+(.+)$/i.exec(rest);
    const atM = new RegExp(`(?:a|al secondo|at)\\s+${NUM}\\s*(?:s|sec|secondi)?`, 'i').exec(rest);
    const q = quoted(text);
    const phrase = phraseM ? stripLead(phraseM[1].replace(/["“”«»]/g, '')) : null;
    const label = q ?? (phrase ? graphicText(phrase) : null);
    if (label) {
      const at = atM ? parseTime(atM[1]) : /(qui|here|adesso)/i.test(rest) ? ctx.playhead : undefined;
      ops.push({ op: 'add_graphic', kind, text: label.slice(0, 80), match: phrase ?? undefined, at: at !== undefined ? clamp(at, 0, d) : phrase ? undefined : ctx.playhead });
      said.push(phrase ? `aggiungo una grafica "${label}" quando dici "${phrase}"` : `aggiungo una grafica "${label}"`);
    }
  }
  if (/\bcta\b|call to action|invito all'azione/i.test(low) && /(metti|aggiungi|inserisci|add|finale|alla fine|cambia)/i.test(low)) {
    const txt = quoted(text) ?? (/(follow|subscribe|english)/i.test(low) ? 'FOLLOW FOR MORE' : 'SEGUIMI PER ALTRI VIDEO');
    ops.push({ op: 'add_cta', text: txt.toUpperCase().slice(0, 60) });
    said.push(`aggiungo la CTA finale "${txt.toUpperCase()}"`);
  }
  if (/(più|more)\s+grafiche|more graphics/i.test(low)) { ops.push({ op: 'graphics_amount', direction: 'more' }); said.push('aumento le grafiche'); }
  else if (/(meno|less)\s+grafiche|fewer graphics/i.test(low)) { ops.push({ op: 'graphics_amount', direction: 'less' }); said.push('riduco le grafiche'); }
  else if (/(togli|senza|rimuovi)\s+(le\s+)?grafiche/i.test(low)) { ops.push({ op: 'graphics_amount', direction: 'none' }); said.push('tolgo le grafiche'); }

  // ── sfx at a point ──
  if (/(aggiungi|metti|inserisci|add)/i.test(low)) {
    const sfx = SFX_WORDS.find(([re]) => re.test(low));
    if (sfx) {
      const atM = new RegExp(`(?:a|al secondo|at)\\s+${NUM}`, 'i').exec(low);
      const at = atM ? parseTime(atM[1]) : ctx.playhead;
      ops.push({ op: 'add_sfx', name: sfx[1], at: clamp(at, 0, d) });
      said.push(`aggiungo un ${sfx[1]} a ${at.toFixed(1)}s`);
    }
  }

  // ── captions ──
  if (/(sottotitol|caption|subtitle|scritte)/i.test(low)) {
    const cs = t.settings.captions;
    if (/(togli|rimuovi|senza|disattiva|nascondi|remove|hide)/i.test(low)) { ops.push({ op: 'update_captions', patch: { enabled: false } }); said.push('nascondo i sottotitoli'); }
    else if (/(rimetti|attiva|mostra|show|enable)/i.test(low)) { ops.push({ op: 'update_captions', patch: { enabled: true } }); said.push('riattivo i sottotitoli'); }
    if (/(più grand|grandi|bigger|larger|ingrandisci)/i.test(low)) { ops.push({ op: 'update_captions', patch: { fontSize: Math.round(clamp(cs.fontSize * 1.18, 40, 124)) } }); said.push('ingrandisco i sottotitoli'); }
    if (/(più piccol|piccoli|smaller|rimpicciolisci)/i.test(low)) { ops.push({ op: 'update_captions', patch: { fontSize: Math.round(clamp(cs.fontSize * 0.85, 40, 124)) } }); said.push('rimpicciolisco i sottotitoli'); }
    if (/(in alto|sopra|top)\b/i.test(low)) { ops.push({ op: 'update_captions', patch: { position: 0.3 } }); said.push('sposto i sottotitoli in alto'); }
    else if (/(al centro|centrat|center|middle)/i.test(low)) { ops.push({ op: 'update_captions', patch: { position: 0.52 } }); said.push('centro i sottotitoli'); }
    else if (/(in basso|sotto|bottom)\b/i.test(low)) { ops.push({ op: 'update_captions', patch: { position: 0.74 } }); said.push('sposto i sottotitoli in basso'); }
    if (/minuscol|lowercase/i.test(low)) ops.push({ op: 'update_captions', patch: { uppercase: false } });
    if (/maiuscol|uppercase|caps/i.test(low)) ops.push({ op: 'update_captions', patch: { uppercase: true } });
    const color = Object.entries(COLORS).find(([k]) => new RegExp(k, 'i').test(low));
    if (color && /(evidenz|highlight|colore|color)/i.test(low)) { ops.push({ op: 'update_captions', patch: { highlightColor: color[1] } }); said.push('cambio il colore di evidenziazione'); }
    for (const st of ['boxed', 'karaoke', 'minimal', 'clean', 'bold'] as const) {
      if (new RegExp(`\\b${st}\\b`, 'i').test(low)) { ops.push({ op: 'update_captions', patch: { style: st } }); said.push(`stile sottotitoli ${st}`); break; }
    }
    const words = /(\d)\s*parol/i.exec(low);
    if (words) { const n = clamp(parseInt(words[1], 10), 1, 6); ops.push({ op: 'update_captions', patch: { maxWords: n, minWords: Math.min(cs.minWords, n) } }); said.push(`massimo ${n} parole per sottotitolo`); }
  }

  // ── hook / intro / pacing ──
  if (/(hook|apertura|attacco|inizio).*(forte|potente|incisiv|migliore|stronger|better|punchier)|(migliora|rafforza|improve).*(hook|apertura)/i.test(low)) {
    ops.push({ op: 'strengthen_hook' });
    said.push(t.settings.coldOpen ? 'provo un altro momento forte come hook' : 'apro con il momento più forte (cold open) e tolgo l\'intro');
  }
  if (/(togli|rimuovi|taglia|elimina)\s+(l')?(intro|introduzione|saluti)/i.test(low)) {
    ops.push({ op: 'update_settings', patch: { removeIntro: true } });
    said.push('tolgo l\'intro');
  }
  const faster = /(più|piu|more|molto più)\s+(dinamic|veloce|ritmat|energic|serrat|incalzant|fast|dynamic|punchy|snappy)|accelera|velocizza|speed up/i.test(low);
  const slower = /(più|more)\s+(lent|calm|rilassat|tranquill|slow|calm)|meno (frenetic|veloce)|rallenta|slow down/i.test(low);
  if ((faster || slower) && !ops.some((o) => o.op === 'apply_preset')) {
    const range = rangeFrom(low, d, ctx);
    const intensity = /(molto|very|much|tanto|super)/i.test(low) ? 'high' : 'medium';
    ops.push({ op: 'pacing', direction: faster ? 'faster' : 'slower', intensity, range: range ?? undefined });
    said.push(`${faster ? 'aumento' : 'rallento'} il ritmo${range ? ` tra ${range.start.toFixed(0)}s e ${range.end.toFixed(0)}s` : ''}`);
  }

  // ── music ──
  if (/(musica|music)/i.test(low)) {
    const v = t.settings.musicVolume;
    if (/(alza|più alta|louder|aumenta)/i.test(low)) { ops.push({ op: 'update_settings', patch: { musicVolume: round(clamp(v * 1.3, 0.05, 0.35), 2) } }); said.push('alzo un po\' la musica (resta sotto la voce)'); }
    if (/(abbassa|più bassa|quieter|riduci)/i.test(low)) { ops.push({ op: 'update_settings', patch: { musicVolume: round(clamp(v * 0.7, 0.03, 0.35), 2) } }); said.push('abbasso la musica'); }
  }

  // ── variation ──
  if (/(un'altra versione|altra versione|another version|rigenera|regenerate|prova un'altra)/i.test(low) && !ops.length) {
    ops.push({ op: 'variation' });
    said.push('preparo una variante');
  }

  if (!ops.length) {
    return {
      kind: 'unknown',
      reply:
        'Non ho capito la modifica. Esempi: "Taglia i primi 5 secondi", "Rendi il video più dinamico", "Fai i sottotitoli più grandi", "Metti una grafica quando parlo dei 1.000 euro", "Fai durare il video massimo 30 secondi", "Rendi l\'hook più forte", "Usa meno SFX", "Metti una CTA finale".',
    };
  }
  const reply = said.length ? said[0].charAt(0).toUpperCase() + said.join(', ').slice(1) + '.' : 'Applico la modifica.';
  return { kind: 'ops', ops, reply };
}
