import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../config';
import type { Transcript } from '../../core/timeline';

/**
 * Transcript Correction Agent: fixes misheard words (names, places, dialect, food terms) word by word.
 * Timing never changes — only the text of existing word slots — so captions stay frame-accurate.
 * Uncertain words are left as they are; unintelligible fragments are marked for hiding (empty text).
 */
const Fix = z.object({
  corrections: z.array(z.object({ index: z.number().int(), text: z.string() })),
});

const SYSTEM = `You correct automatic speech recognition output for on-screen captions of short social videos (usually Italian).
You receive numbered words. Return only the words that are clearly misrecognized, with the corrected text for that slot.
Rules:
- Fix split/merged words, wrong proper nouns, places, products, dialect spellings, punctuation and capitalization.
- One slot may receive several words (e.g. "fiordiato" → "fior di latte") or an empty string when the slot is noise or an unintelligible fragment.
- Never add content the speaker did not say; if unsure, leave the word unchanged (omit it).`;

export async function correctTranscript(tr: Transcript, hint: string): Promise<{ transcript: Transcript; changed: number }> {
  if (!config.anthropicKey || !tr.words.length) return { transcript: tr, changed: 0 };
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const numbered = tr.words.map((w, i) => `${i}:${w.text}`).join(' ');
  const res = await client.beta.messages.parse({
    model: config.claudeModel,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(Fix) },
    messages: [{ role: 'user', content: `Context: ${hint}\nLanguage: ${tr.language}\nWords:\n${numbered}` }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) return { transcript: tr, changed: 0 };
  const words = tr.words.map((w) => ({ ...w }));
  let changed = 0;
  for (const c of res.parsed_output.corrections) {
    if (c.index < 0 || c.index >= words.length || words[c.index].text === c.text) continue;
    words[c.index].text = c.text;
    changed++;
  }
  const kept = words.filter((w) => w.text.trim());
  return { transcript: { ...tr, words: kept, text: kept.map((w) => w.text).join(' '), model: `${tr.model} + Claude correction` }, changed };
}
