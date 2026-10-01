import { z } from 'zod';
import { CaptionSettings, EditSettings, GraphicKind, PresetId, SfxName } from './timeline';

const LayerName = z.enum(['clips', 'zoom', 'subtitles', 'graphics', 'transitions', 'audio', 'music', 'effects']);
const Range = z.object({ start: z.number().min(0), end: z.number().min(0) });

/** TIMELINE_OPERATION — the only way anything (UI, chat rules, LLM) changes a timeline. */
export const Op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('apply_preset'), preset: PresetId }),
  z.object({ op: z.literal('update_settings'), patch: EditSettings.omit({ captions: true }).partial() }),
  z.object({ op: z.literal('update_captions'), patch: CaptionSettings.partial() }),
  /** Remove an output-time range (e.g. "taglia i primi 5 secondi"). */
  z.object({ op: z.literal('remove_range'), ...Range.shape }),
  z.object({ op: z.literal('restore_cuts') }),
  z.object({ op: z.literal('set_max_duration'), seconds: z.number().positive().nullable() }),
  /** Pacing: global (no range) changes settings; with a range it tightens pauses + adds camera moves there only. */
  z.object({ op: z.literal('pacing'), direction: z.enum(['faster', 'slower']), intensity: z.enum(['low', 'medium', 'high']).default('medium'), range: Range.optional() }),
  z.object({ op: z.literal('zoom_amount'), direction: z.enum(['more', 'less']) }),
  z.object({ op: z.literal('sfx_amount'), direction: z.enum(['more', 'less', 'none']) }),
  z.object({ op: z.literal('graphics_amount'), direction: z.enum(['more', 'less', 'none']) }),
  z.object({ op: z.literal('remove_effects') }),
  z.object({
    op: z.literal('add_graphic'),
    kind: GraphicKind,
    text: z.string().min(1).max(80),
    /** Spoken words to attach the graphic to (e.g. "1000 euro"). */
    match: z.string().optional(),
    at: z.number().min(0).optional(),
    duration: z.number().positive().max(10).optional(),
  }),
  z.object({ op: z.literal('add_cta'), text: z.string().min(1).max(60) }),
  z.object({ op: z.literal('add_sfx'), name: SfxName, at: z.number().min(0) }),
  z.object({ op: z.literal('add_zoom'), start: z.number().min(0), end: z.number().min(0), scale: z.number().min(1).max(1.6) }),
  z.object({ op: z.literal('strengthen_hook') }),
  z.object({ op: z.literal('set_word_text'), wordId: z.string(), text: z.string().max(40) }),
  z.object({ op: z.literal('update_element'), id: z.string(), patch: z.object({ start: z.number().optional(), end: z.number().optional(), properties: z.record(z.string(), z.unknown()).optional() }) }),
  z.object({ op: z.literal('delete_elements'), ids: z.array(z.string()).min(1) }),
  z.object({ op: z.literal('regenerate'), layers: z.array(LayerName).min(1) }),
  z.object({ op: z.literal('variation') }),
]);
export type Op = z.infer<typeof Op>;
export const OpList = z.array(Op).min(1).max(12);
