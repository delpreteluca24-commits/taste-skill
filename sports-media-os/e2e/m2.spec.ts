import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { adminClient, E2E_USER_FILE, type E2EUser } from "./support";

/**
 * Milestone 2 through the real UI, end to end:
 * connector → fetch (worker) → sources → trend (worker) → opportunity →
 * research (claims + evidence) → rights (YELLOW + approval) → content item
 * (script gate, READY gate) → hooks → settings (AI routing + usage).
 *
 * Runs in its own project, created through the UI at the start of every
 * attempt, so a retry never sees state from a failed attempt and the M1
 * project stays as app.spec.ts left it. No AI keys: AI jobs must fail
 * gracefully ("not configured") at zero cost.
 */

const FEED_URL = "http://127.0.0.1:3199/feed.xml"; // e2e/fixtures/server.mjs (playwright.config FIXTURE_PORT)
const CONNECTOR = "Fixture Sports Wire";
const STORY = /Northbridge|Castellan/i;
const JOB_TIMEOUT = 60_000;

const user = (): E2EUser => JSON.parse(readFileSync(E2E_USER_FILE, "utf8"));

/** Filled by the serial steps below (a retry re-runs the whole file in a fresh worker). */
const run = {
  project: "",
  projectId: "",
  trendId: "",
  opportunityId: "",
  contentId: "",
  claim: "Northbridge FC came back from three goals down to beat Castellan United in the derby.",
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user().email);
  await page.getByLabel("Password").fill(user().password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|welcome)$/);
}

/** Sign in and make the M2 project the active one (the switcher sets the project cookie). */
async function openProject(page: Page) {
  await login(page);
  const switcher = page.getByTestId("project-switcher");
  await expect(switcher).toBeVisible();
  if ((await switcher.innerText()).trim() !== run.project) {
    await switcher.click();
    await page.getByRole("menuitemradio", { name: run.project, exact: true }).click();
    await expect(switcher).toHaveText(run.project);
  }
}

test.describe.configure({ mode: "serial" });

test("M2 setup: a fresh project through the UI", async ({ page }, testInfo) => {
  run.project = testInfo.retry ? `Derby Desk E2E r${testInfo.retry}` : "Derby Desk E2E";
  await login(page);
  // a fresh user lands on onboarding (/dashboard → /welcome); after app.spec.ts it lands on the control room
  const onboarding = page.getByLabel("Project / channel name");
  const switcher = page.getByTestId("project-switcher");
  await expect(onboarding.or(switcher)).toBeVisible();
  if (await switcher.isVisible()) {
    await switcher.click();
    await page.getByRole("menuitem", { name: "New project" }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
  }
  await page.getByLabel("Project / channel name").fill(run.project);
  await page.getByLabel("Primary sport").selectOption({ label: "Football (Soccer)" });
  await page.getByLabel("Timezone").selectOption("Europe/Rome");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("project-switcher")).toHaveText(run.project);

  const { data, error } = await adminClient()
    .from("projects")
    .select("id")
    .eq("owner_id", user().id)
    .eq("name", run.project)
    .single();
  expect(error).toBeNull();
  run.projectId = data!.id;
});

