import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { AnyElement, Timeline as TL } from '../../core/timeline';
import { fmtTime } from '../api';

const CLIP_COLORS = ['#3b82f6', '#a855f7', '#14b8a6', '#f97316', '#ec4899', '#84cc16', '#06b6d4', '#eab308'];

interface Props {
  timeline: TL;
  time: number;
  order: string[];
  names: Record<string, string>;
  selectedId: string | null;
  selection: { start: number; end: number } | null;
  onSeek: (t: number) => void;
  onSelectElement: (el: AnyElement | null) => void;
  onSelection: (r: { start: number; end: number } | null) => void;
}

type Row = { key: string; label: string; items: AnyElement[]; color: (el: AnyElement) => string; text: (el: AnyElement) => string };

export const Timeline: React.FC<Props> = ({ timeline: t, time, order, names, selectedId, selection, onSeek, onSelectElement, onSelection }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ start: number } | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 88));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = Math.max(8, (width / Math.max(1, t.duration)) * zoom);
  const total = t.duration * pps;

  // Keep the playhead visible while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 120) el.scrollLeft = Math.max(0, x - 120);
  }, [time, pps]);

  const rows: Row[] = useMemo(() => [
    { key: 'clips', label: 'Video', items: t.clips, color: (el) => (el.type === 'clip' && el.properties.role === 'hook' ? '#FFD43B' : CLIP_COLORS[Math.max(0, order.indexOf((el as any).source)) % CLIP_COLORS.length]), text: (el) => (el.type === 'clip' ? `${el.properties.role === 'hook' ? 'HOOK · ' : ''}#${order.indexOf(el.source) + 1}` : '') },
    { key: 'zoom', label: 'Camera', items: [...t.zoom, ...t.transitions, ...t.effects], color: (el) => (el.type === 'transition' ? '#f472b6' : el.type === 'effect' ? '#fafafa' : '#38bdf8'), text: (el) => (el.type === 'zoom' ? `${Math.round(el.properties.to * 100)}%` : el.type === 'transition' ? el.properties.kind : el.type === 'effect' ? el.properties.kind : '') },
    { key: 'subtitles', label: 'Testo', items: t.subtitles, color: () => '#e5e5e5', text: (el) => (el.type === 'subtitle' ? el.properties.words.map((w) => w.text).join(' ') : '') },
    { key: 'graphics', label: 'Grafiche', items: t.graphics.filter((g) => g.properties.kind !== 'progress'), color: (el) => (el.type === 'graphic' && el.properties.kind === 'cta' ? '#fb923c' : '#FFD43B'), text: (el) => (el.type === 'graphic' ? `${el.properties.kind}${el.properties.text ? ' · ' + el.properties.text : ''}` : '') },
    { key: 'audio', label: 'SFX', items: t.audio, color: () => '#34d399', text: (el) => (el.type === 'sfx' ? el.properties.name : '') },
    { key: 'music', label: 'Musica', items: t.music, color: () => '#c084fc', text: () => 'musica (ducking)' },
  ], [t, order, names]);

  const timeAt = (e: React.MouseEvent) => {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(t.duration, (e.clientX - rect.left - 88 + el.scrollLeft) / pps));
  };

  const ticks = useMemo(() => {
    const step = pps > 60 ? 1 : pps > 25 ? 2 : pps > 12 ? 5 : 10;
    const out: number[] = [];
    for (let s = 0; s <= t.duration; s += step) out.push(s);
    return out;
  }, [pps, t.duration]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center justify-between border-b border-ink-800 px-3 text-xs text-ink-400">
        <div className="flex items-center gap-3">
          <span className="font-mono text-ink-100 tabular">{fmtTime(time)}</span>
          <span>/ {fmtTime(t.duration)}</span>
          {selection ? (
            <button className="rounded bg-accent/15 px-1.5 py-0.5 text-accent" onClick={() => onSelection(null)}>
              selezione {selection.start.toFixed(1)}–{selection.end.toFixed(1)}s ✕
            </button>
          ) : (
            <span className="hidden md:inline">Shift + trascina sul righello per selezionare un tratto</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-ink-800" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} aria-label="Riduci"><Minus size={12} /></button>
          <span className="w-10 text-center tabular">{Math.round(zoom * 100)}%</span>
          <button className="grid h-6 w-6 place-items-center rounded hover:bg-ink-800" onClick={() => setZoom((z) => Math.min(12, z * 1.5))} aria-label="Ingrandisci"><Plus size={12} /></button>
        </div>
      </div>
      <div ref={scroller} className="scroll-thin relative flex-1 overflow-x-auto overflow-y-hidden select-none">
        <div style={{ width: total + 88 + 40 }} className="relative h-full">
          {/* ruler */}
          <div
            className="sticky top-0 z-20 ml-[88px] h-6 cursor-pointer border-b border-ink-800 bg-ink-900"
            onMouseDown={(e) => {
              const s = timeAt(e);
              if (e.shiftKey) { drag.current = { start: s }; onSelection({ start: s, end: s }); }
              else onSeek(s);
            }}
            onMouseMove={(e) => {
              if (drag.current) { const x = timeAt(e); onSelection({ start: Math.min(drag.current.start, x), end: Math.max(drag.current.start, x) }); }
              else if (e.buttons === 1) onSeek(timeAt(e));
            }}
            onMouseUp={() => { drag.current = null; }}
            onMouseLeave={() => { drag.current = null; }}
          >
            {ticks.map((s) => (
              <div key={s} className="absolute top-0 h-full border-l border-ink-700 pl-1 font-mono text-[10px] text-ink-400" style={{ left: s * pps }}>{s}s</div>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.key} className="relative flex h-[30px] items-center border-b border-ink-850">
              <div className="sticky left-0 z-10 flex h-full w-[88px] shrink-0 items-center border-r border-ink-800 bg-ink-900 pl-3 text-[11px] text-ink-400">{r.label}</div>
              <div className="relative h-full flex-1" onMouseDown={(e) => { if (e.target === e.currentTarget) { onSeek(timeAt(e)); onSelectElement(null); } }}>
                {r.key === 'graphics' && t.graphics.some((g) => g.properties.kind === 'progress') && (
                  <div className="pointer-events-none absolute bottom-[2px] left-0 h-[3px] rounded-full bg-accent/50" style={{ width: total }} title="Barra di avanzamento" />
                )}
                {r.items.map((el) => {
                  const sel = el.id === selectedId;
                  const c = r.color(el);
                  return (
                    <button
                      key={el.id + r.key}
                      title={`${r.text(el)}\n${el.reason}`}
                      onMouseDown={(e) => { e.stopPropagation(); onSelectElement(el); onSeek(el.start + 0.01); }}
                      className={`absolute top-[4px] h-[22px] overflow-hidden rounded-[5px] px-1.5 text-left text-[10px] leading-[22px] whitespace-nowrap transition ${sel ? 'ring-2 ring-white' : ''}`}
                      style={{ left: el.start * pps, width: Math.max(3, (el.end - el.start) * pps - 1), background: `${c}${el.locked ? '' : 'cc'}`, color: '#0b0b0c', zIndex: el.type === 'zoom' ? 1 : 2 }}
                    >
                      {r.text(el)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {selection && (
            <div className="pointer-events-none absolute top-0 bottom-0 z-10 bg-accent/10 ring-1 ring-accent/50" style={{ left: 88 + selection.start * pps, width: (selection.end - selection.start) * pps }} />
          )}
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-accent" style={{ left: 88 + time * pps }}>
            <div className="absolute -left-[5px] top-0 h-2.5 w-[11px] rounded-b-sm bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
};
