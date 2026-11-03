"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { kitText, SIGNAL_LABEL } from "@/lib/oggi/kit";
import type { Idea } from "@/lib/oggi/service";
import { decideOpportunity } from "@/lib/opportunities/actions";
import { cn } from "@/lib/utils";

function ago(iso: string): string {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (h < 1) return "adesso";
  if (h < 24) return `${h} h fa`;
  const d = Math.round(h / 24);
  return d === 1 ? "ieri" : `${d} giorni fa`;
}

function CopyButton({ text, label = "Copia" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 px-2 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {done ? "Copiato" : label}
    </Button>
  );
}

function KitPanel({ idea }: { idea: Idea }) {
  const { kit } = idea;
  return (
    <div className="mt-4 grid gap-4 rounded-xl border border-brand/25 bg-background/60 p-3 md:p-4" data-testid="kit">
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Titoli</h3>
        <ul className="grid gap-1.5">
          {kit.titles.map((t) => (
            <li key={t} className="flex items-start justify-between gap-2 rounded-lg bg-card px-3 py-2 text-sm">
              <span>{t}</span>
              <CopyButton text={t} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Gancio (primi 3 secondi)</h3>
        <div className="flex items-start justify-between gap-2 rounded-lg bg-card px-3 py-2 text-sm font-medium">
          <span>{kit.hook}</span>
          <CopyButton text={kit.hook} />
        </div>
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Scaletta (30–45 s)</h3>
        <ol className="grid gap-1.5">
          {kit.outline.map((o) => (
            <li key={o.label} className="rounded-lg bg-card px-3 py-2 text-sm">
              <span className="block text-[11px] font-semibold text-brand">{o.label}</span>
              {o.text}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Descrizione e hashtag</h3>
          <CopyButton text={kit.description} />
        </div>
        <p className="rounded-lg bg-card px-3 py-2 text-sm whitespace-pre-line">{kit.description}</p>
      </section>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        Usa solo testo, grafiche e voce tue: niente spezzoni TV o foto d&apos;agenzia. Controlla i fatti sulle fonti prima di pubblicare.
      </p>
      <div>
        <CopyButton text={kitText(kit)} label="Copia tutto il kit" />
      </div>
    </div>
  );
}

export function IdeaCard({ idea, rank, compact = false }: { idea: Idea; rank?: number; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await decideOpportunity(idea.id, decision, decision === "approved" ? "Scelta da Oggi" : "Scartata da Oggi");
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });

  const potential = idea.score === null ? null : Math.round(idea.score);

  return (
    <article className={cn("rounded-2xl border bg-card/80 p-4 md:p-5", compact && "p-3 md:p-4")} data-testid="idea">
      <div className="flex items-start gap-3">
        {rank ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand font-display text-xl font-bold text-brand-foreground">{rank}</span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {idea.sport ? <span className="rounded-full border px-2 py-0.5 font-medium text-foreground">{idea.sport}</span> : null}
            {potential !== null ? (
              <span className="rounded-full bg-brand/15 px-2 py-0.5 font-semibold text-brand">Potenziale {potential}</span>
            ) : null}
            <span>{ago(idea.createdAt)}</span>
          </div>
          <h2 className={cn("font-semibold leading-snug", compact ? "text-sm" : "text-base md:text-lg")}>{idea.title}</h2>
          {!compact && idea.signals.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {idea.signals.slice(0, 4).map((s) => (
                <span key={s} className="rounded-md bg-accent px-1.5 py-0.5 text-[11px]">
                  {SIGNAL_LABEL[s]}
                </span>
              ))}
            </div>
          ) : null}
          {!compact && idea.sources.length ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {idea.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    {s.publisher ?? "Fonte"} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={open ? "secondary" : "brand"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> {open ? "Chiudi kit" : "Kit video"}
        </Button>
        {idea.status === "new" ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide("approved")}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />} La faccio
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => decide("rejected")} className="text-muted-foreground">
              <X /> Scarta
            </Button>
          </>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      {open ? <KitPanel idea={idea} /> : null}
    </article>
  );
}

/** Fetch the latest news now (instead of waiting for the morning run). */
export function RefreshNews() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setNote(null);
            const res = await fetch("/api/jobs/drain", { method: "POST" }).catch(() => null);
            const body = res?.ok ? ((await res.json().catch(() => null)) as { ran?: number; scheduled?: number } | null) : null;
            setNote(res?.ok ? (body && (body.ran ?? 0) + (body.scheduled ?? 0) > 0 ? "Aggiornato." : "Già aggiornato.") : "Non riesco ad aggiornare ora, riprova tra poco.");
            router.refresh();
          })
        }
      >
        <RefreshCw className={cn(pending && "animate-spin")} /> {pending ? "Cerco notizie…" : "Aggiorna"}
      </Button>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
}