test("connectors: loopback URL refused in the form, fixture feed fetched by the worker", async ({ page }) => {
  await openProject(page);
  await page.goto("/radar/connectors");
  await expect(page.getByRole("heading", { name: "Source connectors" })).toBeVisible();
  await expect(page.getByTestId("connectors-list")).toContainText("No connectors yet");

  // (a) SSRF protection: the web app never accepts a private/loopback address
  await page.getByRole("link", { name: "Add connector" }).click();
  await expect(page).toHaveURL(/\/radar\/connectors\?new=1$/);
  const form = page.getByTestId("connector-form");
  await form.getByLabel("Name").fill(CONNECTOR);
  await form.getByLabel("Feed or API URL").fill(FEED_URL);
  await form.getByRole("button", { name: "Add connector" }).click();
  await expect(form.getByRole("alert")).toHaveText("Check the highlighted fields.");
  await expect(form.getByText("Address 127.0.0.1 is not a public internet address")).toBeVisible();
  await expect(form.getByLabel("Feed or API URL")).toHaveValue(FEED_URL); // what was typed is kept
  await expect(page).toHaveURL(/\?new=1$/);

  const admin = adminClient();
  const before = await admin.from("connectors").select("id", { count: "exact", head: true }).eq("project_id", run.projectId);
  expect(before.count).toBe(0);

  // (b) the fixture connector goes straight into the DB (the worker runs with ALLOW_PRIVATE_FETCH=1)
  const { error } = await admin.from("connectors").insert({
    project_id: run.projectId,
    name: CONNECTOR,
    kind: "rss",
    url: FEED_URL,
    target: "sources",
    enabled: true,
    fetch_interval_minutes: 1440,
    default_license: "unknown",
    created_by: user().id,
  });
  expect(error).toBeNull();

  await page.goto("/radar/connectors");
  const row = page.getByTestId("connector-row").filter({ hasText: CONNECTOR });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("RSS / Atom feed");
  await expect(row).toContainText("127.0.0.1:3199");

  await row.getByRole("button", { name: `Fetch ${CONNECTOR} now` }).click();
  const job = row.getByTestId("job-status");
  await expect(job).toHaveAttribute("data-status", "completed", { timeout: JOB_TIMEOUT });
  await expect(job).toContainText("Fetch: Done");
  // the page refreshes when the job ends: last fetch outcome + item count
  await expect(row).toContainText("OK");
  await expect(row).toContainText("3 items");

  // stored as links + short summaries, every item UNCHECKED
  const { data: sources } = await admin
    .from("sources")
    .select("id, url, title, summary, rights_status")
    .eq("project_id", run.projectId)
    .order("published_at", { ascending: false });
  expect(sources).toHaveLength(3);
  for (const s of sources!) {
    expect(s.url).toMatch(/^https:\/\/fixture-sports-wire\.test\/news\//);
    expect(s.url).not.toContain("utm_source"); // canonical link
    expect(s.title).toMatch(STORY);
    expect(s.summary?.length ?? 0).toBeGreaterThan(0);
    expect(s.summary!.length).toBeLessThanOrEqual(500);
    expect(s.summary).not.toMatch(/<[a-z]/i); // text, not the publisher's markup
    expect(s.rights_status).toBe("unchecked");
  }
});

test("radar & trends: the worker detects the derby story; its signals are explained", async ({ page }) => {
  await openProject(page);

  // the fetch queued trends.detect; the radar shows the finished run (AI titles off: no model configured)
  const strip = page.getByTestId("detection-strip");
  await expect(async () => {
    await page.goto("/radar");
    await expect(strip).toContainText("3 sources scanned · 1 new trend", { timeout: 1_000 });
  }).toPass({ timeout: JOB_TIMEOUT, intervals: [1_000, 2_000] });
  await expect(strip).toContainText("AI titles off (no model configured)");

  // 3 sources from 1 publisher with strong signals: a rising story under "Breaking & emerging";
  // interest is still below 60, so it is honestly NOT a sweet spot
  const card = page.getByTestId("radar-breaking").getByTestId("radar-trend").filter({ hasText: STORY });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("3 sources · 1 publishers");
  for (const signal of ["Upset", "Record", "Rivalry"]) await expect(card.getByLabel("Radar signals")).toContainText(signal);
  await expect(page.getByTestId("radar-sweet-spot")).toContainText("No story is in the sweet spot right now (1 active trend)");

  await card.getByRole("link", { name: "Why it ranks here" }).click();
  await expect(page).toHaveURL(new RegExp(`/trends\\?id=${UUID}$`));
  run.trendId = new URL(page.url()).searchParams.get("id")!;
  await expect(page.getByTestId("trend-row").filter({ hasText: STORY })).toHaveCount(1);

  const detail = page.getByTestId("trend-detail");
  await expect(detail.getByRole("heading", { level: 2 })).toHaveText(STORY);

  // every editorial signal with what it means and the words that triggered it
  const explanation = detail.getByTestId("radar-explanation");
  await expect(explanation.getByRole("heading", { name: /^Radar score \d/ })).toBeVisible();
  await expect(explanation.getByRole("heading", { name: /^Interest \d/ })).toBeVisible();
  await expect(explanation.getByRole("heading", { name: /^Curiosity \d/ })).toBeVisible();
  const signals = {
    record: ["Record, first ever, all-time, historic", "“record”"],
    upset: ["Surprise result, shock, underdog win", "“stun”"],
    rivalry: ["Derby, clásico, rivalry", "“derby”"],
    controversy: ["VAR, bans, suspensions, polemics, rows", "“var”"],
  };
  for (const [signal, [meaning, matched]] of Object.entries(signals)) {
    const row = explanation.locator(`tr[data-signal="${signal}"]`);
    await expect(row).toContainText(meaning);
    await expect(row).toContainText(matched);
  }

  // sources: links to the publisher (opened in a new tab) + summaries, rights unchecked
  const trendSources = detail.getByTestId("trend-source");
  await expect(trendSources).toHaveCount(3);
  for (const link of await trendSources.getByRole("link").all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\/fixture-sports-wire\.test\/news\//);
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await expect(trendSources.getByText("Rights unchecked")).toHaveCount(3);
});

test("opportunity: explained score, AI scoring fails gracefully, approval, start production", async ({ page }) => {
  await openProject(page);
  await page.goto(`/trends?id=${run.trendId}`);
  await page.getByTestId("trend-detail").getByTestId("create-opportunity").click();
  await expect(page).toHaveURL(new RegExp(`/opportunities/${UUID}$`));
  run.opportunityId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STORY);
  await expect(page.getByTestId("opportunity-status").first()).toHaveAttribute("data-status", "new");

  // nine components, documented weights, and where every number comes from
  const breakdown = page.getByTestId("score-breakdown");
  const components = [
    ["trend", "Trend", 20],
    ["timeliness", "Timeliness", 15],
    ["curiosity", "Curiosity", 15],
    ["originality", "Originality", 15],
    ["audience", "Audience", 10],
    ["competition_gap", "Competition gap", 10],
    ["production_feasibility", "Production feasibility", 5],
    ["rights_safety", "Rights safety", 5],
    ["monetization", "Monetization", 5],
  ] as const;
  await expect(breakdown.locator("tbody tr")).toHaveCount(components.length);
  for (const [key, label, weight] of components) {
    const cells = breakdown.locator(`tr[data-component="${key}"]`).getByRole("cell");
    await expect(cells.nth(0)).toHaveText(label);
    await expect(cells.nth(1)).toHaveText(String(weight));
    await expect(cells.nth(4)).toHaveText(/Heuristic|AI|Manual|Not scored/);
  }
  await expect(breakdown.locator('[data-origin="heuristic"]').first()).toBeVisible();
  await expect(page.getByTestId("score-summary")).not.toBeEmpty();

  // AI scoring is a background job: without a provider key it fails with a clear reason, the page stays up
  const ai = page.getByTestId("ai-score");
  await ai.getByRole("button", { name: "Refine with AI" }).click();
  const confirm = ai.getByRole("button", { name: /^Confirm .* and run$/ });
  const aiJob = ai.getByTestId("job-status");
  await expect(confirm.or(aiJob)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click(); // unpriced model / above the batch limit: explicit confirmation
  await expect(aiJob).toHaveAttribute("data-status", "failed", { timeout: JOB_TIMEOUT });
  await expect(aiJob).toContainText("AI scoring: Failed");
  await expect(aiJob).toContainText(/No AI provider is configured for the "scoring" task/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STORY);
  await expect(breakdown.locator("tbody tr")).toHaveCount(components.length);

  // OPPORTUNITY → APPROVAL by a person, with notes
  const approval = page.getByTestId("approval-panel");
  await approval.getByLabel("Notes").fill("Strong derby story; verify the comeback details in research.");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval.getByRole("status")).toHaveText("Approved. You can start production.");
  await expect(page.getByTestId("latest-decision")).toHaveAttribute("data-decision", "approved");
  await expect(page.getByTestId("latest-decision")).toContainText("Strong derby story");
  await expect(page.getByTestId("opportunity-status").first()).toHaveAttribute("data-status", "approved");

  await page.getByTestId("start-production").getByRole("button", { name: "Start production" }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${UUID}$`));
  run.contentId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STORY);
  await expect(page.getByTestId("content-stage").first()).toHaveAttribute("data-stage", "research");
  await expect(page.getByTestId("story")).toBeVisible();
});

test("research: trend sources are UNCHECKED; a critical claim is confirmed only with a supporting source", async ({ page }) => {
  await openProject(page);
  await page.goto(`/opportunities/${run.opportunityId}`);
  await page.getByRole("link", { name: "Open research workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/research/${run.opportunityId}$`));
  const tabs = page.getByRole("navigation", { name: "Research workspace sections" });
  await tabs.getByRole("link", { name: /^Sources/ }).click();
  await expect(page).toHaveURL(/\?tab=sources$/);
  const sources = page.getByTestId("workspace-source");
  await expect(sources).toHaveCount(3);
  for (const row of await sources.all()) {
    await expect(row).toContainText("Trend");
    await expect(row.getByTestId("rights-badge")).toHaveAttribute("data-rights", "unchecked");
    await expect(row.getByTestId("rights-badge")).toHaveText("Unchecked");
  }

  await tabs.getByRole("link", { name: /^Claims/ }).click();
  await expect(page).toHaveURL(/\?tab=claims$/);
  const newClaim = page.getByTestId("new-claim-form");
  await newClaim.getByLabel("Claim", { exact: true }).fill(run.claim);
  await expect(newClaim.getByLabel(/Critical claim/)).toBeChecked();
  await newClaim.getByRole("button", { name: "Add claim" }).click();
  const claim = page.getByTestId("claim-row").filter({ hasText: run.claim });
  await expect(claim).toHaveAttribute("data-status", "uncertain");

  // "Verify" (collapsed under the claim): link sources and set the status
  const verify = page.locator("details").filter({ hasText: "Verify: link sources and set the status" });
  await verify.locator("summary").click();
  const statusForm = verify.getByTestId("claim-status-form");
  await expect(statusForm).toContainText("Confirming this critical claim needs at least one linked source marked “Supports”.");

  // CONFIRMED without a supporting source → refused by the database (CLAIM_UNSOURCED)
  await statusForm.getByLabel("Status").selectOption({ label: "Confirmed" });
  await statusForm.getByRole("button", { name: "Save verification" }).click();
  await expect(statusForm.getByRole("alert")).toHaveText("Link at least one supporting source before confirming this critical claim.");
  await expect(claim).toHaveAttribute("data-status", "uncertain");

  // link a trend source as "Supports" with the sentence that says it
  const linkForm = verify.getByTestId("link-source-form");
  const sourceSelect = linkForm.getByLabel("Source");
  const option = sourceSelect.locator("option", { hasText: "Northbridge FC stun Castellan United" });
  await sourceSelect.selectOption((await option.getAttribute("value"))!);
  await expect(linkForm.getByLabel("Relation")).toHaveValue("supports");
  await linkForm.getByLabel("Excerpt").fill("Northbridge FC came back from three goals down to beat Castellan United.");
  await linkForm.getByLabel("Where").fill("para 1");
  await linkForm.getByRole("button", { name: "Link source" }).click();
  const link = claim.getByTestId("claim-link");
  await expect(link).toHaveAttribute("data-relation", "supports");
  await expect(link).toContainText("Northbridge FC stun Castellan United");
  await expect(claim).toContainText("“Northbridge FC came back from three goals down to beat Castellan United.”");

  await statusForm.getByLabel("Status").selectOption({ label: "Confirmed" });
  await statusForm.getByLabel("Confidence (0–1)").fill("0.9");
  await statusForm.getByLabel("Notes").fill("Matches the publisher's report, paragraph 1.");
  await statusForm.getByRole("button", { name: "Save verification" }).click();
  await expect(statusForm.getByRole("status")).toHaveText("Status updated.");
  await expect(claim).toHaveAttribute("data-status", "confirmed");
  await expect(claim.getByTestId("fact-status")).toHaveText("Confirmed");
  await expect(page.getByTestId("fact-check")).toContainText("1 of 1 confirmed · 0 critical not confirmed");
});

