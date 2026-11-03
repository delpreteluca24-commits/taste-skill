import "server-only";

/**
 * UI_MODE=simple shows one page ("Oggi") plus Settings; every advanced module
 * stays reachable from Settings → Strumenti avanzati. Default: full app.
 */
export function simpleMode(): boolean {
  return process.env.UI_MODE?.trim().toLowerCase() === "simple";
}
