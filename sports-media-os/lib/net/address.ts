/**
 * Pure address/URL policy for server-side fetches of USER-PROVIDED URLs (SSRF
 * defense). No I/O here: lib/net/safe-fetch.ts applies the same policy at
 * connect time to every address DNS returns, so DNS rebinding cannot bypass it.
 *
 * Address classes:
 *   public   → reachable on the internet: allowed
 *   private  → loopback, RFC 1918, CGNAT, IPv6 ULA: blocked, unless the dev-only
 *              ALLOW_PRIVATE_FETCH=1 flag is on (e.g. a feed served from localhost)
 *   reserved → link-local (incl. cloud metadata 169.254.169.254), "this network",
 *              multicast, documentation/benchmark ranges, 6to4/Teredo…: ALWAYS blocked
 *   invalid  → not a canonical IP literal: blocked (fail closed)
 */
export type IpClass = "public" | "private" | "reserved" | "invalid";

export type NetworkPolicy = {
  /** dev only: also allow the "private" class. Never relaxes "reserved". */
  allowPrivateNetwork?: boolean;
};

/**
 * ALLOW_PRIVATE_FETCH=1 — LOCAL DEVELOPMENT ONLY (default off, ignored when
 * NODE_ENV=production): also allow the "private" class, e.g. a feed served from
 * localhost. Read on every call so tests can toggle it.
 */
export function privateNetworkAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_FETCH === "1" && process.env.NODE_ENV !== "production";
}

export function currentNetworkPolicy(): NetworkPolicy {
  return { allowPrivateNetwork: privateNetworkAllowed() };
}

/** Max URL length accepted for fetching (matches the DB url check). */
export const MAX_FETCH_URL_LENGTH = 2048;

/** Canonical dotted-quad IPv4 → 32-bit number; anything else (octal, short forms) → null. */
export function parseIPv4(input: string): number | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** IPv6 (optionally with an embedded dotted IPv4 tail, without zone id) → 8 groups; invalid → null. */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.includes("%")) return null; // zone ids only exist on link-local addresses: reject
  if (!/^[0-9a-f:.]+$/.test(s)) return null;

  // embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) → two trailing groups
  let tail: number[] = [];
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIPv4(s.slice(lastColon + 1));
    if (ipv4 === null) return null;
    tail = [Math.floor(ipv4 / 65536), ipv4 % 65536];
    s = s.slice(0, lastColon + 1); // "::ffff:" / "64:ff9b::" / "1:2:3:4:5:6:"
    if (!s.endsWith("::")) s = s.slice(0, -1);
  }

  const doubleColon = s.indexOf("::");
  if (doubleColon !== s.lastIndexOf("::")) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const expected = 8 - tail.length;
  let groups: number[];
  if (doubleColon >= 0) {
    const head = parseGroups(s.slice(0, doubleColon));
    const rest = parseGroups(s.slice(doubleColon + 2));
    if (!head || !rest) return null;
    const missing = expected - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    const all = parseGroups(s);
    if (!all || all.length !== expected) return null;
    groups = all;
  }
  return [...groups, ...tail];
}

const v4 = (a: number, b: number, c: number, d: number) => ((a * 256 + b) * 256 + c) * 256 + d;
const inV4 = (ip: number, base: number, bits: number) => {
  const size = 2 ** (32 - bits);
  return ip >= base && ip < base + size;
};

/** Ranges that are never fetched (link-local/metadata, multicast, documentation…). */
const V4_RESERVED: Array<[number, number]> = [
  [v4(0, 0, 0, 0), 8], // "this network"
  [v4(169, 254, 0, 0), 16], // link-local, cloud metadata (169.254.169.254, 169.254.170.2)
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments (incl. Oracle metadata 192.0.0.192)
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved + broadcast
];

/** Non-public but "local network" ranges (relaxable for local development only). */
const V4_PRIVATE: Array<[number, number]> = [
  [v4(10, 0, 0, 0), 8],
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(172, 16, 0, 0), 12],
  [v4(192, 168, 0, 0), 16],
];

/** Known metadata endpoints inside otherwise "private" ranges: always reserved. */
const V4_METADATA = new Set([v4(100, 100, 100, 200)]); // Alibaba Cloud

