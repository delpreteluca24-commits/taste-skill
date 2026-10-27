"use client";

import { startTransition, useMemo, useOptimistic, useState, type DragEvent } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRightLeft, GripVertical, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveContentItem } from "@/lib/content/actions";
import { applyMove, cardView, groupByStage, stageGate, type BoardItem, type MoveRequest } from "@/lib/content/board";
import { CONTENT_STAGE_ORDER, STAGE_LABELS, type ContentStage } from "@/lib/content/stages";
import { cn } from "@/lib/utils";

import {
  BlockersBadge,
  FormatBadge,
  GateMarker,
  OpportunityScoreChip,
  ScriptStateBadge,
  STAGE_ICONS,
  StageAgeLabel,
} from "./badges";

const DRAG_TYPE = "application/x-content-item";

const EMPTY_HINT: Record<ContentStage, string> = {
  idea: "Add an idea above, or drop a card here.",
  research: "Items from approved opportunities start here.",
  script: "Drop a card here.",
  review: "Drop a card here.",
  production: "Needs an approved current script.",
  ready: "Needs approved script, confirmed claims, cleared clips.",
  scheduled: "Drop a READY card here.",
  published: "Marked by a person; nothing is auto-published.",
  analyzing: "Drop a published card here.",
};

type MoveError = { itemId: string; title: string; stage: ContentStage; message: string };
type DropTarget = { stage: ContentStage; index: number };

/**
 * Content Kanban. Native HTML5 drag & drop with an optimistic move: the card
 * lands on the current frame, the server action writes it, and the database
 * gates decide. A refusal rolls the card back and explains why inline. Every
 * card also has a keyboard-accessible "Move to…" menu (touch devices too).
 */
