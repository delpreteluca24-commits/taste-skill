import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { AnyElement } from '../../core/timeline';
import type { Op } from '../../core/ops';
import { Button, Pill } from './ui';

const TYPE_LABEL: Record<string, string> = { clip: 'Inquadratura', subtitle: 'Sottotitolo', graphic: 'Grafica', zoom: 'Zoom', transition: 'Transizione', sfx: 'SFX', music: 'Musica', effect: 'Effetto' };

/** Fine tune: every action is a timeline op → new version (undoable). */
export const Inspector: React.FC<{ el: AnyElement; names: Record<string, string>; onOps: (ops: Op[], label: string) => void; onClose: () => void }> = ({ el, names, onOps, onClose }) => {
  const [text, setText] = useState(el.type === 'graphic' ? el.properties.text : '');
  const [words, setWords] = useState(el.type === 'subtitle' ? el.properties.words.map((w) => w.text) : []);
  useEffect(() => {
    setText(el.type === 'graphic' ? el.properties.text : '');
    setWords(el.type === 'subtitle' ? el.properties.words.map((w) => w.text) : []);
  }, [el]);

  return (
    <div className="border-b border-ink-800 bg-ink-900 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {TYPE_LABEL[el.type]}
          {el.locked && <Pill tone="accent">tuo</Pill>}
          <span className="font-mono text-[11px] text-ink-400">{el.start.toFixed(2)}–{el.end.toFixed(2)}s</span>
        </div>
        <button onClick={onClose} className="grid h-6 w-6 place-items-center rounded text-ink-400 hover:bg-ink-800" aria-label="Chiudi"><X size={13} /></button>
      </div>
      <p className="mt-1.5 text-xs text-ink-300"><span className="text-ink-500">Perché: </span>{el.reason}</p>
      {el.type === 'clip' && <p className="mt-1 text-xs text-ink-400">Sorgente {names[el.source]} · {el.properties.srcStart.toFixed(2)}–{el.properties.srcEnd.toFixed(2)}s · inquadratura {el.properties.crop.mode}</p>}

      {el.type === 'graphic' && el.properties.kind !== 'progress' && (
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="h-8 flex-1 rounded-md border border-ink-700 bg-ink-950 px-2 text-sm outline-none focus:border-ink-500" />
          <Button size="sm" disabled={!text.trim() || text === el.properties.text} onClick={() => onOps([{ op: 'update_element', id: el.id, patch: { properties: { text: text.toUpperCase() } } }], 'Testo grafica')}>Salva</Button>
        </div>
      )}
      {el.type === 'subtitle' && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1">
            {words.map((w, i) => (
              <input key={el.properties.words[i].id} value={w} onChange={(e) => setWords(words.map((x, j) => (j === i ? e.target.value : x)))}
                style={{ width: `${Math.max(3, w.length + 1)}ch` }} className="h-7 rounded border border-ink-700 bg-ink-950 px-1 text-sm outline-none focus:border-accent" />
            ))}
          </div>
          <Button size="sm" className="mt-2" disabled={words.every((w, i) => w === el.properties.words[i].text)}
            onClick={() => onOps(el.properties.words.flatMap((w, i) => (words[i] !== w.text ? [{ op: 'set_word_text' as const, wordId: w.id, text: words[i] }] : [])), 'Correzione sottotitoli')}>
            Correggi testo
          </Button>
        </div>
      )}
      {el.type === 'zoom' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-300">
          Scala
          {[1.05, 1.1, 1.15, 1.2].map((s) => (
            <Button key={s} size="sm" variant={Math.abs(el.properties.to - s) < 0.01 ? 'primary' : 'subtle'} onClick={() => onOps([{ op: 'update_element', id: el.id, patch: { properties: { to: s, from: el.properties.kind === 'jumpcut' ? s : el.properties.from } } }], 'Zoom')}>{Math.round(s * 100)}%</Button>
          ))}
        </div>
      )}
      {el.type === 'sfx' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-300">
          Volume
          {[0.2, 0.4, 0.6].map((v) => (
            <Button key={v} size="sm" variant={Math.abs(el.properties.volume - v) < 0.06 ? 'primary' : 'subtle'} onClick={() => onOps([{ op: 'update_element', id: el.id, patch: { properties: { volume: v } } }], 'Volume SFX')}>{Math.round(v * 100)}%</Button>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {el.type !== 'subtitle' && el.type !== 'music' && (
          <Button size="sm" variant="danger" onClick={() => onOps([{ op: 'delete_elements', ids: [el.id] }], el.type === 'clip' ? 'Inquadratura tagliata' : 'Elemento rimosso')}>
            <Trash2 size={12} /> {el.type === 'clip' ? 'Taglia inquadratura' : 'Rimuovi'}
          </Button>
        )}
      </div>
    </div>
  );
};
