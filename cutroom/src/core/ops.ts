import { z } from 'zod';
import { CaptionSettings, EditSettings, GraphicKind, PresetId, SfxName } from './timeline';

const LayerName = z.enum(['clips', 'zoom', 'subtitles', 'graphics', 'transitions', 'audio', 'music', 'effects']);
const Range = z.object({ start: z.number().min(0), end: z.number().min(0) });

/** Partial patch WITHOUT defaults: zod 4's `.partial()` still fills defaulted keys, which would silently reset untouched settings. */
function patchOf<T extends z.ZodObject>(o: T) {
  const shape = Object.fromEntries(Object.entries(o.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.unwrap() : v).optional()]));
  return z.object(shape) as unknown as ReturnType<T['partial']>;
}

/** TIMELINE_OPERATION — the only way anything (UI, chat rules, LLM) changes a timeline. */
export const Op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('apply_preset'), preset: PresetId }),
  z.object({ op: z.literal('update_settings'), patch: patchOf(EditSettings.omit({ captions: true })) }),
  z.object({ op: z.literal('update_captions'), patch: patchOf(CaptionSettings) }),
  /** Remove an output-time range (e.g. "taglia i primi 5 secondi"). */
  z.object({ op: z.literal('remove_range'), ...Range.shape }),
  z.object({ op: z.literal('restore_cuts') }),
  z.object({ op: z.literal('set_max_duration'), seconds: z.number().positive().nullable() }),
  /** Land the edit inside [min, max] seconds (shortens with the story budget, lengthens by keeping more breath/B-roll). */
  z.object({ op: z.literal('set_duration_range'), min: z.number().positive(), max: z.number().positive() }),
  /** Narrative sections in upload order: first clip = intro, middle = body, last = ending; chapter labels on screen. */
  z.object({ op: z.literal('structure_sections'), labels: z.array(z.string().min(1).max(30)).min(2).max(4) }),
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
    /** photo graphics: which uploaded image (default: the latest one). */
    mediaId: z.string().optional(),
    /** Pin to a source range instead of a phrase/time (e.g. an ingredient tag). */
    src: z.object({ mediaId: z.string(), start: z.number(), end: z.number() }).optional(),
  }),
  /** Keep ONLY these source ranges of a clip (null clears). */
  z.object({ op: z.literal('set_selects'), mediaId: z.string(), ranges: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) })).nullable() }),
  /** Force a source range into the edit (also removes manual cuts over it). */
  /** Cut a source range (e.g. a filler like "vabbè" at an exact instant). */
  z.object({ op: z.literal('cut_source'), mediaId: z.string(), start: z.number().min(0), end: z.number().min(0) }),
  z.object({ op: z.literal('keep_source'), mediaId: z.string(), start: z.number().min(0), end: z.number().min(0) }),
  z.object({ op: z.literal('add_insert'), mediaId: z.string(), srcStart: z.number().min(0), srcEnd: z.number().min(0), afterMediaId: z.string(), afterSrc: z.number().min(0) }),
  /** Camera move to a point of the frame during a source range (e.g. zoom on the plate). */
  /** Remove gag inserts (all, or those of one clip). */
  z.object({ op: z.literal('remove_inserts'), mediaId: z.string().optional() }),
  z.object({ op: z.literal('add_source_zoom'), mediaId: z.string(), srcStart: z.number().min(0), srcEnd: z.number().min(0), scale: z.number().min(1).max(1.8), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  /** Channel slogan / signature intro (null to remove). */
  z.object({ op: z.literal('set_slogan'), text: z.string().min(1).max(40).nullable() }),
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
