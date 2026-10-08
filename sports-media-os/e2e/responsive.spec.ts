import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { E2E_USER_FILE, type E2EUser } from "./support";

test("mobile: login page and navigation menu work at phone width", async ({ page }) => {
  const user = JSON.parse(readFileSync(E2E_USER_FILE, "utf8")) as E2EUser;
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // runs after the desktop project (playwright.config dependencies): the user already has projects
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Control room" })).toBeVisible();

  // no horizontal scroll at phone width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
