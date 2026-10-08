/** Routes reachable without a session. Everything else requires login. */
const PUBLIC_PATHS = ["/login", "/api/health"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Sanitize a post-login redirect target: only same-origin absolute paths.
 * Blocks open redirects such as `//evil.com` or `https://evil.com`.
 */
export function safeRedirectPath(target: unknown, fallback = "/dashboard"): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(target)) return fallback;
  if (isPublicPath(target)) return fallback;
  return target;
}
