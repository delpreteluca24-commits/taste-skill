/**
 * QA explorer: signs in and prints, for each path given as argument, the page's
 * headings, buttons, links, form fields (with labels) and alerts — a text map
 * of the UI to script flows against.
 *
 *   BASE=… QA_EMAIL=… QA_PASSWORD=… node scripts/qa-explore.mjs /opportunities /content
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel("Email").fill(process.env.QA_EMAIL ?? "");
await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });

for (const path of process.argv.slice(2)) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const map = await page.evaluate(() => {
    const t = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 70);
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const main = document.querySelector("main") ?? document.body;
    return {
      h: [...main.querySelectorAll("h1,h2,h3")].filter(vis).map(t).slice(0, 25),
      buttons: [...new Set([...main.querySelectorAll("button")].filter(vis).map(t).filter(Boolean))].slice(0, 40),
      links: [...new Set([...main.querySelectorAll("a[href]")].filter(vis).map((a) => `${t(a)} -> ${a.getAttribute("href")}`))].slice(0, 40),
      fields: [...main.querySelectorAll("input,select,textarea")].filter(vis).map((f) => {
        const label = f.labels?.[0]?.innerText?.trim() || f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.name;
        return `${f.tagName.toLowerCase()}[${f.type || ""}] ${label}`;
      }).slice(0, 40),
      alerts: [...main.querySelectorAll("[role=alert],[role=status]")].filter(vis).map(t).slice(0, 10),
      tabs: [...main.querySelectorAll("nav[aria-label] a")].filter(vis).map((a) => `${a.closest("nav").getAttribute("aria-label")}: ${t(a)} -> ${a.getAttribute("href")}`).slice(0, 20),
    };
  });
  console.log(`\n### ${path} → ${page.url().replace(BASE, "")}\n${JSON.stringify(map, null, 1)}`);
}
await browser.close();
