import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../config';
import { GraphicKind, PresetId, SfxName, type Timeline } from '../../core/timeline';
import { Op, OpList } from '../../core/ops';
import type { ChatContext, Intent } from '../../core/interpreter';

/**
 * Chat Editing Agent (LLM path). Claude only maps the request to typed timeline operations; the deterministic
 * engine applies them. Flat schema with nullable fields → valid for structured outputs; mapped to `Op` and
 * re-validated with zod before anything touches the timeline.
 */
const LlmOp = z.object({
  op: z.enum(['apply_preset', 'remove_range', 'restore_cuts', 'set_max_duration', 'pacing', 'zoom_amount', 'sfx_amount', 'graphics_amount',
    'remove_effects', 'add_graphic', 'add_cta', 'add_sfx', 'add_zoom', 'strengthen_hook', 'update_captions', 'update_settings', 'variation']),
  preset: PresetId.nullable(),
  start: z.number().nullable(),
  end: z.number().nullable(),
  seconds: z.number().nullable(),
  direction: z.enum(['faster', 'slower', 'more', 'less', 'none']).nullable(),
  intensity: z.enum(['low', 'medium', 'high']).nullable(),
  graphic_kind: GraphicKind.nullable(),
  text: z.string().nullable(),
  match: z.string().nullable(),
  at: z.number().nullable(),
  sfx: SfxName.nullable(),
  scale: z.number().nullable(),
  caption_font_size: z.number().nullable(),
  caption_position: z.number().nullable(),
  caption_style: z.enum(['bold', 'clean', 'boxed', 'karaoke', 'minimal']).nullable(),
  caption_uppercase: z.boolean().nullable(),
  caption_enabled: z.boolean().nullable(),
  caption_max_words: z.number().nullable(),
  caption_highlight_color: z.string().nullable(),
  music_volume: z.number().nullable(),
  remove_intro: z.boolean().nullable(),
});
const LlmPlan = z.object({
  intent: z.enum(['edit', 'undo', 'redo', 'export', 'unclear']),
  reply: z.string(),
  ops: z.array(LlmOp),
});
type LlmOp = z.infer<typeof LlmOp>;

const SYSTEM = `You are the Chat Editing Agent of Cutroom, an AI editor for vertical (9:16) social videos.
You never edit the video yourself: you translate the user's request into a short list of timeline operations
that a deterministic engine applies. Reply in the user's language (usually Italian), in one short sentence that
says what you will change. Times are OUTPUT seconds of the current edit.

Operations (fill only the fields an operation uses, set the others to null):
- apply_preset {preset}: viral | premium | minimal | podcast | educational | storytelling | fast | cinematic. "più aggressivo" → fast.
- remove_range {start,end}: cut part of the current edit. "this part" → use the selection, else the playhead shot.
- restore_cuts: undo all manual cuts.
- set_max_duration {seconds}: shorten to a maximum length keeping hook, payoff and CTA.
- pacing {direction faster|slower, intensity, start/end optional}: rhythm, globally or on a range.
- zoom_amount / sfx_amount / graphics_amount {direction more|less|none}.
- remove_effects: drop zooms, graphics, transitions and SFX (cuts and captions stay).
- add_graphic {graphic_kind, text, match?, at?}: match = the spoken words to attach to (e.g. "1.000 euro"); text = what to show ("€1.000").
- add_cta {text}: final call to action.
- add_sfx {sfx, at}; add_zoom {start, end, scale 1.05-1.25}.
- strengthen_hook: open with the strongest moment (cold open) and remove the intro.
- update_captions {caption_*}: font size in px at 1080 width (default ~78), position 0..1 from top (safe 0.25-0.8).
- update_settings {music_volume 0-0.35, remove_intro}.
- variation: a different take of the same edit.
Use intent undo/redo/export when the user asks for that, unclear when nothing maps (ask one short question in reply).
Never invent words the speaker did not say. Prefer the fewest operations that achieve the request.`;

