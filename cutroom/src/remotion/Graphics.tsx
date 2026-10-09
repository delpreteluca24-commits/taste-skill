import React from 'react';
import { Img } from 'remotion';
import type { GraphicItem } from '../core/timeline';
import { CAPTION_FONT } from './fonts';

const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const backOut = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = Math.min(1, Math.max(0, x));
  return 1 + c3 * (v - 1) ** 3 + c1 * (v - 1) ** 2;
};

/** Readable dark text on any accent color. */
const ink = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#0B0B0B' : '#FFFFFF';
};

const TOP_Y = 1920 * 0.17;

function fmtNumber(v: number, p: number) {
  const cur = Math.round(v * easeOut(p));
  return cur.toLocaleString('it-IT');
}

export type GraphicMedia = Record<string, { src: string; width: number; height: number }>;

const outline = (px: number) =>
  [[px, 0], [-px, 0], [0, px], [0, -px], [px * 0.7, px * 0.7], [-px * 0.7, px * 0.7], [px * 0.7, -px * 0.7], [-px * 0.7, -px * 0.7]]
    .map(([x, y]) => `${x}px ${y}px 0 #000`).join(', ') + `, 0 ${px * 2}px ${px * 4}px rgba(0,0,0,0.5)`;

/** Channel slogan: words slam in one by one, the frame shakes on each impact, accent slab on the key word. */
const Slogan: React.FC<{ g: GraphicItem; t: number; accent: string }> = ({ g, t, accent }) => {
  const local = t - g.start;
  const dur = g.end - g.start;
  const words = g.properties.text.split(/\s+/).filter(Boolean);
  const step = Math.min(0.45, Math.max(0.18, (dur - 0.45) / Math.max(1, words.length)));
  const exit = Math.max(0, 1 - (g.end - t) / 0.25); // 0 → 1 in the last 0.25 s
  const lastLand = Math.min(words.length - 1, Math.floor(local / step));
  const sinceLand = local - Math.max(0, lastLand) * step;
  const shakeAmp = Math.max(0, 1 - sinceLand / 0.22) * 16;
  const sx = Math.sin(local * 90) * shakeAmp;
  const sy = Math.cos(local * 70) * shakeAmp * 0.6;
  const keyIdx = words.length > 1 ? Math.min(1, words.length - 1) : 0;
  const tilt = [-4, 3, -2, 2];
  const flash = Math.max(0, 1 - local / 0.12) * 0.55;
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0.05) 20%, rgba(0,0,0,0.45) 100%)', opacity: 1 - exit }} />
      {flash > 0 && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: flash }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1920 * 0.42, transform: `translate(${sx}px, ${sy}px) translateY(-50%) scale(${1 + exit * 0.18})`, opacity: 1 - exit, filter: exit > 0 ? `blur(${exit * 10}px)` : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {words.map((w, i) => {
          const p = (local - i * step) / 0.16;
          if (p < 0) return <div key={i} style={{ height: 0 }} />;
          const e = easeOut(p);
          const scale = 2.4 - 1.4 * e;
          const rot = tilt[i % tilt.length] * (2 - e);
          const key = i === keyIdx;
          return (
            <div key={i} style={{ fontFamily: CAPTION_FONT, fontWeight: 900, fontSize: key ? 190 : 160, lineHeight: 1, textTransform: 'uppercase', letterSpacing: '-0.01em',
              color: key ? ink(accent) : '#fff', background: key ? accent : 'transparent', padding: key ? '0.02em 0.22em 0.08em' : 0, borderRadius: key ? 26 : 0,
              textShadow: key ? 'none' : outline(9), boxShadow: key ? '0 18px 60px rgba(0,0,0,0.55)' : 'none',
              transform: `scale(${scale}) rotate(${rot}deg)`, opacity: Math.min(1, p * 4) }}>
              {w}
            </div>
          );
        })}
      </div>
    </>
  );
};

