import { continueRender, delayRender } from 'remotion';

const loaded = new Map<string, Promise<void>>();

/** Loads Montserrat (OFL) from the asset server. Same code path for Player preview and final render. */
export function loadCaptionFonts(assetBase: string): void {
  if (typeof document === 'undefined' || loaded.has(assetBase)) return;
  const handle = delayRender('Loading caption fonts');
  const weights = [600, 800, 900];
  const p = Promise.all(
    weights.map(async (w) => {
      const face = new FontFace('Montserrat', `url(${assetBase}/fonts/montserrat/montserrat-latin-${w}-normal.woff2) format('woff2')`, { weight: String(w) });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => undefined)
    .catch((e) => console.warn('Font load failed, falling back to system sans', e))
    .finally(() => continueRender(handle));
  loaded.set(assetBase, p);
}

export const CAPTION_FONT = 'Montserrat, "Helvetica Neue", Arial, sans-serif';