export function KanbanBoard({ items, generatedAt, threshold }: { items: BoardItem[]; generatedAt: string; threshold: number }) {
  const now = useMemo(() => new Date(generatedAt), [generatedAt]);
  const [optimisticItems, applyOptimisticMove] = useOptimistic(items, (current: BoardItem[], move: MoveRequest) =>
    applyMove(current, move, generatedAt),
  );
  const [error, setError] = useState<MoveError | null>(null);
  const [notice, setNotice] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const columns = useMemo(() => groupByStage(optimisticItems), [optimisticItems]);

  function requestMove(id: string, stage: ContentStage, index?: number) {
    const item = optimisticItems.find((i) => i.id === id);
    if (!item || item.pending) return;
    if (item.stage === stage) {
      const current = columns.find((c) => c.stage === stage)?.items.findIndex((i) => i.id === id) ?? -1;
      if (index === undefined || index === current) return; // dropped where it already is
    }
    setError(null);
    setNotice("");
    startTransition(async () => {
      applyOptimisticMove({ id, stage, index });
      const res = await moveContentItem({ id, stage, index });
      // outside the optimistic update on purpose: shown immediately, kept after the rollback
      if (!res.ok) setError({ itemId: id, title: item.title, stage, message: res.error });
      else setNotice(`${item.title}: ${res.message ?? `moved to ${STAGE_LABELS[stage]}`}`);
    });
  }

  function dropIndex(e: DragEvent<HTMLElement>): number {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card-id]")).filter((el) => el.dataset.cardId !== dragId);
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return cards.length;
  }

  function onDragOver(stage: ContentStage, e: DragEvent<HTMLElement>) {
    if (!dragId) return; // only cards of this board
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = dropIndex(e);
    setTarget((prev) => (prev && prev.stage === stage && prev.index === index ? prev : { stage, index }));
  }

  function onDragLeave(e: DragEvent<HTMLElement>) {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setTarget(null);
  }

  function onDrop(stage: ContentStage, e: DragEvent<HTMLElement>) {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
    const index = dropIndex(e);
    setDragId(null);
    setTarget(null);
    if (id) requestMove(id, stage, index);
  }

  return (
    <div className="grid min-w-0 gap-3">
      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="move-error">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              “{error.title}” stayed in place — move to {STAGE_LABELS[error.stage]} refused.
            </span>{" "}
            {error.message}{" "}
            <Link href={`/content/${error.itemId}`} className="underline underline-offset-2">
              Open item
            </Link>
          </span>
          <button type="button" onClick={() => setError(null)} className="rounded p-0.5 hover:bg-danger/15" aria-label="Dismiss">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <div
        role="region"
        aria-label="Content pipeline, scrolls horizontally"
        tabIndex={0}
        className="-mx-3 overflow-x-auto px-3 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:-mx-5 md:px-5"
        data-testid="kanban"
      >
        <div className="flex w-max items-stretch gap-3">
          {columns.map((col) => {
            const Icon = STAGE_ICONS[col.stage];
            const gate = stageGate(col.stage);
            const isTarget = target?.stage === col.stage;
            // drop slots count the cards that stay (the dragged one is excluded, like on the server)
            const slotOf = new Map<string, number>();
            for (const item of col.items) if (item.id !== dragId) slotOf.set(item.id, slotOf.size);
            const endSlot = slotOf.size;
            return (
              <section
                key={col.stage}
                aria-labelledby={`col-${col.stage}`}
                className={cn(
                  "flex w-[min(17rem,82vw)] shrink-0 flex-col rounded-lg border bg-card/40 transition-colors",
                  isTarget && "border-brand/60 bg-brand/5",
                )}
                data-testid={`column-${col.stage}`}
                data-count={col.items.length}
              >
                <header className="flex items-center gap-2 border-b px-3 py-2">
                  <Icon className="size-3.5 text-brand" aria-hidden />
                  <h2 id={`col-${col.stage}`} className="text-[12px] font-semibold tracking-wide uppercase">
                    {col.label}
                  </h2>
                  <span className="rounded border px-1.5 text-[11px] text-muted-foreground tabular" aria-label={`${col.items.length} items`}>
                    {col.items.length}
                  </span>
                  {gate ? (
                    <span className="ml-auto">
                      <GateMarker label={col.stage === "production" ? "script gate" : col.stage === "ready" ? "ready gate" : "gated"} title={gate} />
                    </span>
                  ) : null}
                </header>
                <ol
                  className="flex min-h-28 flex-1 flex-col gap-2 p-2"
                  onDragOver={(e) => onDragOver(col.stage, e)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(col.stage, e)}
                >
                  {col.items.map((item) => {
                    const indicator = isTarget && target!.index === slotOf.get(item.id);
                    return (
                      <CardSlot key={item.id} indicator={indicator}>
                        <KanbanCard
                          item={item}
                          now={now}
                          threshold={threshold}
                          dragging={dragId === item.id}
                          error={error?.itemId === item.id ? error.message : null}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE, item.id);
                            e.dataTransfer.setData("text/plain", item.title);
                            e.dataTransfer.effectAllowed = "move";
                            setDragId(item.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setTarget(null);
                          }}
                          onMove={(stage) => requestMove(item.id, stage)}
                        />
                      </CardSlot>
                    );
                  })}
                  {isTarget && target!.index === endSlot ? <DropIndicator /> : null}
                  {col.items.length === 0 ? (
                    <li className="rounded-md border border-dashed px-2 py-5 text-center text-[11px] text-muted-foreground">{EMPTY_HINT[col.stage]}</li>
                  ) : null}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DropIndicator() {
  return <li aria-hidden className="h-0.5 shrink-0 rounded-full bg-brand" />;
}

function CardSlot({ indicator, children }: { indicator: boolean; children: React.ReactNode }) {
  return (
    <>
      {indicator ? <DropIndicator /> : null}
      {children}
    </>
  );
}

function KanbanCard({
  item,
  now,
  threshold,
  dragging,
  error,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  item: BoardItem;
  now: Date;
  threshold: number;
  dragging: boolean;
  error: string | null;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onMove: (stage: ContentStage) => void;
}) {
  const v = cardView(item, now);
  const errorId = `move-error-${item.id}`;
  return (
    <li
      data-card-id={item.id}
      data-testid="content-card"
      data-stage={item.stage}
      draggable={!v.pending}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={v.pending || undefined}
      aria-describedby={error ? errorId : undefined}
      className={cn(
        "group rounded-md border bg-card p-2.5 shadow-xs transition-opacity",
        dragging && "opacity-40",
        v.pending && "opacity-70",
        error && "border-danger/50",
      )}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground" aria-hidden />
        <Link href={v.href} draggable={false} className="line-clamp-3 min-w-0 flex-1 text-[13px] leading-snug font-medium hover:underline">
          {v.title}
        </Link>
        <MoveMenu title={v.title} stage={v.stage} disabled={v.pending} onMove={onMove} />
      </div>
      {v.opportunityTitle ? (
        <p className="mt-1 truncate pl-4.5 text-[11px] text-muted-foreground" title={`Opportunity: ${v.opportunityTitle}`}>
          {v.opportunityTitle}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <FormatBadge format={v.format} />
        {item.opportunityId ? <OpportunityScoreChip score={v.opportunityScore} threshold={threshold} /> : null}
        <ScriptStateBadge state={v.script} />
        {v.blockerCount !== null ? <BlockersBadge count={v.blockerCount} blockers={v.blockers} /> : null}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <StageAgeLabel age={v.age} />
        {v.pending ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Saving…
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Keyboard / touch fallback for drag & drop: pick the target stage (end of its column). */
function MoveMenu({ title, stage, disabled, onMove }: { title: string; stage: ContentStage; disabled: boolean; onMove: (stage: ContentStage) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 size-7 shrink-0 text-muted-foreground" disabled={disabled} data-testid="move-menu">
          <ArrowRightLeft className="size-3.5" aria-hidden />
          <span className="sr-only">Move “{title}” to…</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs">Move to…</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={stage} onValueChange={(next) => onMove(next as ContentStage)}>
          {CONTENT_STAGE_ORDER.map((s) => {
            const Icon = STAGE_ICONS[s];
            return (
              <DropdownMenuRadioItem key={s} value={s} className="text-xs" disabled={s === stage}>
                <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                {STAGE_LABELS[s]}
                {s === stage ? <span className="ml-auto text-[10px] text-muted-foreground">current</span> : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
