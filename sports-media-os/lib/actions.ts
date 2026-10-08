/**
 * Uniform result for server actions, consumed by `useActionState` forms.
 * Errors are user-safe strings; details go to server logs, never to the client.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export type FormState<T = undefined> = ActionResult<T> | null;

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string[] | undefined>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}
