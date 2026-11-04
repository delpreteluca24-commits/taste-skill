/**
 * Unattended QA run: signs in like a user, visits every page (and one detail
 * page per list), maps each page's controls, and stores the report plus small
 * JPEG screenshots in public.qa_runs / public.qa_shots (service role only), so
 * results survive even if the machine running it disappears.
 *
 *   BASE=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… QA_KIND=sweep \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/qa-run.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const KIND = process.env.QA_KIND ?? "sweep";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const PAGES = ["/dashboard", "/radar", "/radar/connectors", "/trends", "/opportunities", "/research", "/rights", "/content", "/studio", "/calendar", "/analytics", "/agents", "/settings"];
const DETAILS = [
  ["/opportunities", /^\/opportunities\/[0-9a-f-]{36}$/],
  ["/research", /^\/research\/[0-9a-f-]{36}$/],
  ["/trends", /^\/trends\/[0-9a-f-]{36}$/],
  ["/content", /^\/content\/[0-9a-f-]{36}$/],
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(process.env.WIDTH ?? 1366), height: 900 } });
const page = await context.newPage();
const report = { base: BASE, startedAt: new Date().toISOString(), login: null, pages: [] };

let current = null;
page.on("console", (m) => current && m.type() === "error" && current.console.push(m.text().slice(0, 300)));
page.on("pageerror", (e) => current?.pageErrors.push(String(e).slice(0, 300)));
page.on("response", (r) => current && r.status() >= 400 && !r.url().includes("_rsc=") && current.httpErrors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 140)}`));

async function uiMap() {
  return page.evaluate(() => {
    const t = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 70);
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const main = document.querySelector("main") ?? document.body;
    return {
      headings: [...main.querySelectorAll("h1,h2,h3")].filter(vis).map(t).slice(0, 20),
      buttons: [...new Set([...main.querySelectorAll("button")].filter(vis).map(t).filter(Boolean))].slice(0, 30),
      links: [...new Set([...main.querySelectorAll("a[href]")].filter(vis).map((a) => `${t(a)} -> ${a.getAttribute("href")}`))].slice(0, 30),
      fields: [...main.querySelectorAll("input,select,textarea")].filter(vis).map((f) => `${f.tagName.toLowerCase()}[${f.type || ""}] ${f.labels?.[0]?.innerText?.trim() || f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.name}`).slice(0, 30),
      alerts: [...main.querySelectorAll("[role=alert],[role=status]")].filter(vis).map(t).slice(0, 10),
      text: main.innerText.replace(/\s+/g, " ").slice(0, 1200),
    };
  });
}

async function visit(path, name) {
  current = { path, console: [], pageErrors: [], httpErrors: [] };
  const t0 = Date.now();
  const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 60_000 }).catch((e) => ({ status: () => `ERR ${e.message.slice(0, 120)}` }));
  await page.waitForTimeout(1500);
  current.status = res?.status?.();
  current.ms = Date.now() - t0;
  current.url = page.url().replace(BASE, "");
  current.ui = await uiMap().catch((e) => ({ error: String(e) }));
  current.errorText = /Application error|Something went wrong|Internal Server Error|Unhandled Runtime Error/i.exec(current.ui?.text ?? "")?.[0] ?? null;
  report.pages.push(current);
  const jpeg = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false }).catch(() => null);
  if (jpeg) await db.from("qa_shots").insert({ run_kind: KIND, name: name ?? path, jpeg_b64: jpeg.toString("base64") });
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
  await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => {});
  report.login = page.url().includes("/login") ? "FAILED" : `ok → ${page.url().replace(BASE, "")}`;

  if (report.login !== "FAILED") {
    for (const p of PAGES) await visit(p);
    for (const [list, pattern] of DETAILS) {
      await page.goto(BASE + list, { waitUntil: "load" });
      const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      const href = hrefs.find((h) => h && pattern.test(h.split("?")[0]));
      if (href) await visit(href, `${list}/[id]`);
      else report.pages.push({ path: `${list}/[id]`, note: "no detail link found" });
    }
    // mobile pass of the dashboard
    await page.setViewportSize({ width: 390, height: 844 });
    await visit("/dashboard", "/dashboard@mobile");
  }
} catch (e) {
  report.fatal = String(e).slice(0, 500);
} finally {
  report.finishedAt = new Date().toISOString();
  const { error } = await db.from("qa_runs").insert({ kind: KIND, report });
  console.log(error ? `REPORT SAVE FAILED: ${error.message}` : `REPORT SAVED (${report.pages.length} pages, login ${report.login})`);
  await browser.close();
}
