import { z } from 'zod';

// ───────────────────────── Media & analysis ─────────────────────────

export const Range = z.object({ start: z.number(), end: z.number() });
export type Range = z.infer<typeof Range>;

export const WordFlag = z.enum(['filler', 'hallucination', 'repeat', 'false_start', 'intro', 'emphasis']);
export type WordFlag = z.infer<typeof WordFlag>;

export const Word = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  flags: z.array(WordFlag).default([]),
});
export type Word = z.infer<typeof Word>;

export const Transcript = z.object({
  language: z.string(),
  model: z.string(),
  text: z.string(),
  words: z.array(Word),
});
export type Transcript = z.infer<typeof Transcript>;

export const FaceBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), score: z.number() });
export type FaceBox = z.infer<typeof FaceBox>;

/** Everything measured on one source file (server side). Coordinates are normalized 0..1. */
export const RawAnalysis = z.object({
  duration: z.number(),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  hasAudio: z.boolean(),
  loudness: z.object({ integrated: z.number(), truePeak: z.number(), lra: z.number() }),
  silences: z.array(Range),
  scenes: z.array(z.number()),
  black: z.array(Range),
  freeze: z.array(Range),
  /** Visual activity per sample (0..1), sampled at `sampleFps`. */
  motion: z.array(z.number()),
  /** Audio energy per sample (0..1), sampled at `sampleFps`. */
  energy: z.array(z.number()),
  sampleFps: z.number(),
  faces: z.array(z.object({ t: z.number(), boxes: z.array(FaceBox) })),
  transcript: Transcript.nullable(),
});
export type RawAnalysis = z.infer<typeof RawAnalysis>;

export const SentenceRole = z.enum(['hook', 'context', 'problem', 'curiosity', 'payoff', 'cta', 'body']);
export type SentenceRole = z.infer<typeof SentenceRole>;

export const Sentence = z.object({
  id: z.string(),
  mediaId: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  wordIds: z.array(z.string()),
  role: SentenceRole,
  /** 0..1 importance used by the duration/hook logic. */
  score: z.number(),
  hookScore: z.number(),
});
export type Sentence = z.infer<typeof Sentence>;

