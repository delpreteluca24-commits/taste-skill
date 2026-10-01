import type { CaptionSettings, EditSettings, PresetId } from './timeline';

export const PRESET_LABELS: Record<PresetId, string> = {
  viral: 'Viral',
  premium: 'Premium',
  minimal: 'Minimal',
  podcast: 'Podcast',
  educational: 'Educational',
  storytelling: 'Storytelling',
  fast: 'Fast Paced',
  cinematic: 'Cinematic',
};

const captionsBase: CaptionSettings = {
  enabled: true,
  style: 'bold',
  minWords: 2,
  maxWords: 4,
  fontSize: 78,
  position: 0.68,
  uppercase: true,
  color: '#FFFFFF',
  highlightColor: '#FFD43B',
  animation: 'pop',
  emphasis: true,
};

const base: EditSettings = {
  preset: 'premium',
  maxPause: 0.28,
  padBefore: 0.06,
  padAfter: 0.12,
  emphasisPause: 0.18,
  removeFillers: true,
  removeIntro: true,
  removeFalseStarts: true,
  coldOpen: false,
  brollShot: 1.6,
  brollMaxTotal: 6,
  minShot: 0.45,
  zoomDensity: 0.5,
  jumpcutZoom: 1.08,
  emphasisZoom: 1.14,
  pushIn: true,
  graphicsDensity: 0.5,
  sfxDensity: 0.5,
  sfxVolume: 0.5,
  transitionStyle: 'subtle',
  musicVolume: 0.22,
  duckVolume: 0.08,
  maxDuration: 75,
  titleCard: true,
  progressBar: false,
  ctaText: null,
  grade: 'clean',
  accent: '#FFD43B',
  captions: captionsBase,
  seed: 0,
};

type Patch = Partial<Omit<EditSettings, 'captions'>> & { captions?: Partial<CaptionSettings> };

const PATCHES: Record<PresetId, Patch> = {
  premium: {},
  viral: {
    maxPause: 0.16, padAfter: 0.08, emphasisPause: 0.12, coldOpen: true, brollShot: 1.2,
    zoomDensity: 0.75, jumpcutZoom: 1.1, emphasisZoom: 1.18, graphicsDensity: 0.75, sfxDensity: 0.75,
    transitionStyle: 'dynamic', maxDuration: 60, progressBar: true, grade: 'punchy', accent: '#FFD43B',
    captions: { maxWords: 3, fontSize: 86, style: 'bold' },
  },
  fast: {
    maxPause: 0.1, padBefore: 0.04, padAfter: 0.06, emphasisPause: 0.08, coldOpen: true, brollShot: 0.9,
    minShot: 0.35, zoomDensity: 0.9, jumpcutZoom: 1.12, emphasisZoom: 1.2, graphicsDensity: 0.85,
    sfxDensity: 0.9, transitionStyle: 'dynamic', maxDuration: 45, progressBar: true, grade: 'punchy',
    accent: '#7CFF6B', captions: { maxWords: 2, minWords: 1, fontSize: 92 },
  },
  minimal: {
    maxPause: 0.4, emphasisPause: 0.25, zoomDensity: 0.2, jumpcutZoom: 1.05, emphasisZoom: 1.08, pushIn: false,
    graphicsDensity: 0.15, sfxDensity: 0.1, transitionStyle: 'cut', maxDuration: 90, titleCard: false, grade: 'none',
    accent: '#FFFFFF',
    captions: { style: 'minimal', uppercase: false, fontSize: 58, maxWords: 5, minWords: 3, animation: 'fade', emphasis: false, position: 0.74 },
  },
  podcast: {
    maxPause: 0.45, padAfter: 0.18, emphasisPause: 0.3, removeIntro: false, zoomDensity: 0.45, jumpcutZoom: 1.06,
    emphasisZoom: 1.12, pushIn: true, graphicsDensity: 0.25, sfxDensity: 0.15, transitionStyle: 'cut',
    maxDuration: 120, grade: 'clean', accent: '#5EEAD4',
    captions: { style: 'karaoke', maxWords: 4, fontSize: 70, position: 0.72, highlightColor: '#5EEAD4' },
  },
  educational: {
    maxPause: 0.3, emphasisPause: 0.22, zoomDensity: 0.5, graphicsDensity: 0.85, sfxDensity: 0.45,
    transitionStyle: 'subtle', maxDuration: 90, progressBar: true, grade: 'clean', accent: '#60A5FA',
    captions: { style: 'boxed', maxWords: 4, fontSize: 70, highlightColor: '#60A5FA' },
  },
  storytelling: {
    maxPause: 0.38, padAfter: 0.16, emphasisPause: 0.4, removeIntro: false, zoomDensity: 0.4, pushIn: true,
    graphicsDensity: 0.3, sfxDensity: 0.3, transitionStyle: 'subtle', maxDuration: 120, grade: 'cinematic',
    accent: '#FDBA74', captions: { style: 'clean', uppercase: false, maxWords: 5, fontSize: 66, animation: 'fade' },
  },
  cinematic: {
    maxPause: 0.35, emphasisPause: 0.35, zoomDensity: 0.3, jumpcutZoom: 1.04, emphasisZoom: 1.08, pushIn: true,
    graphicsDensity: 0.2, sfxDensity: 0.35, transitionStyle: 'subtle', maxDuration: 60, titleCard: true,
    grade: 'cinematic', accent: '#E5E5E5',
    captions: { style: 'minimal', uppercase: false, fontSize: 56, maxWords: 5, minWords: 3, animation: 'fade', emphasis: false, position: 0.78 },
  },
};

export function presetSettings(preset: PresetId, keep?: Pick<EditSettings, 'ctaText' | 'seed'>): EditSettings {
  const p = PATCHES[preset];
  return {
    ...base,
    ...p,
    preset,
    captions: { ...base.captions, ...(p.captions ?? {}) },
    ctaText: keep?.ctaText ?? p.ctaText ?? base.ctaText,
    seed: keep?.seed ?? 0,
  };
}

export const PRESETS = Object.keys(PATCHES) as PresetId[];
