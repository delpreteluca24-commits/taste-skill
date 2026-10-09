import { Skeleton } from "@/components/ui/skeleton";
import { CONTENT_STAGE_ORDER } from "@/lib/content/stages";

/** Kanban skeleton: same column widths as the board, so nothing jumps when it loads. */
export default function Loading() {
  return (
    <div className="grid min-w-0 gap-4" aria-busy="true" aria-label="Loading content pipeline">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-11" />
      <div className="-mx-3 overflow-x-hidden px-3 md:-mx-5 md:px-5">
        <div className="flex w-max gap-3">
          {CONTENT_STAGE_ORDER.map((stage, i) => (
            <div key={stage} className="grid w-[min(17rem,82vw)] shrink-0 content-start gap-2 rounded-lg border bg-card/40 p-2">
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: Math.max(1, 3 - (i % 3)) }, (_, n) => (
                <Skeleton key={n} className="h-24" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
