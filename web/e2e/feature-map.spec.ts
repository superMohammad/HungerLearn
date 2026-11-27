import { expect, test, type Page } from "@playwright/test";

/**
 * One describe block per docs/feature-map.md row that runs without an LLM or video.
 * Each row is walked in both UI languages. Select rows with: scripts/verify-app F01 F02
 */
const LANGS = [
  { lang: "ar", dir: "rtl" },
  { lang: "en", dir: "ltr" },
] as const;
const ADMIN_EMAIL = "admin@hungerlearn.test";
const LEARNER_EMAIL = "fahad@hungerlearn.test";

function demoPassword(): string {
  const value = process.env.DEMO_PASSWORD;
  if (value === undefined || value === "") throw new Error("DEMO_PASSWORD is not set (web/.env.local or the environment).");
  return value;
}

async function useLanguage(page: Page, lang: string): Promise<void> {
  await page.goto(`/${lang}`);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(demoPassword());
  await page.locator('button[type="submit"]').first().click();
}

/**
 * A feature-map test: the body, then a wait until no loading state is visible. Playwright takes the evidence
 * screenshot as soon as the test body returns (before afterEach hooks), so the wait must be part of the body.
 * Every Suspense fallback is the shared Skeleton, which carries aria-busy="true" (src/lib/loading.test.ts keeps it so).
 */
function row(title: string, body: (page: Page) => Promise<void>): void {
  test(title, async ({ page }) => {
    await body(page);
    await expect(page.locator('[aria-busy="true"]').filter({ visible: true }), "a loading state is still visible when the test ends").toHaveCount(0);
  });
}

test.describe("F01 landing page and language toggle", () => {
  for (const { lang, dir } of LANGS) {
    row(`renders in ${lang} with the right direction`, async (page) => {
      await useLanguage(page, lang);
      await expect(page.locator("html")).toHaveAttribute("dir", dir);
      await expect(page.locator('img[alt*="HungerLearn" i], [aria-label*="HungerLearn" i]').first()).toBeVisible();
    });
  }

  row("the header toggle switches the language and keeps the page", async (page) => {
    await useLanguage(page, "ar");
    await page.locator('a[hreflang="en"]').first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator('a[hreflang="ar"]').first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });
});

test.describe("F02 sign-in, guards and sign-out", () => {
  for (const { lang } of LANGS) {
    row(`admin signs in and reaches /admin (${lang})`, async (page) => {
      await useLanguage(page, lang);
      await signIn(page, ADMIN_EMAIL);
      await expect(page).toHaveURL(/\/admin$/);
    });

    row(`learner signs in, reaches /learn and cannot open /admin (${lang})`, async (page) => {
      await useLanguage(page, lang);
      await signIn(page, LEARNER_EMAIL);
      await expect(page).toHaveURL(/\/learn$/);
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/signin$/);
    });
  }

  row("a wrong password is refused", async (page) => {
    await useLanguage(page, "en");
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[name="password"]').fill("definitely-not-the-password");
    await page.locator('button[type="submit"]').first().click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/signin$/);
  });

  row("anonymous visitors are sent to sign-in", async (page) => {
    for (const path of ["/admin", "/admin/review", "/admin/readiness", "/admin/scoreboard", "/learn"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/signin$/);
    }
  });
});

test.describe("F08 scoreboard page", () => {
  for (const { lang, dir } of LANGS) {
    row(`shows the six metric cards for the admin (${lang})`, async (page) => {
      await useLanguage(page, lang);
      await signIn(page, ADMIN_EMAIL);
      await expect(page).toHaveURL(/\/admin$/);
      const response = await page.goto("/admin/scoreboard");
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("dir", dir);
      // Each card shows its number ("ok") or, without its result file (as in CI), the command that produces it.
      // "invalid" means a result file no longer matches what the page expects, so it fails the row.
      await expect(page.locator("[data-metric]")).toHaveCount(6);
      for (const id of ["extraction", "citation", "silent", "cost", "time", "saving"]) {
        const card = page.locator(`[data-metric="${id}"]`);
        await expect(card, id).toBeVisible();
        const state = await card.getAttribute("data-state");
        expect(["ok", "missing"], `${id} is ${state}`).toContain(state);
        if (state === "missing") await expect(card.locator("code"), `${id} shows its command`).toBeVisible();
        else await expect(card.locator(".num").first(), `${id} shows a number`).toBeVisible();
      }
    });
  }

  row("a learner cannot open the scoreboard", async (page) => {
    await useLanguage(page, "en");
    await signIn(page, LEARNER_EMAIL);
    await expect(page).toHaveURL(/\/learn$/);
    await page.goto("/admin/scoreboard");
    await expect(page).toHaveURL(/\/signin$/);
  });
});

test.describe("F06 readiness page", () => {
  for (const { lang } of LANGS) {
    row(`renders for the admin (${lang})`, async (page) => {
      await useLanguage(page, lang);
      await signIn(page, ADMIN_EMAIL);
      await expect(page).toHaveURL(/\/admin$/);
      const response = await page.goto("/admin/readiness");
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
    });
  }
});
