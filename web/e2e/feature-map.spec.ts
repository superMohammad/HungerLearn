import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DICTIONARIES } from "../src/lib/i18n";
import type { Role } from "../src/lib/types";
import { createFixtures, removeFixtures, type Fixtures } from "./f05-fixtures";

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
    for (const path of ["/admin", "/admin/review", "/admin/readiness", "/learn"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/signin$/);
    }
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

/**
 * F05 role/device layouts on isolated synthetic published training (e2e/f05-fixtures.ts). Each seeded
 * learner's stored device matches their role (courier phone, employee laptop, partner tablet). The row only
 * looks at screens; it never submits an answer, so no attempts or mastery are written.
 */
const LAYOUT_CASES: { role: Role; email: string; layout: string; viewport: { width: number; height: number }; skipsLesson: boolean }[] = [
  { role: "courier", email: "fahad@hungerlearn.test", layout: "video_question", viewport: { width: 390, height: 844 }, skipsLesson: true },
  { role: "employee", email: "noura@hungerlearn.test", layout: "scenario", viewport: { width: 1440, height: 900 }, skipsLesson: false },
  { role: "partner", email: "laymouna@hungerlearn.test", layout: "checklist", viewport: { width: 820, height: 1180 }, skipsLesson: false },
];

test.describe("F05 learner flow: role and device layouts", () => {
  test.describe.configure({ mode: "serial" });
  let fixtures: Fixtures | undefined;
  test.beforeAll(async () => { fixtures = await createFixtures(); });
  test.afterAll(async () => { await removeFixtures(fixtures); });

  for (const { lang, dir } of LANGS) {
    for (const c of LAYOUT_CASES) {
      row(`${c.role} sees the ${c.layout} layout (${lang})`, async (page) => {
        await page.setViewportSize(c.viewport);
        await useLanguage(page, lang);
        await signIn(page, c.email);
        await expect(page).toHaveURL(/\/learn$/);
        if (fixtures === undefined) throw new Error("F05 fixtures were not created");
        const { documentId, procedureKey } = fixtures.byRole[c.role];
        await page.goto(`/learn/${documentId}/${procedureKey}`);
        await expect(page.locator("html")).toHaveAttribute("dir", dir);
        if (!c.skipsLesson) {
          // The first visit shows the lesson; the learner starts the questions from it.
          await expect(page.locator("article[data-layout]")).toHaveCount(0);
          await page.locator('a[href$="?start=1"]').click();
        }
        const screen = page.locator("article[data-layout]");
        await expect(screen).toHaveAttribute("data-layout", c.layout);
        const t = DICTIONARIES[lang];
        // The training content is Arabic, so it reads right to left in both UI languages.
        await expect(screen.locator("fieldset")).toHaveCSS("direction", "rtl");
        if (c.layout === "video_question") {
          await expect(screen.locator("video")).toHaveAttribute("src", /^\/api\/media\//);
          await expect(screen.locator("video")).toHaveAttribute("aria-label", t.screen.lessonVideo);
          await expect(screen.getByRole("link", { name: t.learn.reviewLesson })).toHaveAttribute("href", /\?lesson=1$/);
          await expect(screen.locator("legend")).toHaveCount(1);
        }
        if (c.layout === "scenario") {
          await expect(screen.getByText(t.screen.scenario, { exact: true })).toBeVisible();
          await expect(screen.getByText("اتصل عميل غاضب", { exact: false })).toBeVisible();
          await expect(screen.getByText("اتصل عميل غاضب", { exact: false })).toHaveCSS("direction", "rtl");
        }
        if (c.layout === "checklist") {
          await expect(screen.getByText(t.screen.checklistHint, { exact: true })).toBeVisible();
          await expect(screen.locator('input[type="checkbox"]')).toHaveCount(4);
        }
        const dirOut = process.env.VERIFY_DIR;
        // The named evidence is taken inside the body, so wait for loading states here too (row() checks again).
        await expect(page.locator('[aria-busy="true"]').filter({ visible: true })).toHaveCount(0);
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
        if (dirOut !== undefined) await page.screenshot({ path: path.join(dirOut, `F05-${c.role}-${c.layout}-${lang}.png`), fullPage: true });
      });
    }
  }
});
