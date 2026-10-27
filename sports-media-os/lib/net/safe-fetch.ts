import "server-only";

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { promisify } from "node:util";
import zlib from "node:zlib";

import { currentNetworkPolicy, isAllowedAddress, validateFetchUrl, type NetworkPolicy } from "./address";

export {
  classifyIp,
  currentNetworkPolicy,
  isAllowedAddress,
  isPublicIp,
  privateNetworkAllowed,
  validateFetchUrl,
  type IpClass,
  type NetworkPolicy,
} from "./address";

/**
 * SSRF-safe GET for USER-PROVIDED URLs (connectors). Used by workers only.
 *
 * - http/https only, no credentials in the URL
 * - every address DNS returns is checked AT CONNECT TIME (custom `lookup`), so a
 *   hostname that re-resolves to 127.0.0.1 / 169.254.169.254 (DNS rebinding) is refused;
 *   IP-literal hosts are checked before connecting
 * - at most 3 redirects, each target re-validated
 * - one deadline for the whole operation (default 10 s)
 * - size cap on the raw AND the decompressed body (default 2 MB) → no zip bombs
 * - gzip / deflate / br, charset from headers or the XML declaration
 * - conditional requests (If-None-Match / If-Modified-Since → 304)
 *
 * ALLOW_PRIVATE_FETCH=1 (LOCAL DEVELOPMENT ONLY, ignored when NODE_ENV=production)
 * also allows loopback / RFC 1918 / CGNAT / IPv6 ULA targets, e.g. a feed served
 * from localhost. Link-local (cloud metadata), multicast and reserved ranges stay
 * blocked even then. Default: off.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 3;
const USER_AGENT = "SportsMediaOS-Connector/1.0 (links and summaries only)";

export type SafeFetchErrorCode =
  | "blocked_url"
  | "blocked_address"
  | "too_many_redirects"
  | "timeout"
  | "too_large"
  | "network"
  | "bad_response";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  /** would the same request plausibly succeed later? (network/timeout yes, policy no) */
  readonly retryable: boolean;
  constructor(code: SafeFetchErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type SafeFetchOptions = {
  /** conditional request: previous ETag */
  etag?: string | null;
  /** conditional request: previous Last-Modified */
  lastModified?: string | null;
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** DNS seam for tests; results are still checked against the policy */
  resolve?: Resolver;
};

export type SafeFetchResponse = {
  status: number;
  ok: boolean;
  notModified: boolean;
  headers: Record<string, string>;
  /** decoded text (empty for 304) */
  body: string;
  /** URL after redirects */
  finalUrl: string;
  redirects: number;
  /** decompressed size in bytes */
  bytes: number;
};

/**
 * ETag / Last-Modified values are echoed back in later requests: keep only
 * printable ASCII of sane length (anything else would make the request throw).
 */
export function cleanValidator(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^[\x20-\x7e]{1,512}$/.test(v) ? v : null;
}

const defaultResolver: Resolver = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * `lookup` for http(s).request: resolves, refuses the WHOLE host if any answer is
 * not allowed, then hands only checked addresses to the socket. Handles both the
 * single-address and the `all: true` (autoSelectFamily) calling conventions.
 */
function guardedLookup(policy: NetworkPolicy, resolve: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((answers) => {
        if (answers.length === 0) throw new SafeFetchError("network", `DNS returned no address for ${hostname}`, true);
        const blocked = answers.find((a) => !isAllowedAddress(a.address, policy));
        if (blocked) {
          throw new SafeFetchError("blocked_address", `${hostname} resolves to a non-public address (${blocked.address})`);
        }
        const family = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = family ? answers.filter((a) => a.family === family) : answers;
        if (usable.length === 0) throw new SafeFetchError("network", `No IPv${family} address for ${hostname}`, true);
        if (options.all) callback(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      })
      .catch((e: unknown) => {
        const err = e instanceof Error ? e : new Error(String(e));
        callback(err as NodeJS.ErrnoException, "", 0);
      });
  };
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function requestOnce(
  url: URL,
  headers: Record<string, string>,
  opts: { policy: NetworkPolicy; resolve: Resolver; signal: AbortSignal; maxBytes: number },
): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers,
        agent: false, // fresh socket: never a pooled connection to a previously resolved address
        lookup: guardedLookup(opts.policy, opts.resolve),
        signal: opts.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // settle first, then tear down: later stream errors cannot change the outcome
        const abort = (error: Error) => {
          reject(error);
          req.destroy();
        };
        if (REDIRECTS.has(status) || status === 304) {
          res.resume();
          resolvePromise({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          abort(new SafeFetchError("too_large", `Response is ${declared} bytes (limit ${opts.maxBytes})`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > opts.maxBytes) abort(new SafeFetchError("too_large", `Response exceeds ${opts.maxBytes} bytes`));
          else chunks.push(chunk);
        });
        res.on("end", () => resolvePromise({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
        res.on("close", () => {
          if (!res.complete) reject(new Error("connection closed before the response completed"));
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);
const brotli = promisify(zlib.brotliDecompress);

/** Decodes Content-Encoding (possibly a list), capping the OUTPUT size. */
export async function decompress(body: Buffer, contentEncoding: string | undefined, maxBytes: number): Promise<Buffer> {
  const encodings = (contentEncoding ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e !== "identity")
    .reverse();
  let out = body;
  if (out.length === 0) return out;
  const limit = { maxOutputLength: maxBytes };
  const tooLarge = (e: unknown) => e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
  try {
    for (const encoding of encodings) {
      if (encoding === "gzip" || encoding === "x-gzip") out = await gunzip(out, limit);
      else if (encoding === "br") out = await brotli(out, limit);
      else if (encoding === "deflate") {
        // "deflate" is zlib-wrapped per spec, but some servers send raw deflate
        const input = out;
        out = await inflate(input, limit).catch((e: unknown) => (tooLarge(e) ? Promise.reject(e) : inflateRaw(input, limit)));
      } else throw new SafeFetchError("bad_response", `Unsupported content encoding "${encoding}"`);
    }
  } catch (e) {
    if (e instanceof SafeFetchError) throw e;
    if (tooLarge(e)) {
      throw new SafeFetchError("too_large", `Decompressed response exceeds ${maxBytes} bytes`);
    }
    throw new SafeFetchError("bad_response", `Could not decompress the response (${errorText(e)})`);
  }
  if (out.length > maxBytes) throw new SafeFetchError("too_large", `Decompressed response exceeds ${maxBytes} bytes`);
  return out;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 120) : "unknown error";
}

/** charset from Content-Type, else from the XML declaration, else UTF-8 (BOM aware). */
export function decodeBody(body: Buffer, contentType: string | undefined): string {
  let label = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? "")?.[1];
  if (!label) {
    const head = body.subarray(0, 200).toString("latin1");
    label = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1];
  }
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) label = "utf-8";
  try {
    return new TextDecoder(label ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || key === "set-cookie") continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** Fetches a user-provided URL under the SSRF policy. Throws SafeFetchError. */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const policy = currentNetworkPolicy();
  const resolve = options.resolve ?? defaultResolver;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: options.accept ?? "*/*",
    "accept-encoding": "gzip, deflate, br",
  };
  const etag = cleanValidator(options.etag);
  const lastModified = cleanValidator(options.lastModified);
  if (etag) headers["if-none-match"] = etag;
  if (lastModified) headers["if-modified-since"] = lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = input;
    for (let redirects = 0; ; redirects++) {
      const check = validateFetchUrl(current, policy);
      if (!check.ok) throw new SafeFetchError("blocked_url", check.reason);

      let raw: RawResponse;
      try {
        raw = await requestOnce(check.url, headers, { policy, resolve, signal: controller.signal, maxBytes });
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        if (controller.signal.aborted) throw new SafeFetchError("timeout", `Timed out after ${timeoutMs} ms`, true);
        // a SafeFetchError raised inside lookup arrives wrapped by the socket
        const cause = (e as { cause?: unknown }).cause;
        if (cause instanceof SafeFetchError) throw cause;
        throw new SafeFetchError("network", `Request failed: ${errorText(e)}`, true);
      }

      const location = raw.headers.location;
      if (REDIRECTS.has(raw.status) && location) {
        if (redirects >= maxRedirects) {
          throw new SafeFetchError("too_many_redirects", `More than ${maxRedirects} redirects`);
        }
        try {
          current = new URL(location, check.url).href;
        } catch {
          throw new SafeFetchError("bad_response", "Invalid redirect location");
        }
        continue;
      }

      const notModified = raw.status === 304;
      const decoded = notModified ? Buffer.alloc(0) : await decompress(raw.body, raw.headers["content-encoding"], maxBytes);
      return {
        status: raw.status,
        ok: raw.status >= 200 && raw.status < 300,
        notModified,
        headers: flattenHeaders(raw.headers),
        body: notModified ? "" : decodeBody(decoded, raw.headers["content-type"]),
        finalUrl: check.url.href,
        redirects,
        bytes: decoded.length,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