/** Photo cutaway: whip-in card over a blurred fill of the same photo, slow push, name tag, whip-out. */
const Photo: React.FC<{ g: GraphicItem; t: number; accent: string; media: GraphicMedia }> = ({ g, t, accent, media }) => {
  const m = g.properties.mediaId ? media[g.properties.mediaId] : undefined;
  if (!m) return null;
  const local = t - g.start;
  const dur = g.end - g.start;
  const inP = easeOut(local / 0.32);
  const outP = Math.max(0, 1 - (g.end - t) / 0.24);
  const cardW = 1010;
  const cardH = Math.min(1150, (cardW * m.height) / Math.max(1, m.width));
  const x = (1 - inP) * 1150 - outP * 1150;
  const rot = (1 - inP) * 9 - 3 + outP * -6;
  const blurPx = Math.max(1 - inP, outP) * 18;
  const push = 1 + 0.08 * Math.min(1, local / Math.max(0.1, dur));
  const tagP = backOut((local - 0.22) / 0.3);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: Math.min(1, local / 0.12) * (1 - outP) }}>
        <Img src={m.src} style={{ position: 'absolute', inset: -80, width: 1080 + 160, height: 1920 + 160, objectFit: 'cover', filter: 'blur(38px) brightness(0.55) saturate(1.2)' }} />
      </div>
      <div style={{ position: 'absolute', left: 540 - cardW / 2, top: 1920 * 0.4 - cardH / 2, width: cardW, height: cardH, transform: `translateX(${x}px) rotate(${rot}deg)`, filter: blurPx > 0.5 ? `blur(${blurPx}px)` : undefined }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 28, overflow: 'hidden', border: '14px solid #fff', boxShadow: '0 30px 90px rgba(0,0,0,0.6)', background: '#111' }}>
          <Img src={m.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${push})` }} />
        </div>
        {g.properties.text && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: cardH + 34, display: 'flex', justifyContent: 'center', opacity: Math.min(1, Math.max(0, tagP)), transform: `translateY(${(1 - Math.min(1, Math.max(0, tagP))) * 40}px) rotate(-2deg)` }}>
            <div style={{ fontFamily: CAPTION_FONT, fontWeight: 900, fontSize: 66, textTransform: 'uppercase', color: ink(accent), background: accent, borderRadius: 18, padding: '0.1em 0.45em', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
              {g.properties.text}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

const Graphic: React.FC<{ g: GraphicItem; t: number; accent: string; duration: number; media: GraphicMedia }> = ({ g, t, accent, duration, media }) => {
  const local = t - g.start;
  const left = g.end - t;
  const inP = local / 0.28;
  const outP = Math.min(1, left / 0.2);
  const p = g.properties;
  const font: React.CSSProperties = { fontFamily: CAPTION_FONT, fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05 };

  switch (p.kind) {
    case 'slogan':
      return <Slogan g={g} t={t} accent={accent} />;
    case 'photo':
      return <Photo g={g} t={t} accent={accent} media={media} />;
    case 'progress':
      return <div style={{ position: 'absolute', top: 0, left: 0, height: 9, width: `${Math.min(100, (t / Math.max(0.1, duration)) * 100)}%`, background: accent, boxShadow: `0 0 18px ${accent}` }} />;
    case 'fullscreen': {
      const s = 1.12 - 0.12 * easeOut(local / 0.22);
      return (
        <div style={{ position: 'absolute', inset: 0, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: outP }}>
          <div style={{ ...font, fontSize: 132, color: ink(accent), textAlign: 'center', padding: '0 70px', transform: `scale(${s})` }}>{p.text}</div>
        </div>
      );
    }
    case 'title':
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: TOP_Y, display: 'flex', justifyContent: 'center', transform: `translateY(${(1 - easeOut(inP)) * -40}px) translateY(-50%)`, opacity: Math.min(easeOut(inP), outP) }}>
          <div style={{ ...font, fontSize: 70, color: '#fff', maxWidth: 900, textAlign: 'center', textShadow: '0 4px 24px rgba(0,0,0,0.55)' }}>
            <span style={{ background: accent, color: ink(accent), padding: '0.06em 0.28em', borderRadius: 14, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', textShadow: 'none' }}>{p.text}</span>
          </div>
        </div>
      );
    case 'counter':
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: TOP_Y, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(-50%) scale(${0.7 + 0.3 * backOut(inP)})`, opacity: outP }}>
          <div style={{ ...font, fontSize: 150, color: accent, textShadow: '0 6px 0 #000, 0 10px 40px rgba(0,0,0,0.6)' }}>
            {p.prefix ?? ''}{fmtNumber(p.value ?? 0, local / 0.7)}
          </div>
          {p.suffix ? <div style={{ ...font, fontSize: 54, color: '#fff', textShadow: '0 4px 18px rgba(0,0,0,0.7)', marginTop: 4 }}>{p.suffix}</div> : null}
        </div>
      );
    case 'cta':
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: TOP_Y, display: 'flex', justifyContent: 'center', transform: `translateY(-50%) scale(${0.8 + 0.2 * backOut(inP)})`, opacity: outP }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, background: '#fff', borderRadius: 999, padding: '22px 38px 22px 26px', boxShadow: '0 14px 50px rgba(0,0,0,0.45)' }}>
            <div style={{ width: 64, height: 64, borderRadius: 999, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', ...font, fontSize: 40, color: ink(accent), transform: `translateX(${Math.sin(local * 6) * 4}px)` }}>→</div>
            <div style={{ ...font, fontSize: 50, color: '#0B0B0B', maxWidth: 760 }}>{p.text}</div>
          </div>
        </div>
      );
    case 'lowerThird':
      return (
        <div style={{ position: 'absolute', left: 60, top: 1920 * 0.56, transform: `translateX(${(1 - easeOut(inP)) * -120}px)`, opacity: Math.min(easeOut(inP), outP) }}>
          <div style={{ display: 'flex', alignItems: 'stretch', background: 'rgba(12,12,12,0.86)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ width: 12, background: accent }} />
            <div style={{ ...font, fontSize: 48, color: '#fff', padding: '18px 28px' }}>{p.text}</div>
          </div>
        </div>
      );
    default: {
      // keyword / callout / label / icon: pill pop-up
      return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: TOP_Y, display: 'flex', justifyContent: 'center', transform: `translateY(-50%) scale(${0.6 + 0.4 * backOut(inP)}) rotate(-2deg)`, opacity: outP }}>
          <div style={{ ...font, fontSize: p.kind === 'keyword' ? 76 : 56, color: ink(accent), background: accent, borderRadius: 22, padding: '0.12em 0.42em', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', maxWidth: 940, textAlign: 'center' }}>
            {p.text}
          </div>
        </div>
      );
    }
  }
};

export const Graphics: React.FC<{ items: GraphicItem[]; t: number; accent: string; duration: number; media?: GraphicMedia }> = ({ items, t, accent, duration, media = {} }) => (
  <>
    {items
      .filter((g) => t >= g.start && t < g.end)
      .sort((a, b) => a.layer - b.layer)
      .map((g) => (
        <Graphic key={g.id} g={g} t={t} accent={accent} duration={duration} media={media} />
      ))}
  </>
);
