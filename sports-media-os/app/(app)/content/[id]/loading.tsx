import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid min-w-0 gap-4" aria-busy="true" aria-label="Loading content item">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-9" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-44" />
          <Skeleton className="h-56" />
        </div>
        <div className="grid content-start gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
