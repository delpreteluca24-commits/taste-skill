import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { decodeBody, safeFetch, SafeFetchError, type Resolver } from "@/lib/net/safe-fetch";

/**
 * safeFetch against a real local HTTP server. Loopback is blocked by default,
 * so most tests run with the dev flag ALLOW_PRIVATE_FETCH=1 (honored outside
 * production only); the policy tests turn it off.
 */
let server: http.Server;
let base = "";
let lastHeaders: http.IncomingHttpHeaders = {};
let hits = 0;

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title></channel></rss>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    lastHeaders = req.headers;
    const url = new URL(req.url ?? "/", "http://localhost");
    switch (url.pathname) {
      case "/feed":
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8", etag: '"v1"' });
        res.end(RSS);
        return;
      case "/conditional":
        if (req.headers["if-none-match"] === '"v1"' || req.headers["if-modified-since"] === "Tue, 07 Oct 2026 10:00:00 GMT") {
          res.writeHead(304, { etag: '"v1"' });
          res.end();
          return;
        }
        res.writeHead(200, { etag: '"v1"', "last-modified": "Tue, 07 Oct 2026 10:00:00 GMT" });
        res.end(RSS);
        return;
      case "/gzip":
        res.writeHead(200, { "content-encoding": "gzip" });
        res.end(zlib.gzipSync(RSS));
        return;
      case "/deflate":
        res.writeHead(200, { "content-encoding": "deflate" });
        res.end(zlib.deflateSync(RSS));
        return;
      case "/deflate-raw":
        res.writeHead(200, { "content-encoding": "deflate" });
        res.end(zlib.deflateRawSync(RSS));
        return;
      case "/br":
        res.writeHead(200, { "content-encoding": "br" });
        res.end(zlib.brotliCompressSync(RSS));
        return;
      case "/bomb":
        // 10 MB of zeros compress to ~10 KB
        res.writeHead(200, { "content-encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.alloc(10 * 1024 * 1024)));
        return;
      case "/big":
        res.writeHead(200, { "content-length": String(3 * 1024 * 1024) });
        res.end(Buffer.alloc(3 * 1024 * 1024, 0x61));
        return;
      case "/stream-big": {
        // no content-length: the cap must trigger while streaming
        res.writeHead(200);
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let sent = 0;
        const pump = () => {
          while (sent < 4 * 1024 * 1024) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once("drain", pump);
          }
          res.end();
        };
        pump();
        return;
      }
      case "/slow":
        setTimeout(() => {
          res.writeHead(200);
          res.end("late");
        }, 1500);
        return;
      case "/latin1":
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(Buffer.concat([Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><t>'), Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]), Buffer.from("</t>")]));
        return;
      case "/redirect": {
        const n = Number(url.searchParams.get("n") ?? 1);
        res.writeHead(302, { location: n > 1 ? `/redirect?n=${n - 1}` : "/feed" });
        res.end();
        return;
      }
      case "/redirect-metadata":
        res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      case "/redirect-file":
        res.writeHead(302, { location: "file:///etc/passwd" });
        res.end();
        return;
      case "/redirect-mapped":
        res.writeHead(307, { location: "http://[::ffff:a9fe:a9fe]/" });
        res.end();
        return;
      default:
        res.writeHead(404);
        res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const devFlag = (on: boolean) => {
  if (on) process.env.ALLOW_PRIVATE_FETCH = "1";
  else delete process.env.ALLOW_PRIVATE_FETCH;
};
afterEach(() => devFlag(false));

async function fetchError(promise: Promise<unknown>): Promise<SafeFetchError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(SafeFetchError);
    return e as SafeFetchError;
  }
  throw new Error("expected safeFetch to fail");
}

describe("safeFetch — transport", () => {
  it("returns status, headers, decoded body and final URL", async () => {
    devFlag(true);
    const res = await safeFetch(`${base}/feed`, { accept: "application/rss+xml" });
    expect(res).toMatchObject({ status: 200, ok: true, notModified: false, finalUrl: `${base}/feed`, redirects: 0 });
    expect(res.body).toBe(RSS);
    expect(res.headers.etag).toBe('"v1"');
    expect(lastHeaders["accept"]).toBe("application/rss+xml");
    expect(lastHeaders["accept-encoding"]).toMatch(/gzip/);
    expect(lastHeaders["user-agent"]).toMatch(/SportsMediaOS/);
    expect(lastHeaders["cookie"]).toBeUndefined();
  });

  it("decompresses gzip, deflate (zlib and raw) and brotli", async () => {
    devFlag(true);
    for (const path of ["/gzip", "/deflate", "/deflate-raw", "/br"]) {
      const res = await safeFetch(`${base}${path}`);
      expect(res.body, path).toBe(RSS);
    }
  });

  it("sends conditional headers and reports 304 Not Modified", async () => {
    devFlag(true);
    const first = await safeFetch(`${base}/conditional`);
    expect(first.status).toBe(200);
    const byEtag = await safeFetch(`${base}/conditional`, { etag: first.headers.etag });
    expect(byEtag).toMatchObject({ status: 304, notModified: true, body: "" });
    expect(lastHeaders["if-none-match"]).toBe('"v1"');
    const byDate = await safeFetch(`${base}/conditional`, { lastModified: first.headers["last-modified"] });
    expect(byDate.notModified).toBe(true);
    expect(lastHeaders["if-modified-since"]).toBe("Tue, 07 Oct 2026 10:00:00 GMT");
  });

  it("decodes the charset declared by the XML prolog", async () => {
    devFlag(true);
    const res = await safeFetch(`${base}/latin1`);
    expect(res.body).toContain("<t>Müller</t>");
  });

  it("returns non-2xx responses for the caller to judge", async () => {
    devFlag(true);
    const res = await safeFetch(`${base}/missing`);
    expect(res).toMatchObject({ status: 404, ok: false, body: "not found" });
  });
});

describe("safeFetch — limits", () => {
  it("rejects a declared body above the cap", async () => {
    devFlag(true);
    const e = await fetchError(safeFetch(`${base}/big`));
    expect(e.code).toBe("too_large");
    expect(e.retryable).toBe(false);
  });

  it("aborts a streamed body once it passes the cap", async () => {
    devFlag(true);
    const e = await fetchError(safeFetch(`${base}/stream-big`, { maxBytes: 512 * 1024 }));
    expect(e.code).toBe("too_large");
  });

  it("caps the DECOMPRESSED size (zip bomb)", async () => {
    devFlag(true);
    const e = await fetchError(safeFetch(`${base}/bomb`));
    expect(e.code).toBe("too_large");
  });

  it("times out slow servers (retryable)", async () => {
    devFlag(true);
    const e = await fetchError(safeFetch(`${base}/slow`, { timeoutMs: 200 }));
    expect(e.code).toBe("timeout");
    expect(e.retryable).toBe(true);
  });
});

describe("safeFetch — redirects", () => {
  it("follows up to 3 redirects", async () => {
    devFlag(true);
    const res = await safeFetch(`${base}/redirect?n=3`);
    expect(res).toMatchObject({ status: 200, redirects: 3, finalUrl: `${base}/feed` });
  });

  it("refuses a 4th redirect", async () => {
    devFlag(true);
    const e = await fetchError(safeFetch(`${base}/redirect?n=4`));
    expect(e.code).toBe("too_many_redirects");
  });

  it("re-validates every redirect target (metadata, mapped IPv6, non-http)", async () => {
    devFlag(true); // even the dev flag never allows link-local / metadata
    const before = hits;
    expect((await fetchError(safeFetch(`${base}/redirect-metadata`))).code).toBe("blocked_url");
    expect((await fetchError(safeFetch(`${base}/redirect-mapped`))).code).toBe("blocked_url");
    expect((await fetchError(safeFetch(`${base}/redirect-file`))).code).toBe("blocked_url");
    expect(hits - before).toBe(3); // only the redirecting requests reached a server
  });
});

describe("safeFetch — SSRF policy (dev flag off)", () => {
  it("blocks loopback IP literals before connecting", async () => {
    const before = hits;
    const e = await fetchError(safeFetch(`${base}/feed`));
    expect(e.code).toBe("blocked_url");
    expect(hits).toBe(before);
  });

  it("blocks localhost-style names without resolving them", async () => {
    const port = (server.address() as AddressInfo).port;
    const before = hits;
    expect((await fetchError(safeFetch(`http://localhost:${port}/feed`))).code).toBe("blocked_url");
    expect((await fetchError(safeFetch(`http://feed.localhost:${port}/feed`))).code).toBe("blocked_url");
    expect(hits).toBe(before);
  });

  it("checks the address the socket connects to (DNS rebinding cannot bypass it)", async () => {
    const port = (server.address() as AddressInfo).port;
    const lookups: string[] = [];
    // an attacker-controlled name whose DNS answer is loopback at connect time
    const rebinding: Resolver = async (hostname) => {
      lookups.push(hostname);
      return [{ address: "127.0.0.1", family: 4 }];
    };
    const before = hits;
    const e = await fetchError(safeFetch(`http://rebind.example.test:${port}/feed`, { resolve: rebinding }));
    expect(e.code).toBe("blocked_address");
    expect(e.message).toMatch(/127\.0\.0\.1/);
    // exactly one resolution — the connect-time one — and no connection was made
    expect(lookups).toEqual(["rebind.example.test"]);
    expect(hits).toBe(before);

    // same resolver with the dev flag: the socket really uses the checked answer
    devFlag(true);
    const res = await safeFetch(`http://rebind.example.test:${port}/feed`, { resolve: rebinding });
    expect(res.status).toBe(200);
    expect(lastHeaders.host).toBe(`rebind.example.test:${port}`);
    expect(lookups).toHaveLength(2);
  });

  it("re-resolves and re-checks redirect targets by name", async () => {
    devFlag(true);
    const port = (server.address() as AddressInfo).port;
    const answers: Record<string, string> = { "feed.example.test": "127.0.0.1", "evil.example.test": "169.254.169.254" };
    const resolver: Resolver = async (hostname) => [{ address: answers[hostname] ?? "203.0.113.1", family: 4 }];
    const redirecting = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://evil.example.test:${port}/feed` });
      res.end();
    });
    await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
    try {
      const redirectPort = (redirecting.address() as AddressInfo).port;
      const e = await fetchError(safeFetch(`http://feed.example.test:${redirectPort}/`, { resolve: resolver }));
      expect(e.code).toBe("blocked_address");
      expect(e.message).toMatch(/evil\.example\.test/);
    } finally {
      await new Promise<void>((resolve) => redirecting.close(() => resolve()));
    }
  });

  it("refuses a host when ANY resolved address is not public", async () => {
    const mixed: Resolver = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    const e = await fetchError(safeFetch("http://mixed.example.test/feed", { resolve: mixed }));
    expect(e.code).toBe("blocked_address");
  });

  it("allows a resolved loopback address only with the dev flag", async () => {
    devFlag(true);
    const port = (server.address() as AddressInfo).port;
    const toLoopback: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];
    const res = await safeFetch(`http://feed.example.test:${port}/feed`, { resolve: toLoopback });
    expect(res.status).toBe(200);
    expect(lastHeaders.host).toBe(`feed.example.test:${port}`);
  });

  it("never honors the dev flag in production", async () => {
    devFlag(true);
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const e = await fetchError(safeFetch(`${base}/feed`));
      expect(e.code).toBe("blocked_url");
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

describe("decodeBody", () => {
  it("prefers the Content-Type charset and strips a UTF-8 BOM", () => {
    expect(decodeBody(Buffer.from([0x4d, 0xfc]), "text/plain; charset=iso-8859-1")).toBe("Mü");
    expect(decodeBody(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<rss/>")]), undefined)).toBe("<rss/>");
    expect(decodeBody(Buffer.from("ok"), "text/plain; charset=not-a-charset")).toBe("ok");
  });
});
