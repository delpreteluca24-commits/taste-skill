import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sunrise } from "lucide-react";

import { IdeaCard, RefreshNews } from "@/components/oggi/idea-card";
import { requireUser } from "@/lib/auth/dal";
import { chosenIdeas, lastNewsAt, todayIdeas } from "@/lib/oggi/service";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Oggi" };

const STEPS = [
  { n: 1, title: "Scegli una storia", text: "Le migliori 5 di oggi, già ordinate per potenziale." },
  { n: 2, title: "Apri il kit video", text: "Titoli, gancio, scaletta e descrizione pronti da copiare." },
  { n: 3, title: "Registra e pubblica", text: "Premi «La faccio»: la ritrovi in «Scelte»." },
];

export default async function OggiPage(props: PageProps<"/oggi">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const view = (await props.searchParams).view === "scelte" ? "scelte" : "oggi";

  const db = await createClient();
  const [today, chosen, last] = await Promise.all([todayIdeas(db, project.id), chosenIdeas(db, project.id), lastNewsAt(db, project.id)]);
  const tz = project.timezone || "Europe/Rome";
  const day = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());
  const updated = last ? new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(last)) : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <header className="grid gap-3">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-brand uppercase">
          <Sunrise className="size-4" /> Oggi · {day}
        </p>
        <h1 className="font-display text-3xl font-bold tracking-wide uppercase md:text-4xl">
          {view === "oggi" ? "I video da fare oggi" : "Le storie che hai scelto"}
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{updated ? `Notizie aggiornate: ${updated}. Arrivano da sole ogni mattina.` : "Le notizie arrivano da sole ogni mattina."}</p>
          <RefreshNews />
        </div>
        <nav aria-label="Viste" className="flex gap-1 rounded-xl border bg-card/60 p-1 text-sm">
          {[
            { key: "oggi", href: "/oggi", label: `Da fare (${today.top.length + today.more.length})` },
            { key: "scelte", href: "/oggi?view=scelte", label: `Scelte (${chosen.length})` },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              prefetch={false}
              aria-current={view === t.key ? "page" : undefined}
              className={cn("flex-1 rounded-lg px-3 py-2 text-center font-medium transition-colors", view === t.key ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {view === "oggi" ? (
        <>
          <ol className="grid gap-2 sm:grid-cols-3" aria-label="Come funziona">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3 rounded-xl border bg-card/50 p-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-brand/40 text-xs font-bold text-brand">{s.n}</span>
                <span className="text-xs">
                  <span className="block font-semibold text-foreground">{s.title}</span>
                  <span className="text-muted-foreground">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>

          {today.top.length ? (
            <section className="grid gap-3" aria-label="Le 5 di oggi">
              {today.top.map((idea, i) => (
                <IdeaCard key={idea.id} idea={idea} rank={i + 1} />
              ))}
            </section>
          ) : (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nessuna storia fresca in questo momento. Premi <strong>Aggiorna</strong> o torna più tardi: ogni mattina arrivano nuove idee.
            </p>
          )}

          {today.more.length ? (
            <section className="grid gap-2" aria-label="Altre idee">
              <h2 className="mt-2 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Altre idee</h2>
              {today.more.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} compact />
              ))}
            </section>
          ) : null}
        </>
      ) : chosen.length ? (
        <section className="grid gap-3" aria-label="Scelte">
          {chosen.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </section>
      ) : (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Non hai ancora scelto nessuna storia. Vai su <Link href="/oggi" className="underline">Da fare</Link> e premi <strong>La faccio</strong>.
        </p>
      )}
    </div>
  );
}
