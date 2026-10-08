/**
 * Maps database errors to user-safe messages.
 * Business-rule guards (supabase/migrations/*_guards.sql) raise SQLSTATE P0001
 * with a stable `CODE: detail` prefix; constraint errors use standard codes.
 */
export type DbErrorLike = { code?: string; message?: string; details?: string | null } | null | undefined;

export type GuardCode =
  | "CONTENT_NOT_READY"
  | "RIGHTS_BLOCKED"
  | "PUBLISH_BLOCKED"
  | "SCRIPT_IMMUTABLE"
  | "JOB_NOT_RUNNING"
  | "JOB_NOT_CANCELLABLE"
  | "NOT_FOUND";

const GUARD_CODES: readonly GuardCode[] = [
  "CONTENT_NOT_READY",
  "RIGHTS_BLOCKED",
  "PUBLISH_BLOCKED",
  "SCRIPT_IMMUTABLE",
  "JOB_NOT_RUNNING",
  "JOB_NOT_CANCELLABLE",
  "NOT_FOUND",
];

export function parseGuardError(error: DbErrorLike): { code: GuardCode; detail: string } | null {
  if (!error?.message || error.code !== "P0001") return null;
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(error.message);
  if (!match) return null;
  const code = match[1] as GuardCode;
  if (!GUARD_CODES.includes(code)) return null;
  return { code, detail: match[2] };
}

export function toUserMessage(error: DbErrorLike, fallback = "Something went wrong. Please retry."): string {
  if (!error) return fallback;
  const guard = parseGuardError(error);
  if (guard) {
    switch (guard.code) {
      case "CONTENT_NOT_READY":
        return `Not ready: ${guard.detail}.`;
      case "RIGHTS_BLOCKED":
        return `Blocked by rights check: ${guard.detail}.`;
      case "PUBLISH_BLOCKED":
        return `Publishing blocked: ${guard.detail}.`;
      case "SCRIPT_IMMUTABLE":
        return "Script versions are read-only. Create a new version instead.";
      case "NOT_FOUND":
        return "Not found or you don't have access.";
      default:
        return guard.detail || fallback;
    }
  }
  switch (error.code) {
    case "23505":
      return "This already exists.";
    case "23503":
      return "A linked record does not exist or belongs to another project.";
    case "23514":
      return "Some values are out of the allowed range.";
    case "42501":
      return "You don't have permission to do this.";
    default:
      return fallback;
  }
}