test("rights: GREEN without basis refused, YELLOW awaits a person, approval clears it for humans only", async ({ page }) => {
  await openProject(page);
  await page.goto(`/research/${run.opportunityId}?tab=sources`);
  const row = page.getByTestId("workspace-source").filter({ hasText: "Northbridge FC stun Castellan United" });
  await row.getByRole("link", { name: "Classify" }).click();
  await expect(page).toHaveURL(new RegExp(`/rights/source/${UUID}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Northbridge FC stun Castellan United in record comeback derby");
  const state = page.getByTestId("asset-state");
  await expect(state.getByTestId("rights-status")).toHaveAttribute("data-status", "unchecked");
  await expect(state.getByTestId("usable")).toHaveText("Not usable");

  const form = page.getByTestId("classification-form");
  // GREEN for third-party material with no evidence: refused with field errors, nothing recorded
  await form.getByTestId("status-green").check();
  await form.getByLabel("Ownership").selectOption("third_party");
  await form.getByLabel("Commercial use").selectOption("yes");
  await form.getByLabel("Evidence link").fill("");
  await expect(form.getByTestId("green-allowed")).toHaveAttribute("data-allowed", "false");
  await form.getByTestId("classify-submit").click();
  await expect(form.getByRole("alert")).toHaveText("Check the highlighted fields.");
  await expect(form.getByText("For GREEN, ownership must be owned, licensed, authorized, creator-provided or public domain.")).toBeVisible();
  await expect(form.getByText("For GREEN, an evidence link (license, contract or written permission) is required.")).toBeVisible();
  await expect(form.getByLabel("Ownership")).toHaveAttribute("aria-invalid", "true");
  await expect(state.getByTestId("rights-status")).toHaveAttribute("data-status", "unchecked");
  await expect(page.getByTestId("history")).toContainText("No classifications yet");

  // YELLOW with notes: awaiting a person, not usable in production
  await form.getByTestId("status-yellow").check();
  await form.getByLabel("Ownership").selectOption("unknown");
  await form.getByLabel("Commercial use").selectOption("unknown");
  await form.getByLabel("Notes").fill("Fixture wire article: editorial citation only until the publisher confirms reuse terms.");
  await form.getByTestId("classify-submit").click();
  await expect(form.getByRole("status")).toHaveText("Classified YELLOW: not usable until a person approves its use below.");
  await expect(state.getByTestId("rights-status")).toHaveAttribute("data-status", "yellow");
  await expect(state.getByTestId("awaiting-approval")).toBeVisible();
  await expect(state.getByTestId("usable")).toHaveAttribute("data-usable", "false");
  await expect(page.getByTestId("current-classification")).toContainText("Fixture wire article");

  // RIGHTS → APPROVAL: usable by people, never by automated workflows
  const approval = page.getByTestId("rights-approval-panel");
  await approval.getByLabel("Notes").fill("Publisher confirmed editorial reuse by email on 9 Oct; proof in the rights folder.");
  await approval.getByRole("button", { name: "Approve use" }).click();
  await expect(approval.getByRole("status")).toHaveText(
    "Approved for human-initiated production. Automated workflows still can't use YELLOW assets.",
  );
  await expect(state.getByTestId("usable")).toHaveAttribute("data-usable", "true");
  await expect(state.getByTestId("usable")).toHaveText("Usable · humans only");
  await expect(state.getByTestId("awaiting-approval")).toHaveCount(0);
  await expect(page.getByTestId("latest-rights-decision")).toHaveAttribute("data-decision", "approved");
  await expect(page.getByTestId("rights-approval")).toContainText("Automated workflows (workers, agents) only ever use GREEN.");

  // rights belong to the asset: the research workspace shows the same state
  await page.goto(`/research/${run.opportunityId}?tab=sources`);
  const badge = page.getByTestId("workspace-source").filter({ hasText: "Northbridge FC stun Castellan United" }).getByTestId("rights-badge");
  await expect(badge).toHaveAttribute("data-rights", "yellow");
  await expect(badge).toHaveText("YELLOW · approved");
});

test("content item: manual script version, script gate, approval, PRODUCTION and READY on the board", async ({ page }) => {
  await openProject(page);
  await page.goto(`/content/${run.contentId}`);
  const tabs = page.getByRole("navigation", { name: "Content item sections" });
  await tabs.getByRole("link", { name: /^Script/ }).click();
  await expect(page).toHaveURL(/\?tab=script$/);
  const studio = page.getByTestId("script-studio");
  await expect(studio.getByTestId("current-script")).toContainText("No script yet");
  await studio.getByText("Write a script by hand").click();
  const editor = studio.getByTestId("manual-version-editor");
  const sections = {
    Hook: "Three goals down, and Northbridge FC still won the derby.",
    Context: "Northbridge FC hosted Castellan United in the derby.",
    Escalation: "Castellan United led by three goals and the home crowd went quiet.",
    Reveal: "Northbridge FC came back from three goals down to beat Castellan United.",
    Payoff: "A comeback the derby had never seen before.",
    CTA: "Follow for the stories behind the results.",
  };
  for (const [label, text] of Object.entries(sections)) await editor.getByLabel(label, { exact: true }).fill(text);
  await editor.getByRole("button", { name: "Save as new version" }).click();

  const current = studio.getByTestId("current-version");
  await expect(current).toHaveAttribute("data-version", "1");
  await expect(current).toContainText("Current");
  await expect(current.getByTestId("script-decision")).toHaveAttribute("data-decision", "none");
  await expect(current.getByTestId("script-decision")).toHaveText("Awaiting approval");
  await expect(current.getByTestId("script-sections")).toContainText(sections.Hook);
  await expect(studio.getByTestId("script-version")).toHaveCount(1);

  // PRODUCTION needs an APPROVED current script (database gate)
  await tabs.getByRole("link", { name: /^Overview/ }).click();
  const stage = page.getByTestId("stage-form");
  await stage.getByLabel("Move to stage").selectOption("production");
  await stage.getByRole("button", { name: "Move" }).click();
  await expect(stage.getByRole("alert")).toHaveText("Approve the current script before moving to production.");
  await expect(page.getByTestId("gate-script")).toHaveAttribute("data-state", "closed");

  await tabs.getByRole("link", { name: /^Script/ }).click();
  const decision = page.getByTestId("script-approval");
  await decision.getByLabel("Notes").fill("Every line checked against the confirmed claim.");
  await decision.getByRole("button", { name: "Approve v1" }).click();
  await expect(decision.getByTestId("script-latest-decision")).toHaveAttribute("data-decision", "approved");
  await expect(page.getByTestId("current-version").getByTestId("script-decision")).toHaveText("Approved");

  await tabs.getByRole("link", { name: /^Overview/ }).click();
  await expect(page.getByTestId("gate-script")).toHaveAttribute("data-state", "open");
  // the only critical claim in scope is confirmed and there are no clips: nothing blocks READY
  await expect(page.getByTestId("blockers")).toContainText("No READY blockers");
  await stage.getByLabel("Move to stage").selectOption("production");
  await stage.getByRole("button", { name: "Move" }).click();
  await expect(stage.getByRole("status")).toHaveText("Moved to Production.");
  await expect(page.getByTestId("content-stage").first()).toHaveAttribute("data-stage", "production");

  // the Kanban shows the card in PRODUCTION; READY is open (no blockers) and the move succeeds
  await page.goto("/content");
  const card = page.getByTestId("content-card").filter({ hasText: STORY });
  await expect(page.getByTestId("column-production").getByTestId("content-card").filter({ hasText: STORY })).toHaveCount(1);
  await card.getByTestId("move-menu").click();
  await page.getByRole("menuitemradio", { name: "Ready" }).click();
  await expect(page.getByTestId("column-ready").getByTestId("content-card").filter({ hasText: STORY })).toHaveCount(1);
  await expect(page.getByTestId("move-error")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("column-ready").getByTestId("content-card").filter({ hasText: STORY })).toHaveCount(1);
  await expect(page.getByTestId("column-production").getByTestId("content-card")).toHaveCount(0);
  await card.getByRole("link", { name: STORY }).click();
  await expect(page).toHaveURL(new RegExp(`/content/${run.contentId}$`));
  await expect(page.getByTestId("content-stage").first()).toHaveAttribute("data-stage", "ready");
});

test("hooks: generation fails gracefully without an AI key; a manual hook gets its heuristic score", async ({ page }) => {
  await openProject(page);
  await page.goto(`/content/${run.contentId}`);
  await page.getByRole("navigation", { name: "Content item sections" }).getByRole("link", { name: /^Hooks/ }).click();
  await expect(page).toHaveURL(/\?tab=hooks$/);
  const studio = page.getByTestId("hook-studio");
  await studio.getByRole("button", { name: "Generate 5 hooks" }).click();
  const job = studio.getByTestId("generate-hooks").getByTestId("job-status");
  await expect(job).toHaveAttribute("data-status", "failed", { timeout: JOB_TIMEOUT });
  await expect(job).toContainText("Hooks: Failed");
  await expect(job).toContainText(/No AI provider is configured for the "script" task/);
  await expect(studio.getByTestId("hook-item")).toHaveCount(0);

  const hook = "Northbridge FC were three goals down. Then the derby flipped.";
  await studio.getByText("Add a hook by hand").click();
  const form = studio.getByTestId("manual-hook-form");
  await form.getByLabel("Hook type").selectOption({ label: "Curiosity" });
  await form.getByLabel("Hook", { exact: true }).fill(hook);
  await form.getByRole("button", { name: "Add hook" }).click();
  const item = studio.getByTestId("hook-item").filter({ hasText: hook });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Written by the team");
  await expect(item.getByTestId("hook-score")).toHaveText(/^\d{1,3}/);
  await item.getByText(/^Why \d+\?$/).click();
  await expect(item.getByTestId("hook-score-breakdown")).toContainText("(manual hooks are not scored by AI)");
});

test("settings: AI routing per task with effective model and source; usage panel renders", async ({ page }) => {
  await openProject(page);
  await page.goto("/settings");
  const routing = page.getByTestId("ai-task-routing");
  const tasks = [
    ["discovery", "Discovery"],
    ["scoring", "Scoring"],
    ["research", "Research"],
    ["script", "Script"],
    ["fact_check", "Fact check"],
  ] as const;
  await expect(routing.getByRole("group")).toHaveCount(tasks.length);
  for (const [task, label] of tasks) {
    const row = routing.getByRole("group", { name: `${label} model routing` });
    await expect(row).toHaveAttribute("data-testid", `ai-task-${task}`);
    const model = row.getByTestId(`ai-task-${task}-model`);
    await expect(model).toHaveText(/^[a-z]+:\S+$/); // effective model, provider-qualified
    // where it comes from, right next to it: Settings > env > default
    await expect(model.locator("xpath=following-sibling::*[1]")).toHaveText(/^(Settings|Env · \w+|Default)$/);
  }

  // the ledger only records real model calls: with no provider configured, nothing was called (or only errors)
  const usage = page.getByTestId("ai-usage-panel");
  await expect(usage).toContainText(`AI usage · ${run.project}`);
  await expect(usage.getByText(/No AI calls yet/).or(usage.getByTestId("ai-usage"))).toBeVisible();
});
