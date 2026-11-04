/**
 * Phone-width layout audit: for each page, the elements that stick out of the
 * viewport (the cause of sideways scrolling), printed as JSON lines.
 *
 *   BASE=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… node scripts/qa-overflow.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PAGES = (process.env.PAGES ?? "/dashboard /radar /trends /research /rights /opportunities /content /studio /calendar /analytics /agents /settings").split(" ");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
await db.auth.signInWithPassword({ email: process.env.QA_EMAIL ?? "", password: process.env.QA_PASSWORD ?? "" });
const results = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => {});

const extra = [];
for (const list of ["/trends", "/opportunities"]) {
  await page.goto(BASE + list);
  const href = (await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).find((h) => /\/(trends\?id=|opportunities\/)[0-9a-f-]{36}/.test(h ?? ""));
  if (href) extra.push(href);
}

for (const path of [...PAGES, ...extra]) {
  await page.goto(BASE + path, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => {
    const vw = 390;
    const out = [];
    // deepest elements wider than the phone: no child of theirs is that wide, so they force the width
    const wide = (el) => el.getBoundingClientRect().width > vw - 20;
    for (const el of document.querySelectorAll("main *")) {
      if (!wide(el) || [...el.children].some(wide)) continue;
      const r = el.getBoundingClientRect();
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 10).join(" ");
      const kids = [...el.children].slice(0, 12).map((c) => Math.round(c.getBoundingClientRect().width));
      out.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), cls, kids, text: (el.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 50), testid: el.getAttribute("data-testid") ?? el.closest("[data-testid]")?.getAttribute("data-testid") });
      if (out.length >= 5) break;
    }
    return { scrollWidth: document.documentElement.scrollWidth, offenders: out };
  });
  results.push({ path, ...res });
  console.log(JSON.stringify({ path, ...res }));
}
await db.from("qa_runs").insert({ kind: `overflow-${new Date().toISOString().slice(0, 16)}`, report: { results } });
await browser.close();
