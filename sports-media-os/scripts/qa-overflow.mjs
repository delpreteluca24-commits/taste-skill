/**
 * Phone-width layout audit: for each page, the elements that stick out of the
 * viewport (the cause of sideways scrolling), printed as JSON lines.
 *
 *   BASE=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… node scripts/qa-overflow.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PAGES = (process.env.PAGES ?? "/dashboard /radar /trends /research /rights /opportunities /content /studio /calendar /analytics /agents /settings").split(" ");

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
    for (const el of document.querySelectorAll("main *, header *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      // report only the outermost offender of each branch
      const parent = el.parentElement;
      const pr = parent?.getBoundingClientRect();
      if (pr && pr.right > vw + 1 && parent.closest("main, header")) continue;
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 8).join(" ");
      out.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.right), w: Math.round(r.width), cls, text: (el.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 60), testid: el.getAttribute("data-testid") });
      if (out.length >= 6) break;
    }
    return { scrollWidth: document.documentElement.scrollWidth, offenders: out };
  });
  console.log(JSON.stringify({ path, ...res }));
}
await browser.close();
