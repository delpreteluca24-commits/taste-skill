/**
 * QA sweep: signs in like a user, opens every page (and one detail page per
 * list), and records HTTP status, the h1, console errors, uncaught page errors,
 * failed requests and a full-page screenshot.
 *
 *   BASE=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… node scripts/qa-sweep.mjs
 *
 * Output: $OUT (default /tmp/qa)/report.json + one PNG per page.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/qa";
const WIDTH = Number(process.env.WIDTH ?? 1440);
mkdirSync(OUT, { recursive: true });

const PAGES = [
  "/dashboard",
  "/radar",
  "/radar/connectors",
  "/trends",
  "/opportunities",
  "/research",
  "/rights",
  "/content",
  "/studio",
  "/calendar",
  "/analytics",
  "/agents",
  "/settings",
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
const page = await context.newPage();
const report = { base: BASE, width: WIDTH, login: null, pages: [] };

let current = null;
page.on("console", (m) => {
  if (current && m.type() === "error") current.console.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => current?.pageErrors.push(String(e).slice(0, 300)));
page.on("requestfailed", (r) => {
  const url = r.url();
  if (current && !url.includes("_next/static")) current.failed.push(`${r.failure()?.errorText} ${url.slice(0, 160)}`);
});
page.on("response", (r) => {
  if (current && r.status() >= 500) current.serverErrors.push(`${r.status()} ${r.url().slice(0, 160)}`);
});

async function visit(path, name = path) {
  current = { path, console: [], pageErrors: [], failed: [], serverErrors: [] };
  const t0 = Date.now();
  const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 60_000 }).catch((e) => ({ status: () => `ERR ${e.message}` }));
  await page.waitForTimeout(1500);
  current.status = res?.status?.();
  current.ms = Date.now() - t0;
  current.failed = current.failed.filter((f) => !f.includes("_rsc=") && !f.includes("/api/jobs/drain"));
  current.url = page.url().replace(BASE, "");
  current.h1 = (await page.locator("h1").first().textContent({ timeout: 3000 }).catch(() => null))?.trim() ?? null;
  const body = await page.locator("body").innerText().catch(() => "");
  current.errorText = /Application error|Something went wrong|Internal Server Error|Unhandled Runtime Error/i.exec(body)?.[0] ?? null;
  current.empty = /^\s*$/.test(body);
  const file = `${name.replace(/[^\w-]+/g, "_").replace(/^_/, "") || "root"}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
  current.screenshot = file;
  report.pages.push(current);
  return current;
}

// login
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => {});
report.login = page.url().includes("/login") ? `FAILED: ${(await page.locator("form").innerText()).slice(0, 200)}` : `ok → ${page.url().replace(BASE, "")}`;

if (!report.login.startsWith("FAILED")) {
  for (const p of PAGES) await visit(p);

  // one detail page per list, when data exists
  for (const [list, pattern] of [
    ["/opportunities", /^\/opportunities\/[0-9a-f-]{36}$/],
    ["/research", /^\/research\/[0-9a-f-]{36}$/],
    ["/content", /^\/content\/[0-9a-f-]{36}$/],
  ]) {
    await page.goto(BASE + list, { waitUntil: "load" });
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const href = hrefs.find((h) => h && pattern.test(h.split("?")[0]));
    if (href) await visit(href, `${list}-detail`);
    else report.pages.push({ path: `${list}/[detail]`, note: "no detail link found" });
  }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
