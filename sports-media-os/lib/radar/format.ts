/**
 * Display helpers for the radar and trends pages. Times are shown in the
 * PROJECT timezone (the editorial clock), never the server's.
 */

/** "Thu 8 Oct, 20:45" in `tz`; "—" when missing or invalid */
export function formatDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  try {
    return new Date(t).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

/** "in 3h" / "2h ago" / "in 2d" relative to `now` (coarse, for event rows) */
export function formatCountdown(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = t - now.getTime();
  const abs = Math.abs(diff);
  const unit = abs < 3_600_000 ? `${Math.max(1, Math.round(abs / 60_000))}m` : abs < 172_800_000 ? `${Math.round(abs / 3_600_000)}h` : `${Math.round(abs / 86_400_000)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

/** Host of a URL for display ("www.example.com" → "example.com"). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** signed velocity in sources per hour ("+0.33/h", "−0.5/h", "0/h") */
export function formatVelocity(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Math.round(Number(v) * 100) / 100;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}/h`;
}

const AI_STATUS: Record<string, string> = {
  labelled: "AI titles applied",
  not_configured: "AI titles off (no model configured)",
  failed: "AI titles failed, auto titles kept",
  skipped: "no new titles needed",
};

/**
 * One line about the last trends.detect run from its stored job result
 * ("42 sources scanned · 3 new trends · 5 updated · 2 sweet spots · AI titles applied").
 * Defensive: the result is JSON written by the worker.
 */
export function summarizeDetection(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (r.skipped === true) return "skipped: another detection was running";
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);
  const parts: string[] = [];
  const scanned = n("sourcesScanned");
  if (scanned !== null) parts.push(`${scanned} sources scanned`);
  const createdCount = n("trendsCreated");
  if (createdCount !== null) parts.push(`${createdCount} new trend${createdCount === 1 ? "" : "s"}`);
  const updated = n("trendsUpdated");
  if (updated !== null) parts.push(`${updated} updated`);
  const expired = n("trendsExpired");
  if (expired) parts.push(`${expired} expired`);
  const sweet = n("sweetSpots");
  if (sweet !== null) parts.push(`${sweet} sweet spot${sweet === 1 ? "" : "s"}`);
  const ai = r.ai && typeof r.ai === "object" ? (r.ai as Record<string, unknown>) : null;
  if (ai && typeof ai.status === "string" && AI_STATUS[ai.status]) {
    const labelled = typeof ai.labelled === "number" && ai.status === "labelled" ? ` (${ai.labelled})` : "";
    parts.push(`${AI_STATUS[ai.status]}${labelled}`);
  }
  return parts.length ? parts.join(" · ") : null;
}