function classifyV4(ip: number): IpClass {
  if (V4_METADATA.has(ip)) return "reserved";
  if (V4_RESERVED.some(([base, bits]) => inV4(ip, base, bits))) return "reserved";
  if (V4_PRIVATE.some(([base, bits]) => inV4(ip, base, bits))) return "private";
  return "public";
}

function classifyV6(g: number[]): IpClass {
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const embeddedV4 = () => g[6] * 65536 + g[7];

  if (zeros(0, 8)) return "reserved"; // :: unspecified
  if (zeros(0, 7) && g[7] === 1) return "private"; // ::1 loopback
  if (zeros(0, 5) && g[5] === 0xffff) return classifyV4(embeddedV4()); // ::ffff:a.b.c.d mapped
  if (zeros(0, 6)) return "reserved"; // ::a.b.c.d IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return classifyV4(embeddedV4()); // NAT64 well-known prefix
  // AWS IMDS over IPv6 lives in ULA space: always reserved
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && zeros(2, 7) && g[7] === 0x254) return "reserved";
  if ((g[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique local
  if ((g[0] & 0xe000) !== 0x2000) return "reserved"; // outside 2000::/3 global unicast (fe80::/10, ff00::/8, fec0::/10, 100::/64…)
  if (g[0] === 0x2001 && g[1] < 0x0200) return "reserved"; // 2001::/23 IETF special (Teredo, ORCHID, benchmarking)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return "reserved"; // documentation
  if (g[0] === 0x2002) return "reserved"; // 6to4 (embeds arbitrary IPv4)
  if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return "reserved"; // 3fff::/20 documentation
  return "public";
}

/** Classifies an IP literal (IPv4 dotted quad or IPv6, brackets allowed). */
export function classifyIp(address: string): IpClass {
  const trimmed = address.trim();
  const asV4 = parseIPv4(trimmed);
  if (asV4 !== null) return classifyV4(asV4);
  const asV6 = parseIPv6(trimmed);
  if (asV6 !== null) return classifyV6(asV6);
  return "invalid";
}

/** True only for globally reachable unicast addresses. */
export function isPublicIp(address: string): boolean {
  return classifyIp(address) === "public";
}

/** Policy check applied to every resolved address before connecting. */
export function isAllowedAddress(address: string, policy: NetworkPolicy = {}): boolean {
  const c = classifyIp(address);
  return c === "public" || (c === "private" && policy.allowPrivateNetwork === true);
}

export function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;
}

/** Hostnames that always point at the local machine or a metadata service. */
const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);
const METADATA_HOSTNAMES = new Set(["metadata", "metadata.google.internal", "instance-data", "instance-data.ec2.internal"]);

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Static checks before any network I/O: scheme, credentials, length, and the
 * host when it is an IP literal or a well-known local/metadata name. Hostnames
 * are resolved and checked again at connect time by safeFetch.
 */
export function validateFetchUrl(input: string | URL, policy: NetworkPolicy = {}): UrlCheck {
  const raw = typeof input === "string" ? input.trim() : input.href;
  if (raw.length === 0) return { ok: false, reason: "URL is empty" };
  if (raw.length > MAX_FETCH_URL_LENGTH) return { ok: false, reason: `URL is longer than ${MAX_FETCH_URL_LENGTH} characters` };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https URLs can be fetched" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL are not allowed" };
  }

  // WHATWG URL already normalizes 0x7f.1 / 2130706433 / 127.1 → 127.0.0.1 for http(s)
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "URL has no host" };

  if (isIpLiteral(host)) {
    if (!isAllowedAddress(host, policy)) {
      return { ok: false, reason: `Address ${host} is not a public internet address` };
    }
    return { ok: true, url };
  }

  if (METADATA_HOSTNAMES.has(host)) return { ok: false, reason: `Host ${host} is a cloud metadata service` };
  if ((LOCAL_HOSTNAMES.has(host) || host.endsWith(".localhost")) && !policy.allowPrivateNetwork) {
    return { ok: false, reason: `Host ${host} points to this machine` };
  }
  return { ok: true, url };
}
