/**
 * Unattended end-to-end flow on a throwaway account: onboarding → manual
 * opportunity → approval → production → hand-written script → approval →
 * READY → Studio (own title + thumbnail) → Calendar (schedule, publish) →
 * Analytics (metrics). Each step records what the page said; every step and
 * its JPEG screenshot is stored in public.qa_runs / public.qa_shots as the QA
 * user itself (temporary insert policies), so results survive the box.
 *
 *   BASE=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… NEXT_PUBLIC_SUPABASE_URL=… \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… node scripts/qa-flow.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "/tmp/qa";
const RUN = `flow-${new Date().toISOString().slice(0, 16)}`;
mkdirSync(OUT, { recursive: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const signIn = await db.auth.signInWithPassword({ email: process.env.QA_EMAIL ?? "", password: process.env.QA_PASSWORD ?? "" });
const save = async (table, row) => {
  const { error } = await db.from(table).insert(row);
  if (error) console.log(`save ${table} failed: ${error.message}`);
};
await save("qa_runs", { kind: `${RUN}:start`, report: { signIn: signIn.error?.message ?? "ok" } });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const report = { startedAt: new Date().toISOString(), steps: [] };
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console ${m.text().slice(0, 200)}`));
page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 120)}`));

const TITLE = `QA flow ${new Date().toISOString().slice(0, 16)}`;
let n = 0;

async function feedback() {
  return page
    .locator("main [role=alert], main [role=status]")
    .evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean).slice(0, 6))
    .catch(() => []);
}

async function step(name, fn) {
  const s = { n: ++n, name, ok: false };
  const before = errors.length;
  try {
    s.detail = (await fn()) ?? null;
    s.ok = true;
  } catch (e) {
    s.error = String(e).split("\n")[0].slice(0, 300);
  }
  await page.waitForTimeout(800);
  s.url = page.url().replace(BASE, "");
  s.feedback = await feedback();
  s.errors = errors.slice(before);
  const shot = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true }).catch(() => null);
  const shotName = `${String(s.n).padStart(2, "0")}-${name.replace(/\W+/g, "_")}`;
  if (shot) {
    writeFileSync(`${OUT}/${shotName}.jpg`, shot);
    await save("qa_shots", { run_kind: RUN, name: shotName, jpeg_b64: shot.toString("base64") });
  }
  await save("qa_runs", { kind: `${RUN}:${shotName}`, report: s });
  report.steps.push(s);
  writeFileSync(`${OUT}/flow.json`, JSON.stringify(report, null, 2));
  return s.ok;
}

const main = () => page.locator("main");

try {
  await step("login", async () => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
    await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  });

  await step("onboarding", async () => {
    if (!/\/welcome/.test(page.url())) return "already onboarded";
    await page.getByLabel("Project / channel name").fill("QA Flow Project");
    await page.getByLabel("Primary sport").selectOption({ index: 1 });
    await page.getByLabel("Timezone").selectOption("Europe/Rome");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  });

  await step("new opportunity", async () => {
    await page.goto(`${BASE}/opportunities`);
    const form = page.getByTestId("new-opportunity-form");
    if (!(await form.isVisible())) await page.getByTestId("new-opportunity").locator("summary").click();
    await form.getByLabel("Title").fill(TITLE);
    await form.getByLabel("Why now").fill("The derby is on Sunday and the comeback story is everywhere.").catch(() => {});
    await form.getByLabel("Angle").fill("What nobody noticed about the comeback.").catch(() => {});
    await form.getByLabel("Hook").fill("Three goals down, and they still won the derby.").catch(() => {});
    const sport = form.getByLabel("Sport");
    if (await sport.count()) await sport.selectOption({ index: 1 }).catch(() => {});
    await form.getByRole("button", { name: "Create and score" }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}/, { timeout: 20_000 });
  });

  await step("approve opportunity", async () => {
    const approval = page.getByTestId("approval-panel");
    await approval.getByLabel("Notes").fill("QA: approved for the flow test.");
    await approval.getByRole("button", { name: "Approve" }).click();
    await approval.getByRole("status").waitFor();
    return await approval.getByRole("status").innerText();
  });

  await step("start production", async () => {
    await page.getByTestId("start-production").getByRole("button", { name: "Start production" }).click();
    await page.waitForURL(/\/content\/[0-9a-f-]{36}/, { timeout: 20_000 });
  });
  const contentUrl = page.url();

  await step("manual script", async () => {
    await page.goto(`${contentUrl.split("?")[0]}?tab=script`);
    const studio = page.getByTestId("script-studio");
    await studio.getByText("Write a script by hand").click();
    const editor = studio.getByTestId("manual-version-editor");
    const sections = {
      Hook: "Three goals down, and they still won the derby.",
      Context: "The home side hosted their rivals in the derby.",
      Escalation: "The visitors led by three goals and the crowd went quiet.",
      Reveal: "The home side came back from three goals down to win.",
      Payoff: "A comeback the derby had never seen before.",
      CTA: "Follow for the stories behind the results.",
    };
    for (const [label, text] of Object.entries(sections)) await editor.getByLabel(label, { exact: true }).fill(text);
    await editor.getByRole("button", { name: "Save as new version" }).click();
    await studio.getByTestId("current-version").waitFor();
  });

  await step("approve script", async () => {
    const decision = page.getByTestId("script-approval");
    await decision.getByLabel("Notes").fill("QA: checked.");
    await decision.getByRole("button", { name: /^Approve v\d+$/ }).click();
    await decision.getByTestId("script-latest-decision").waitFor();
    return await decision.getByTestId("script-latest-decision").getAttribute("data-decision");
  });

  for (const target of ["production", "ready"]) {
    await step(`move to ${target}`, async () => {
      await page.goto(contentUrl.split("?")[0]);
      const blockers = await page.getByTestId("blockers").innerText().catch(() => "");
      const stage = page.getByTestId("stage-form");
      await stage.getByLabel("Move to stage").selectOption(target);
      await stage.getByRole("button", { name: "Move" }).click();
      await page.waitForTimeout(1500);
      const now = await page.getByTestId("content-stage").first().getAttribute("data-stage");
      if (now !== target) throw new Error(`stage is ${now}; blockers: ${blockers.slice(0, 200)}`);
      return { blockers: blockers.slice(0, 200) };
    });
  }

  const id = contentUrl.split("/").pop().split("?")[0];
  await step("studio own title", async () => {
    await page.goto(`${BASE}/studio?id=${id}`);
    const before = await main().innerText();
    await page.getByLabel("Your own title").fill("They were three goals down. Then this happened");
    await page.getByLabel("Your own title").locator("xpath=../..").getByRole("button", { name: "Add" }).click();
    await page.getByText("Title added and selected.").waitFor();
    return { aiButton: before.includes("AI is off") ? "explains AI is off" : "enabled" };
  });

  await step("studio thumbnail", async () => {
    await page.getByLabel("Your own thumbnail headline").fill("3-0 DOWN?");
    await page.getByLabel("Your own thumbnail headline").locator("xpath=../..").getByRole("button", { name: "Add" }).click();
    await page.getByText("Thumbnail headline added.").waitFor();
  });

  await step("studio download", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download package/ }).click()]);
    const path = `${OUT}/package.md`;
    await download.saveAs(path);
    const { readFileSync } = await import("node:fs");
    return readFileSync(path, "utf8").slice(0, 1500);
  });

  await step("calendar schedule", async () => {
    await page.goto(`${BASE}/calendar`);
    const when = page.getByLabel("Publish date and time").first();
    const d = new Date(Date.now() + 2 * 3600_000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await when.fill(local);
    const form = when.locator("xpath=ancestor::form[1]");
    const yt = form.getByText("YouTube");
    if (await yt.count()) await yt.first().click().catch(() => {});
    await form.getByRole("button").last().click();
    await page.waitForTimeout(2000);
    return (await form.innerText().catch(() => "")).slice(0, 300);
  });

  await step("calendar publish", async () => {
    await page.goto(`${BASE}/calendar`);
    const url = page.getByPlaceholder("Post URL (optional)").first();
    await url.fill("https://www.youtube.com/shorts/qa-test");
    await url.locator("xpath=ancestor::form[1]").getByRole("button").last().click();
    await page.waitForTimeout(2000);
  });

  await step("analytics metrics", async () => {
    await page.goto(`${BASE}/analytics`);
    const views = page.getByLabel("Views").first();
    await views.fill("12345");
    await page.getByLabel("Likes").first().fill("678").catch(() => {});
    await page.getByLabel("Avg % viewed").first().fill("72.5").catch(() => {});
    await page.getByRole("button", { name: /Save snapshot/ }).first().click();
    await page.getByText("Metrics saved.").waitFor();
  });

  await step("analytics after", async () => {
    await page.goto(`${BASE}/analytics`);
    return (await main().innerText()).slice(0, 1200);
  });

  await step("dashboard after", async () => {
    await page.goto(`${BASE}/dashboard`);
    return (await main().innerText()).slice(0, 1500);
  });
} catch (e) {
  report.fatal = String(e).slice(0, 500);
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${OUT}/flow.json`, JSON.stringify(report, null, 2));
  await save("qa_runs", { kind: `${RUN}:done`, report: { fatal: report.fatal ?? null, ok: report.steps.filter((x) => x.ok).length, total: report.steps.length } });
  console.log(`FLOW DONE ${report.steps.filter((s) => s.ok).length}/${report.steps.length} ok`);
  await browser.close();
}