function toOp(o: LlmOp): Op | null {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v);
  switch (o.op) {
    case 'apply_preset': return o.preset ? { op: o.op, preset: o.preset } : null;
    case 'remove_range': return o.start !== null && o.end !== null ? { op: o.op, start: Math.min(o.start, o.end), end: Math.max(o.start, o.end) } : null;
    case 'restore_cuts': case 'remove_effects': case 'strengthen_hook': case 'variation': return { op: o.op };
    case 'set_max_duration': return { op: o.op, seconds: o.seconds ?? null };
    case 'pacing': return { op: o.op, direction: o.direction === 'slower' ? 'slower' : 'faster', intensity: o.intensity ?? 'medium', range: o.start !== null && o.end !== null ? { start: o.start, end: o.end } : undefined };
    case 'zoom_amount': return { op: o.op, direction: o.direction === 'less' || o.direction === 'none' ? 'less' : 'more' };
    case 'sfx_amount': case 'graphics_amount': return { op: o.op, direction: o.direction === 'less' ? 'less' : o.direction === 'none' ? 'none' : 'more' };
    case 'add_graphic': return o.text ? { op: o.op, kind: o.graphic_kind ?? 'keyword', text: o.text, match: o.match ?? undefined, at: n(o.at) } : null;
    case 'add_cta': return o.text ? { op: o.op, text: o.text } : null;
    case 'add_sfx': return o.sfx && o.at !== null ? { op: o.op, name: o.sfx, at: o.at } : null;
    case 'add_zoom': return o.start !== null && o.end !== null ? { op: o.op, start: o.start, end: o.end, scale: Math.min(1.25, Math.max(1.03, o.scale ?? 1.15)) } : null;
    case 'update_captions': {
      const patch: Record<string, unknown> = {};
      if (o.caption_font_size !== null) patch.fontSize = Math.min(124, Math.max(40, o.caption_font_size));
      if (o.caption_position !== null) patch.position = Math.min(0.8, Math.max(0.15, o.caption_position));
      if (o.caption_style !== null) patch.style = o.caption_style;
      if (o.caption_uppercase !== null) patch.uppercase = o.caption_uppercase;
      if (o.caption_enabled !== null) patch.enabled = o.caption_enabled;
      if (o.caption_max_words !== null) patch.maxWords = Math.min(6, Math.max(1, Math.round(o.caption_max_words)));
      if (o.caption_highlight_color !== null && /^#[0-9a-f]{6}$/i.test(o.caption_highlight_color)) patch.highlightColor = o.caption_highlight_color;
      return Object.keys(patch).length ? ({ op: 'update_captions', patch } as Op) : null;
    }
    case 'update_settings': {
      const patch: Record<string, unknown> = {};
      if (o.music_volume !== null) patch.musicVolume = Math.min(0.35, Math.max(0, o.music_volume));
      if (o.remove_intro !== null) patch.removeIntro = o.remove_intro;
      return Object.keys(patch).length ? ({ op: 'update_settings', patch } as Op) : null;
    }
  }
  return null;
}

let client: Anthropic | null = null;
export const llmEnabled = () => !!config.anthropicKey;

export async function interpretWithClaude(message: string, t: Timeline, ctx: ChatContext): Promise<Intent> {
  client ??= new Anthropic({ apiKey: config.anthropicKey! });
  const transcript = t.subtitles.map((s) => `[${s.start.toFixed(1)}] ${s.properties.words.map((w) => w.text).join(' ')}`).join('\n');
  const state = {
    duration: t.duration,
    preset: t.settings.preset,
    captions: { fontSize: t.settings.captions.fontSize, position: t.settings.captions.position, style: t.settings.captions.style },
    graphics: t.graphics.map((g) => ({ kind: g.properties.kind, text: g.properties.text, at: g.start })),
    zooms: t.zoom.length, sfx: t.audio.length, playhead: ctx.playhead, selection: ctx.selection ?? null,
  };
  const response = await client.beta.messages.parse({
    model: config.claudeModel,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: betaZodOutputFormat(LlmPlan) },
    messages: [{ role: 'user', content: `Current edit:\n${JSON.stringify(state)}\n\nCaptions of the current edit (output seconds):\n${transcript}\n\nUser request: ${message}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined the request');
  const plan = response.parsed_output;
  if (!plan) throw new Error('Claude output did not match the schema');
  if (plan.intent === 'undo' || plan.intent === 'redo') return { kind: 'history', action: plan.intent, reply: plan.reply };
  if (plan.intent === 'export') return { kind: 'export', reply: plan.reply };
  const ops = plan.ops.map(toOp).filter((o): o is Op => o !== null);
  if (plan.intent === 'unclear' || !ops.length) return { kind: 'unknown', reply: plan.reply };
  return { kind: 'ops', ops: OpList.parse(ops), reply: plan.reply };
}
