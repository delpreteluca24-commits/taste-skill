/**
 * Global AI switch (no "server-only": providers and workers import it too).
 * AI_ENABLED=false turns every model call off before any network request, so
 * the app runs fully in manual mode with zero API cost.
 */
export function aiSwitchedOff(): boolean {
  return process.env.AI_ENABLED?.trim().toLowerCase() === "false";
}

export const AI_OFF_MESSAGE = "AI is off: this workspace runs in manual mode.";