/** VIDEO_ANALYSIS: raw measurements + semantic layer. */
export const VideoAnalysis = z.object({
  mediaId: z.string(),
  filename: z.string(),
  raw: RawAnalysis,
  orientation: z.enum(['portrait', 'landscape', 'square']),
  kind: z.enum(['aroll', 'broll']),
  speechRatio: z.number(),
  sentences: z.array(Sentence),
  fillerWordIds: z.array(z.string()),
  importantSentenceIds: z.array(z.string()),
  emotionalPeaks: z.array(z.number()),
  visualChanges: z.array(z.number()),
  recommendedCuts: z.array(z.object({ start: z.number(), end: z.number(), reason: z.string() })),
  recommendedZoomPoints: z.array(z.object({ t: z.number(), reason: z.string() })),
  recommendedGraphics: z.array(z.object({ t: z.number(), text: z.string(), reason: z.string() })),
  recommendedSfx: z.array(z.object({ t: z.number(), name: z.string(), reason: z.string() })),
  hookScore: z.number(),
  retentionScore: z.number(),
  clarityScore: z.number(),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

export const MediaAsset = z.object({
  id: z.string(),
  filename: z.string(),
  kind: z.enum(['video', 'audio']),
  position: z.number(),
  size: z.number(),
  status: z.enum(['uploaded', 'processing', 'ready', 'error']),
  error: z.string().optional(),
  duration: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;

// ───────────────────────── Settings (presets) ─────────────────────────

export const PresetId = z.enum(['viral', 'premium', 'minimal', 'podcast', 'educational', 'storytelling', 'fast', 'cinematic']);
export type PresetId = z.infer<typeof PresetId>;

export const CaptionSettings = z.object({
  enabled: z.boolean(),
  style: z.enum(['bold', 'clean', 'boxed', 'karaoke', 'minimal']),
  minWords: z.number().int().min(1),
  maxWords: z.number().int().min(1),
  fontSize: z.number(),
  /** Vertical center of the caption block, 0 (top) .. 1 (bottom). */
  position: z.number(),
  uppercase: z.boolean(),
  color: z.string(),
  highlightColor: z.string(),
  animation: z.enum(['pop', 'fade', 'slide', 'none']),
  emphasis: z.boolean(),
});
export type CaptionSettings = z.infer<typeof CaptionSettings>;

export const EditSettings = z.object({
  preset: PresetId,
  /** Longest pause kept between words (s). Shorter = faster pacing. */
  maxPause: z.number(),
  padBefore: z.number(),
  padAfter: z.number(),
  /** Extra breath kept before emphasized words / punchlines (s). */
  emphasisPause: z.number(),
  removeFillers: z.boolean(),
  removeIntro: z.boolean(),
  removeFalseStarts: z.boolean(),
  coldOpen: z.boolean(),
  brollShot: z.number(),
  brollMaxTotal: z.number(),
  minShot: z.number(),
  /** 0..1 probability-like density for camera moves. */
  zoomDensity: z.number(),
  jumpcutZoom: z.number(),
  emphasisZoom: z.number(),
  pushIn: z.boolean(),
  graphicsDensity: z.number(),
  sfxDensity: z.number(),
  sfxVolume: z.number(),
  transitionStyle: z.enum(['cut', 'subtle', 'dynamic']),
  musicVolume: z.number(),
  duckVolume: z.number(),
  maxDuration: z.number().nullable(),
  titleCard: z.boolean(),
  progressBar: z.boolean(),
  ctaText: z.string().nullable(),
  grade: z.enum(['none', 'clean', 'punchy', 'cinematic']),
  accent: z.string(),
  captions: CaptionSettings,
  seed: z.number().int(),
});
export type EditSettings = z.infer<typeof EditSettings>;

// ───────────────────────── Timeline elements ─────────────────────────

export const Anchor = z.object({ mediaId: z.string(), srcStart: z.number(), srcEnd: z.number() });
export type Anchor = z.infer<typeof Anchor>;

const base = {
  id: z.string(),
  /** Output time in seconds. */
  start: z.number(),
  end: z.number(),
  layer: z.number().int(),
  /** Why the element exists — shown in the UI. Every decision must have one. */
  reason: z.string(),
  /** Source anchor: anchored elements follow their words when cuts change. */
  anchor: Anchor.optional(),
  /** Created/edited by the user: never removed by automatic regeneration. */
  locked: z.boolean().optional(),
};

export const Crop = z.object({
  /** Normalized center of the 9:16 window inside the source frame. */
  x: z.number(),
  y: z.number(),
  mode: z.enum(['face', 'saliency', 'center', 'manual']),
});
export type Crop = z.infer<typeof Crop>;

export const ClipItem = z.object({
  ...base,
  type: z.literal('clip'),
  source: z.string(),
  properties: z.object({
    srcStart: z.number(),
    srcEnd: z.number(),
    speed: z.number(),
    volume: z.number(),
    role: z.enum(['aroll', 'broll', 'hook']),
    crop: Crop,
  }),
});
export type ClipItem = z.infer<typeof ClipItem>;

export const CutKind = z.enum(['silence', 'filler', 'repeat', 'false_start', 'intro', 'hallucination', 'broll_trim', 'duration', 'black', 'user']);
export type CutKind = z.infer<typeof CutKind>;

/** Removed source ranges (start/end are SOURCE seconds). */
export const CutItem = z.object({
  id: z.string(),
  type: z.literal('cut'),
  source: z.string(),
  start: z.number(),
  end: z.number(),
  kind: CutKind,
  reason: z.string(),
});
export type CutItem = z.infer<typeof CutItem>;

export const SubtitleWord = z.object({ id: z.string(), text: z.string(), start: z.number(), end: z.number(), emphasis: z.boolean() });
export type SubtitleWord = z.infer<typeof SubtitleWord>;

export const SubtitleItem = z.object({
  ...base,
  type: z.literal('subtitle'),
  source: z.string(),
  properties: z.object({ words: z.array(SubtitleWord) }),
});
export type SubtitleItem = z.infer<typeof SubtitleItem>;

export const GraphicKind = z.enum(['keyword', 'counter', 'title', 'cta', 'lowerThird', 'callout', 'progress', 'fullscreen', 'icon', 'label']);
export type GraphicKind = z.infer<typeof GraphicKind>;

export const GraphicItem = z.object({
  ...base,
  type: z.literal('graphic'),
  properties: z.object({
    kind: GraphicKind,
    text: z.string(),
    subtext: z.string().optional(),
    value: z.number().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    icon: z.string().optional(),
    position: z.enum(['top', 'center', 'bottom']),
  }),
});
export type GraphicItem = z.infer<typeof GraphicItem>;

export const TransitionKind = z.enum(['whip', 'zoom', 'flash', 'blur', 'swipe']);
export const TransitionItem = z.object({
  ...base,
  type: z.literal('transition'),
  properties: z.object({ kind: TransitionKind, at: z.number() }),
});
export type TransitionItem = z.infer<typeof TransitionItem>;

export const SfxName = z.enum(['whoosh', 'pop', 'click', 'hit', 'riser', 'impact', 'swipe', 'notification', 'ding']);
export type SfxName = z.infer<typeof SfxName>;

export const SfxItem = z.object({
  ...base,
  type: z.literal('sfx'),
  properties: z.object({ name: SfxName, volume: z.number() }),
});
export type SfxItem = z.infer<typeof SfxItem>;

export const MusicItem = z.object({
  ...base,
  type: z.literal('music'),
  source: z.string(),
  properties: z.object({ volume: z.number(), duckVolume: z.number(), fadeIn: z.number(), fadeOut: z.number() }),
});
export type MusicItem = z.infer<typeof MusicItem>;

export const ZoomItem = z.object({
  ...base,
  type: z.literal('zoom'),
  properties: z.object({
    kind: z.enum(['jumpcut', 'emphasis', 'pushin', 'manual']),
    from: z.number(),
    to: z.number(),
    /** Seconds of the ease-in (punch = fast). */
    ease: z.number(),
  }),
});
export type ZoomItem = z.infer<typeof ZoomItem>;

export const EffectItem = z.object({
  ...base,
  type: z.literal('effect'),
  properties: z.object({ kind: z.enum(['flash', 'shake', 'blur']), intensity: z.number() }),
});
export type EffectItem = z.infer<typeof EffectItem>;

export const Timeline = z.object({
  version: z.literal(1),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  duration: z.number(),
  settings: EditSettings,
  clips: z.array(ClipItem),
  cuts: z.array(CutItem),
  /** Source ranges removed by the user (survive regeneration). */
  userCuts: z.array(z.object({ source: z.string(), start: z.number(), end: z.number() })),
  /** Per-word caption text corrections. */
  wordOverrides: z.record(z.string(), z.string()),
  /** Ids of auto-generated elements the user deleted: regeneration must not bring them back. */
  suppressed: z.array(z.string()),
  subtitles: z.array(SubtitleItem),
  graphics: z.array(GraphicItem),
  transitions: z.array(TransitionItem),
  audio: z.array(SfxItem),
  music: z.array(MusicItem),
  effects: z.array(EffectItem),
  zoom: z.array(ZoomItem),
  metadata: z.object({
    title: z.string(),
    sourceOrder: z.array(z.string()),
    hookSentenceId: z.string().nullable(),
    warnings: z.array(z.string()),
  }),
});
export type Timeline = z.infer<typeof Timeline>;

export type AnyElement = ClipItem | SubtitleItem | GraphicItem | TransitionItem | SfxItem | MusicItem | ZoomItem | EffectItem;
export type Layer = 'clips' | 'subtitles' | 'graphics' | 'transitions' | 'audio' | 'music' | 'zoom' | 'effects';
export const ALL_LAYERS: Layer[] = ['clips', 'zoom', 'subtitles', 'graphics', 'transitions', 'audio', 'music', 'effects'];

/** Read-only context the edit engine needs besides the timeline. */
export interface EditContext {
  /** Analyses keyed by mediaId. */
  analyses: Record<string, VideoAnalysis>;
  /** Narrative order of the video media (user's upload order). */
  order: string[];
  /** Uploaded background music track, if any. */
  musicId?: string | null;
}
