/**
 * Production login check: signs in on the live URL like a person and records
 * every navigation (status, redirects), console/page errors, the final page
 * text and a screenshot, into public.qa_runs / qa_shots.
 *
 *   BASE=https://… QA_EMAIL=… QA_PASSWORD=… NEXT_PUBLIC_SUPABASE_URL=… \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… node scripts/qa-prod.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE;
const RUN = `prod-${new Date().toISOString().slice(0, 16)}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
await db.auth.signInWithPassword({ email: process.env.QA_EMAIL ?? "", password: process.env.QA_PASSWORD ?? "" });

const browser = await chromium.launch();
const report = { base: BASE, steps: [] };
for (const [label, viewport, mobile] of [["mobile", { width: 390, height: 844 }, true], ["desktop", { width: 1366, height: 900 }, false]]) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const log = [];
  page.on("response", (r) => {
    const t = r.request().resourceType();
    if (t === "document" || t === "fetch" || r.status() >= 300) log.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 120)}${r.headers().location ? ` -> ${r.headers().location.slice(0, 120)}` : ""}`);
  });
  page.on("console", (m) => m.type() === "error" && log.push(`console ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => log.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => log.push(`failed ${r.url().replace(BASE, "").slice(0, 100)} ${r.failure()?.errorText}`));
  const step = { label };
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 45_000 });
    step.loginPage = page.url().replace(BASE, "");
    await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
    await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
    const t0 = Date.now();
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 }).catch((e) => (step.waitError = String(e).slice(0, 200)));
    await page.waitForLoadState("load", { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    step.afterMs = Date.now() - t0;
  } catch (e) {
    step.error = String(e).slice(0, 300);
  }
  step.finalUrl = page.url().replace(BASE, "");
  step.text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
  step.log = log.slice(0, 60);
  report.steps.push(step);
  const shot = await page.screenshot({ type: "jpeg", quality: 50 }).catch(() => null);
  if (shot) await db.from("qa_shots").insert({ run_kind: RUN, name: label, jpeg_b64: shot.toString("base64") });
  await context.close();
}
await db.from("qa_runs").insert({ kind: RUN, report });
await browser.close();
console.log("PROD CHECK DONE");
