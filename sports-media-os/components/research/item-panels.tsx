import { CircleCheck, CircleHelp, Film, Info, Lightbulb, ShieldAlert } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatRelative, humanize, platformLabel } from "@/lib/dashboard/format";
import { formatResearchDate, dateTimeAttr } from "@/lib/research/format";
import type { ResearchItemView, Workspace } from "@/lib/research/service";
import { suggestEditorialAlternatives } from "@/lib/rights/alternatives";

import { RightsBadge } from "./badges";
import { AnswerQuestionForm, ItemActions, NewItemForm, type SourceOption } from "./item-forms";
import { AssetRights, ExternalUrl, Provenance, SourceLink, toItemFormValue } from "./shared";

/** Workspace tabs backed by research items (timeline, quotes, media, competitors, questions, notes & context). */

type PanelProps = { ws: Workspace; sources: SourceOption[] };

function Attribution({ item }: { item: ResearchItemView }) {
  if (item.source) return <SourceLink source={item.source} />;
  if (item.url) return <ExternalUrl url={item.url} />;
  return null;
}

/* ------------------------------------------------------------------------- */

export function TimelinePanel({ ws, sources }: PanelProps) {
  const events = ws.items.timeline;
  return (
    <div className="grid gap-4">
      <SectionCard title="Add an event" description="Dated events from the sources: they drive timeline graphics and voiceover.">
        <NewItemForm opportunityId={ws.opportunity.id} type="timeline" sources={sources} />
      </SectionCard>
      <SectionCard title="Timeline" description="Oldest first. Dates are UTC." count={events.length} testId="timeline">
        {events.length === 0 ? (
          <EmptyState>No events yet. Add them from the sources, or let “AI: suggest research” draft a timeline from them.</EmptyState>
        ) : (
          <ol className="relative grid gap-3 border-l pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative" data-testid="timeline-event">
                <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full border border-brand bg-background" aria-hidden />
                <time dateTime={dateTimeAttr(e.occurredAt)} className="text-[11px] font-medium text-muted-foreground tabular">
                  {e.occurredAt ? formatResearchDate(e.occurredAt) : "Date unknown"}
                </time>
                <p className="text-[13px]">{e.title}</p>
                {e.content ? <p className="text-xs whitespace-pre-line text-muted-foreground">{e.content}</p> : null}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Attribution item={e} />
                  <Provenance item={e} />
                  <ItemActions itemId={e.id} type="timeline" value={toItemFormValue(e)} sources={sources} noun="event" />
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function QuotesPanel({ ws, sources }: PanelProps) {
  const quotes = ws.items.quote;
  return (
    <div className="grid gap-4">
      <SectionCard title="Add a quote" description="Exact words with the speaker and where they were said. Unattributed quotes are not accepted.">
        <NewItemForm opportunityId={ws.opportunity.id} type="quote" sources={sources} />
      </SectionCard>
      <SectionCard title="Quotes" count={quotes.length} testId="quotes">
        {quotes.length === 0 ? (
          <EmptyState>No quotes yet. Add statements from interviews, press conferences or posts, with their source.</EmptyState>
        ) : (
          <ul className="grid gap-3">
            {quotes.map((q) => (
              <li key={q.id} className="rounded-md border px-3 py-2" data-testid="quote">
                <figure>
                  <blockquote className="text-[13px] whitespace-pre-line">“{q.content}”</blockquote>
                  <figcaption className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">— {q.meta.speaker ?? "Unknown speaker"}</span>
                    {q.occurredAt ? <time dateTime={dateTimeAttr(q.occurredAt)}>{formatResearchDate(q.occurredAt)}</time> : null}
                    <Attribution item={q} />
                    <Provenance item={q} />
                  </figcaption>
                </figure>
                <div className="mt-1">
                  <ItemActions itemId={q.id} type="quote" value={toItemFormValue(q)} sources={sources} noun="quote" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function MediaPanel({ ws, sources }: PanelProps) {
  const media = ws.items.media;
  const alternatives = suggestEditorialAlternatives({
    assets: media.map((m) => ({
      status: m.source?.rightsStatus ?? "unchecked",
      usable: m.source?.usableInProduction ?? false,
      kind: m.meta.mediaKind,
    })),
    confirmedFacts: ws.progress.confirmedClaims,
    timelineItems: ws.progress.timeline,
    quotes: ws.progress.quotes,
    hasStatistics: false,
    hasLocations: false,
  });

  return (
    <div className="grid gap-4">
      <div role="note" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Media needs a rights classification before production. Every asset starts Unchecked; classify it in the Rights Center. GREEN may be
          used, YELLOW only after a human rights approval (never by automated workflows), RED never. The story does not depend on it: it can
          be produced with original formats.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-3">
          <SectionCard title="Add a media asset" description="Footage, photos, audio or posts you might use. Logging an asset does not clear it.">
            <NewItemForm opportunityId={ws.opportunity.id} type="media" sources={sources} />
          </SectionCard>
          <SectionCard title="Media assets" count={media.length} testId="media">
            {media.length === 0 ? (
              <EmptyState>No media logged. Assets you find (clips, photos, posts) are tracked here with their rights state.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {media.map((m) => (
                  <li key={m.id} className="grid gap-1 rounded-md border px-3 py-2" data-testid="media-asset">
                    <div className="flex flex-wrap items-center gap-2">
                      <Film className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="text-[13px] font-medium">{m.title}</span>
                      {m.meta.mediaKind ? <Badge variant="outline">{humanize(m.meta.mediaKind)}</Badge> : null}
                      <Provenance item={m} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {m.source ? (
                        <>
                          <SourceLink source={m.source} />
                          <AssetRights source={m.source} />
                        </>
                      ) : (
                        <>
                          {m.url ? <ExternalUrl url={m.url} /> : null}
                          <RightsBadge status="unchecked" usable={false} />
                        </>
                      )}
                    </div>
                    {m.content ? <p className="text-xs whitespace-pre-line text-muted-foreground">{m.content}</p> : null}
                    <ItemActions itemId={m.id} type="media" value={toItemFormValue(m)} sources={sources} noun="media asset" />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="Story ≠ footage"
          description={alternatives.headline}
          className="content-start lg:col-span-2"
          testId="editorial-alternatives"
        >
          <ul className="grid gap-2">
            {alternatives.suggestions.slice(0, 6).map((s) => (
              <li key={s.format} className="text-xs">
                <p className="flex items-center gap-1.5 font-medium">
                  <Lightbulb className="size-3.5 text-brand" aria-hidden />
                  {s.label}
                </p>
                <p className="text-[11px] text-muted-foreground">{s.reason}</p>
                {s.caution ? <p className="text-[11px] text-warning">{s.caution}</p> : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            The production plan is chosen on the story; these are suggestions from the material on hand.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function CompetitorsPanel({ ws, sources }: PanelProps) {
  const rows = ws.items.competitor;
  return (
    <div className="grid gap-4">
      <SectionCard
        title="Log a competitor video"
        description="What other channels already published on this story, so our angle stands out. Logged as links only: never as our material."
      >
        <NewItemForm opportunityId={ws.opportunity.id} type="competitor" sources={sources} />
      </SectionCard>
      <SectionCard title="Competitor coverage" description="Newest first." count={rows.length} testId="competitors">
        {rows.length === 0 ? (
          <EmptyState>No competitor videos logged. Search YouTube, TikTok and Instagram for the story and log what is already out there.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Video</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead>Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} data-testid="competitor">
                  <TableCell className="max-w-[26rem] min-w-56 align-top whitespace-normal">
                    {c.url ? <ExternalUrl url={c.url} label={c.title ?? undefined} /> : <span className="text-xs">{c.title}</span>}
                    {c.content ? <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{c.content}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Provenance item={c} />
                      <ItemActions itemId={c.id} type="competitor" value={toItemFormValue(c)} sources={sources} noun="competitor video" />
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-xs">{c.meta.channel ?? "—"}</TableCell>
                  <TableCell className="align-top text-xs">{c.meta.platform ? platformLabel(c.meta.platform) : "—"}</TableCell>
                  <TableCell className="text-right align-top text-xs tabular">{formatCount(c.meta.views)}</TableCell>
                  <TableCell className="align-top text-xs text-muted-foreground">{c.occurredAt ? formatResearchDate(c.occurredAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function QuestionsPanel({ ws, sources }: PanelProps) {
  const open = ws.items.question.filter((q) => !q.meta.answered);
  const answered = ws.items.question.filter((q) => q.meta.answered);
  return (
    <div className="grid gap-4">
      <SectionCard title="Add a question" description="What still has to be found out or verified before the script.">
        <NewItemForm opportunityId={ws.opportunity.id} type="question" sources={sources} />
      </SectionCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Open" count={open.length} testId="open-questions">
          {open.length === 0 ? (
            <EmptyState>No open questions. Unverifiable points from the AI research assist also land here.</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {open.map((q) => (
                <li key={q.id} className="grid gap-1.5 rounded-md border px-3 py-2" data-testid="question" data-answered="false">
                  <p className="flex items-start gap-1.5 text-[13px]">
                    <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                    <span className="sr-only">Open question: </span>
                    {q.content}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Provenance item={q} />
                    <ItemActions itemId={q.id} type="question" value={toItemFormValue(q)} sources={sources} noun="question" />
                  </div>
                  <AnswerQuestionForm itemId={q.id} answered={false} answer={q.meta.answer} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Answered" count={answered.length} testId="answered-questions">
          {answered.length === 0 ? (
            <EmptyState>Nothing answered yet.</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {answered.map((q) => (
                <li key={q.id} className="grid gap-1 rounded-md border px-3 py-2" data-testid="question" data-answered="true">
                  <p className="flex items-start gap-1.5 text-[13px]">
                    <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                    <span className="sr-only">Answered question: </span>
                    {q.content}
                  </p>
                  <p className="text-xs whitespace-pre-line text-muted-foreground">{q.meta.answer}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {q.meta.answeredAt ? <span>Answered {formatRelative(q.meta.answeredAt)}</span> : null}
                    <Provenance item={q} />
                    <AnswerQuestionForm itemId={q.id} answered answer={q.meta.answer} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function NotesPanel({ ws, sources }: PanelProps) {
  const notes = ws.items.note;
  const context = ws.items.context;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid min-w-0 content-start gap-4">
        <SectionCard title="Add a note" description="Working notes for the team (not facts: claims go in the Claims tab).">
          <NewItemForm opportunityId={ws.opportunity.id} type="note" sources={sources} />
        </SectionCard>
        <SectionCard title="Notes" count={notes.length} testId="notes">
          {notes.length === 0 ? (
            <EmptyState>No notes yet.</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border px-3 py-2">
                  {n.title ? <p className="text-[13px] font-medium">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-line">{n.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>Updated {formatRelative(n.updatedAt)}</span>
                    <Provenance item={n} />
                    <ItemActions itemId={n.id} type="note" value={toItemFormValue(n)} sources={sources} noun="note" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <SectionCard title="Add context" description="Background that helps tell the story: history, standings, rivalry, rules.">
          <NewItemForm opportunityId={ws.opportunity.id} type="context" sources={sources} />
        </SectionCard>
        <SectionCard title="Context" count={context.length} testId="context">
          {context.length === 0 ? (
            <EmptyState>No context yet. Add background from the sources, or let the AI research assist draft it from them.</EmptyState>
          ) : (
            <ul className="grid gap-3">
              {context.map((c) => (
                <li key={c.id} className="rounded-md border px-3 py-2">
                  {c.title ? <p className="text-[13px] font-medium">{c.title}</p> : null}
                  <p className="text-xs whitespace-pre-line">{c.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Attribution item={c} />
                    <Provenance item={c} />
                    <ItemActions itemId={c.id} type="context" value={toItemFormValue(c)} sources={sources} noun="context note" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          AI-drafted context always cites a workspace source; anything the sources do not say becomes an open question instead.
        </p>
      </div>
    </div>
  );
}
