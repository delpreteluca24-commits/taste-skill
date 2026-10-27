"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Route-level error boundary for the app shell: the sidebar stays usable. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border bg-card p-6 text-center">
      <AlertTriangle className="mx-auto size-6 text-warning" />
      <h2 className="mt-3 text-sm font-semibold">This view failed to load</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {error.message || "Unexpected error."}
        {error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      <Button className="mt-4" size="sm" variant="outline" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
