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
  sourceId: "",
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
  if (!page.url().endsWith("/welcome")) {
    // app.spec.ts already onboarded this user: add a project from the switcher
    await page.getByTestId("project-switcher").click();
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

test("trends: the worker detects the derby story; signals are explained", async ({ page }) => {
  await openProject(page);

  // trends.detect is queued by the fetch; the list fills once the worker is done
  await expect(async () => {
    await page.goto("/trends");
    await expect(page.getByTestId("trend-row").filter({ hasText: STORY }).first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: JOB_TIMEOUT, intervals: [1_000, 2_000] });

  // the radar shows the last detection
  await page.goto("/radar");
  await expect(page.getByTestId("detection-strip")).toContainText("Last run");

  await page.goto("/trends");
  const trendRow = page.getByTestId("trend-row").filter({ hasText: STORY }).first();
  await trendRow.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/trends\\?id=${UUID}$`));
  run.trendId = new URL(page.url()).searchParams.get("id")!;

  const detail = page.getByTestId("trend-detail");
  await expect(detail.getByRole("heading", { level: 2 })).toHaveText(STORY);

  // editorial signals from the headlines, each with its explanation
  const explanation = detail.getByTestId("radar-explanation");
  await expect(explanation).toBeVisible();
  const signals = explanation.locator("tr[data-signal]");
  await expect(signals.first()).toBeVisible();
  const found = await signals.evaluateAll((rows) => rows.map((r) => r.getAttribute("data-signal")));
  expect(found.filter((s) => ["record", "upset", "rivalry", "controversy"].includes(s ?? "")).length).toBeGreaterThanOrEqual(2);
  await expect(explanation.locator('tr[data-signal="record"]')).toContainText("Record, first ever, all-time, historic");
  await expect(explanation.locator('tr[data-signal="record"]')).toContainText("“record”");
  await expect(explanation.getByRole("heading", { name: /^Radar score/ })).toBeVisible();
  await expect(explanation.getByRole("heading", { name: /^Interest/ })).toBeVisible();
  await expect(explanation.getByRole("heading", { name: /^Curiosity/ })).toBeVisible();

  // sources: links to the publisher + summary-level data only, rights unchecked
  const trendSources = detail.getByTestId("trend-source");
  await expect(trendSources).toHaveCount(3);
  for (const link of await trendSources.getByRole("link").all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\/fixture-sports-wire\.test\/news\//);
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await expect(trendSources.getByText("Rights unchecked")).toHaveCount(3);
});
