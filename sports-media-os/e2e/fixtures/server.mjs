// Serves the E2E RSS fixture on 127.0.0.1 (the worker runs with ALLOW_PRIVATE_FETCH=1 in E2E only).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.FIXTURE_PORT ?? 3199);
const template = readFileSync(new URL("./feed.xml", import.meta.url), "utf8");

createServer((req, res) => {
  if (req.url === "/health") return res.writeHead(200).end("ok");
  if (req.url?.startsWith("/feed.xml")) {
    const now = Date.now();
    const body = template
      .replaceAll("__NOW_MINUS_1H__", new Date(now - 3_600_000).toUTCString())
      .replaceAll("__NOW_MINUS_2H__", new Date(now - 7_200_000).toUTCString())
      .replaceAll("__NOW_MINUS_3H__", new Date(now - 10_800_000).toUTCString());
    return res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" }).end(body);
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1");
