import React from 'react';
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

const Graphic: React.FC<{ g: GraphicItem; t: number; accent: string; duration: number }> = ({ g, t, accent, duration }) => {
  const local = t - g.start;
  const left = g.end - t;
  const inP = local / 0.28;
  const outP = Math.min(1, left / 0.2);
  const p = g.properties;
  const font: React.CSSProperties = { fontFamily: CAPTION_FONT, fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05 };

  switch (p.kind) {
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

export const Graphics: React.FC<{ items: GraphicItem[]; t: number; accent: string; duration: number }> = ({ items, t, accent, duration }) => (
  <>
    {items
      .filter((g) => t >= g.start && t < g.end)
      .sort((a, b) => a.layer - b.layer)
      .map((g) => (
        <Graphic key={g.id} g={g} t={t} accent={accent} duration={duration} />
      ))}
  </>
);
