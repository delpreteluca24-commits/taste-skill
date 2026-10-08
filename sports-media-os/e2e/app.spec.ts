import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { E2E_USER_FILE, type E2EUser } from "./support";

const user = (): E2EUser => JSON.parse(readFileSync(E2E_USER_FILE, "utf8"));

async function login(page: Page, password = user().password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user().email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // wait for the session cookie + redirect before navigating anywhere else
  if (password === user().password) await page.waitForURL(/\/(dashboard|welcome)$/);
}

test.describe.configure({ mode: "serial" });

test("anonymous users are sent to login, keeping the target", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows a generic error (no account enumeration)", async ({ page }) => {
  await login(page, "definitely-wrong-password");
  // scoped to the form: Next.js' route announcer also carries role="alert"
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/login/);
});

test("first login → onboarding → control room", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/welcome$/);

  await page.getByLabel("Project / channel name").fill("Football Shorts E2E");
  await page.getByLabel("Primary sport").selectOption({ label: "Football (Soccer)" });
  await page.getByLabel("Timezone").selectOption("Europe/Rome");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Control room" })).toBeVisible();
  await expect(page.getByText("Football Shorts E2E · Europe/Rome")).toBeVisible();
  await expect(page.getByTestId("stat-tile")).toHaveCount(6);
  for (const section of [
    "todays-opportunities",
    "top-opportunities",
    "trending-stories",
    "content-in-production",
    "ready-to-publish",
    "published",
    "performing-content",
    "recent-performance",
    "agent-status",
  ]) {
    await expect(page.getByTestId(section)).toBeVisible();
  }
  // empty project: real empty states, no invented numbers
  await expect(page.getByTestId("todays-opportunities")).toContainText("Nothing new today");
  await expect(page.getByTestId("agent-status").getByText("Never run")).toHaveCount(13);
});

test("sidebar navigates to every module; later milestones are labelled honestly", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole("navigation", { name: "Main" });

  await nav.getByRole("link", { name: /Sports Radar/ }).click();
  await expect(page).toHaveURL(/\/radar$/);
  await expect(page.getByRole("heading", { name: "Sports Radar" })).toBeVisible();
  await expect(page.getByText("Scheduled for Milestone 2")).toBeVisible();

  await nav.getByRole("link", { name: /Clips/ }).click();
  await expect(page.getByText("Scheduled for Milestone 3")).toBeVisible();
});

test("settings persist and are validated server-side", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByTestId("platform-connections").getByText("NOT CONNECTED")).toHaveCount(3);

  const production = page.getByTestId("settings-production");
  await production.getByLabel("Default clip duration (s)").fill("30");
  await production.getByRole("button", { name: "Save" }).click();
  await expect(production.getByRole("status")).toHaveText("Saved.");

  await page.reload();
  await expect(page.getByTestId("settings-production").getByLabel("Default clip duration (s)")).toHaveValue("30");

  // bypass the browser's min/max to prove the server validates
  const field = page.getByTestId("settings-production").getByLabel("Default clip duration (s)");
  await field.evaluate((el) => el.removeAttribute("min"));
  await field.fill("3");
  await page.getByTestId("settings-production").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("settings-production").getByRole("alert")).toContainText("Check the highlighted fields");
});

test("multi-project: create a second project and switch between them", async ({ page }) => {
  await login(page);
  await page.getByTestId("project-switcher").click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.getByLabel("Project / channel name").fill("NBA Stories E2E");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("project-switcher")).toHaveText(/NBA Stories E2E/);

  await page.getByTestId("project-switcher").click();
  await page.getByRole("menuitemradio", { name: "Football Shorts E2E" }).click();
  await expect(page.getByTestId("project-switcher")).toHaveText(/Football Shorts E2E/);
  await expect(page.getByText("Football Shorts E2E · Europe/Rome")).toBeVisible();
});

test("sign out ends the session", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});
