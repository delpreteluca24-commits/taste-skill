import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, RotateCcw, Shuffle, Sparkles } from 'lucide-react';
import type { ChatMessage } from '../api';
import { Button, Pill } from './ui';

const SUGGESTIONS = [
  'Rendi il video più dinamico',
  'Fai i sottotitoli più grandi',
  'Rendi l\'hook più forte',
  'Fai durare il video massimo 30 secondi',
  'Metti una CTA finale',
  'Usa meno SFX',
  'Rendi lo stile più premium',
  'Togli tutti gli effetti',
];

interface Props {
  messages: ChatMessage[];
  engine: 'claude' | 'rules';
  busy: boolean;
  pendingProposalId: string | null;
  context: string;
  onSend: (text: string) => void;
  onProposal: (pid: string, action: 'apply' | 'discard' | 'retry') => void;
}

export const ChatPanel: React.FC<Props> = ({ messages, engine, busy, pendingProposalId, context, onSend, onProposal }) => {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);

  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    onSend(v);
    setText('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 items-center justify-between border-b border-ink-800 px-4">
        <div className="flex items-center gap-2 text-sm font-medium"><Sparkles size={14} className="text-accent" /> AI editing chat</div>
        <Pill tone={engine === 'claude' ? 'accent' : 'muted'}>{engine === 'claude' ? 'Claude' : 'interprete locale'}</Pill>
      </div>
      <div ref={list} className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-ink-400">Scrivi cosa cambiare. Ogni modifica è un'anteprima: la applichi solo se ti piace.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[92%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${m.role === 'user' ? 'bg-ink-700 text-ink-100' : 'border border-ink-800 bg-ink-900 text-ink-100'}`}>
              {m.text}
              {m.role === 'assistant' && m.proposalId && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {m.status === 'proposed' && m.proposalId === pendingProposalId ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => onProposal(m.proposalId!, 'apply')}><Check size={12} /> Applica</Button>
                      <Button size="sm" onClick={() => onProposal(m.proposalId!, 'discard')}><RotateCcw size={12} /> Annulla</Button>
                      <Button size="sm" onClick={() => onProposal(m.proposalId!, 'retry')}><Shuffle size={12} /> Prova un'altra versione</Button>
                    </>
                  ) : (
                    <Pill tone={m.status === 'applied' ? 'good' : 'muted'}>{m.status === 'applied' ? 'applicata' : m.status === 'discarded' ? 'scartata' : 'non applicata'}</Pill>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="w-24 animate-pulse rounded-xl border border-ink-800 bg-ink-900 px-3 py-2 text-xs text-ink-400">Sto montando…</div>}
      </div>
      <div className="border-t border-ink-800 p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto scroll-thin pb-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => onSend(s)} disabled={busy} className="shrink-0 rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-ink-300 hover:border-ink-500 hover:text-ink-100 disabled:opacity-40">{s}</button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-900 p-2 focus-within:border-ink-500">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder='Es. "Metti una grafica quando parlo dei 1.000 euro"'
            className="min-h-[40px] flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-ink-500"
          />
          <Button variant="primary" size="sm" className="h-8 w-8 !px-0" onClick={send} disabled={busy || !text.trim()} aria-label="Invia"><ArrowUp size={15} /></Button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">{context}</p>
      </div>
    </div>
  );
};
