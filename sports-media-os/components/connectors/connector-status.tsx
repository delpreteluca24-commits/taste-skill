import { AlertTriangle, CheckCircle2, CircleDashed, Power, PowerOff, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** Last fetch outcome — icon + label, never color alone. */
export function FetchStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="success">
          <CheckCircle2 aria-hidden />
          OK
        </Badge>
      );
    case "not_modified":
      return (
        <Badge variant="info">
          <RefreshCcw aria-hidden />
          Not modified
        </Badge>
      );
    case "error":
      return (
        <Badge variant="danger">
          <AlertTriangle aria-hidden />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          <CircleDashed aria-hidden />
          Never fetched
        </Badge>
      );
  }
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="success">
      <Power aria-hidden />
      Enabled
    </Badge>
  ) : (
    <Badge variant="outline">
      <PowerOff aria-hidden />
      Disabled
    </Badge>
  );
}

/** 15 → "15 min", 60 → "1 h", 90 → "1 h 30 min", 1440 → "24 h" */
export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
