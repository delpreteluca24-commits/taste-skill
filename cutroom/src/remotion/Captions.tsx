import React from 'react';
import type { CaptionSettings, SubtitleItem } from '../core/timeline';
import { CAPTION_FONT } from './fonts';

const outline = (px: number, color = '#000') =>
  [[px, 0], [-px, 0], [0, px], [0, -px], [px * 0.7, px * 0.7], [-px * 0.7, px * 0.7], [px * 0.7, -px * 0.7], [-px * 0.7, -px * 0.7]]
    .map(([x, y]) => `${x}px ${y}px 0 ${color}`)
    .join(', ') + `, 0 ${px * 1.6}px ${px * 3}px rgba(0,0,0,0.45)`;

const backOut = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

/** Subtitle Engine renderer: one group on screen, word-level timing, emphasis in the highlight color. */
export const Captions: React.FC<{ subs: SubtitleItem[]; cs: CaptionSettings; t: number }> = ({ subs, cs, t }) => {
  if (!cs.enabled) return null;
  const active = subs.find((s) => t >= s.start && t < s.end);
  if (!active) return null;
  const local = t - active.start;
  const inP = Math.min(1, local / 0.14);
  let transform = 'none';
  let opacity = 1;
  if (cs.animation === 'pop') { transform = `scale(${0.82 + 0.18 * backOut(inP)})`; opacity = Math.min(1, local / 0.05); }
  else if (cs.animation === 'fade') opacity = inP;
  else if (cs.animation === 'slide') { transform = `translateY(${(1 - inP) * 26}px)`; opacity = inP; }

  const weight = cs.style === 'minimal' ? 600 : cs.style === 'clean' ? 800 : 900;
  const words = active.properties.words;
  const base: React.CSSProperties = {
    fontFamily: CAPTION_FONT,
    fontWeight: weight,
    fontSize: cs.fontSize,
    lineHeight: 1.12,
    color: cs.color,
    textTransform: cs.uppercase ? 'uppercase' : 'none',
    letterSpacing: cs.uppercase ? '0.01em' : '0',
    textAlign: 'center',
  };
  if (cs.style === 'bold' || cs.style === 'karaoke') base.textShadow = outline(Math.max(3, cs.fontSize * 0.07));
  if (cs.style === 'clean' || cs.style === 'minimal') base.textShadow = '0 3px 14px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.6)';

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: cs.position * 1920, display: 'flex', justifyContent: 'center', transform: 'translateY(-50%)' }}>
      <div style={{ maxWidth: 1080 * 0.86, opacity, transform, transformOrigin: 'center center', ...base }}>
        <span
          style={cs.style === 'boxed' ? { background: 'rgba(10,10,10,0.82)', padding: '0.08em 0.32em', borderRadius: 18, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } : undefined}
        >
          {words.map((w, i) => {
            const spoken = t >= w.start - 0.02;
            const current = spoken && (i === words.length - 1 || t < words[i + 1].start - 0.02);
            const style: React.CSSProperties = { display: 'inline-block', marginRight: i < words.length - 1 ? '0.26em' : 0, transition: 'none' };
            if (w.emphasis) {
              style.color = cs.highlightColor;
              style.transform = current ? 'scale(1.1)' : 'scale(1.04)';
              // Scaling does not reflow: widen the gaps so neighbours never touch the enlarged word.
              style.marginLeft = '0.1em';
              style.marginRight = i < words.length - 1 ? '0.36em' : '0.1em';
            }
            if (cs.style === 'karaoke' && current) {
              style.background = cs.highlightColor;
              style.color = '#0B0B0B';
              style.textShadow = 'none';
              style.borderRadius = 14;
              style.padding = '0 0.12em';
            }
            if ((cs.style === 'minimal' || cs.style === 'clean') && !spoken) style.opacity = 0.55;
            return (
              <span key={w.id} style={style}>
                {w.text}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
};
