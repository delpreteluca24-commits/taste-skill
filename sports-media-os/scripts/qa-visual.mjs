/**
 * Visual sweep for design review: every page (plus one detail page per list)
 * at desktop and phone width, full-page JPEGs stored in public.qa_shots as the
 * QA user (temporary insert policy), with a per-page report in public.qa_runs.
 *
 *   BASE=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… NEXT_PUBLIC_SUPABASE_URL=… \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… node scripts/qa-visual.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const RUN = `visual-${new Date().toISOString().slice(0, 16)}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
await db.auth.signInWithPassword({ email: process.env.QA_EMAIL ?? "", password: process.env.QA_PASSWORD ?? "" });
const save = async (table, row) => {
  const { error } = await db.from(table).insert(row);
  if (error) console.log(`save ${table} failed: ${error.message}`);
};

const PAGES = ["/dashboard", "/radar", "/radar/connectors", "/trends", "/opportunities", "/research", "/rights", "/content", "/studio", "/calendar", "/analytics", "/agents", "/settings"];
const DETAILS = [
  ["/opportunities", /^\/opportunities\/[0-9a-f-]{36}$/],
  ["/trends", /^\/trends\?id=[0-9a-f-]{36}/],
  ["/content", /^\/content\/[0-9a-f-]{36}$/],
];

const browser = await chromium.launch();

async function sweep(label, viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: opts.mobile ?? false, hasTouch: opts.mobile ?? false });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 100)}`));

  await page.goto(`${BASE}/login`);
  await shoot(page, label, "/login", errors);
  await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
  await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => {});

  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
    await shoot(page, label, p, errors);
  }
  for (const [list, pattern] of DETAILS) {
    await page.goto(BASE + list, { waitUntil: "load" }).catch(() => {});
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const href = hrefs.find((h) => h && pattern.test(h));
    if (href) {
      await page.goto(BASE + href, { waitUntil: "load" }).catch(() => {});
      await shoot(page, label, `${list}/[detail]`, errors);
    }
  }
  if (opts.mobile) {
    await page.goto(`${BASE}/dashboard`);
    const menu = page.getByRole("button", { name: /menu|navigation/i }).first();
    if (await menu.count()) {
      await menu.click().catch(() => {});
      await shoot(page, label, "/dashboard#menu", errors, false);
    }
  }
  await context.close();
}

async function shoot(page, label, path, errors, fullPage = true) {
  await page.waitForTimeout(1200);
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
    height: document.documentElement.scrollHeight,
  }));
  const jpeg = await page.screenshot({ type: "jpeg", quality: 55, fullPage }).catch(() => null);
  const name = `${label}${path.replace(/[^\w-]+/g, "_")}`;
  if (jpeg) await save("qa_shots", { run_kind: RUN, name, jpeg_b64: jpeg.toString("base64") });
  await save("qa_runs", {
    kind: `${RUN}:${name}`,
    report: { path, label, url: page.url().replace(BASE, ""), overflowX: metrics.scrollWidth > metrics.width + 1, ...metrics, errors: errors.splice(0) },
  });
}

try {
  await sweep("m", { width: 390, height: 844 }, { mobile: true });
  await sweep("d", { width: 1440, height: 900 });
} finally {
  await save("qa_runs", { kind: `${RUN}:done`, report: { finishedAt: new Date().toISOString() } });
  await browser.close();
  console.log("VISUAL DONE");
}
