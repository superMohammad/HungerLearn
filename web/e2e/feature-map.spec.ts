import { expect, test, type Page } from "@playwright/test";
import { B7Fixtures, COURIER, CW01, CW02_V1, CW02_V2, CW04, ED01, ED02_V1, ED02_V2, ED04, EMPLOYEE, type Seeded } from "./b7-fixtures";

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
 * F05 after a new upload (B7): a learner whose badge is being re-checked sees "What changed" (old and new
 * text of changed, added and removed clauses only) before the lesson and the new exam; needs_refresh stays
 * until the new exam is passed. Seeds a disposable database only (see e2e/b7-fixtures.ts).
 */
test.describe("F05 what changed before the new exam (B7)", () => {
  const UI = {
    ar: { whatChanged: "ما الذي تغيّر؟", from: "الرفع رقم 1", to: "الرفع رقم 2", continue: "تابع إلى الدرس", start: "ابدأ التدريب", sure: "متأكد", next: "التالي", refresh: "يحتاج إعادة تدريب", mastered: "اجتاز", back: "العودة لإجراءاتي", review: "راجع ما تغيّر" },
    en: { whatChanged: "What changed?", from: "Upload 1", to: "Upload 2", continue: "Continue to the lesson", start: "Start training", sure: "I'm sure", next: "Next", refresh: "Needs a refresher", mastered: "Passed", back: "Back to my procedures", review: "Review what changed" },
  } as const;
  const CASES = [
    { doc: "Arabic courier document", spec: COURIER, shown: [CW02_V1, CW02_V2], hidden: [CW01, CW04], learners: { ar: "khalid@hungerlearn.test", en: "haya@hungerlearn.test" } },
    { doc: "English employee document", spec: EMPLOYEE, shown: [ED02_V1, ED02_V2, ED04], hidden: [ED01], learners: { ar: "abdullah@hungerlearn.test", en: "munira@hungerlearn.test" } },
  ] as const;
  const RECHECK = [
    { lang: "ar", spec: COURIER, email: "majed@hungerlearn.test", learnerId: "HL-106" },
    { lang: "en", spec: EMPLOYEE, email: "lama@hungerlearn.test", learnerId: "HL-204" },
  ] as const;

  let fixtures: B7Fixtures | undefined;
  const seeded = new Map<string, Seeded>();

  test.beforeAll(async () => {
    fixtures = new B7Fixtures();
    seeded.set("courier", await fixtures.seed(COURIER, ["HL-104", "HL-105", "HL-106"]));
    seeded.set("employee", await fixtures.seed(EMPLOYEE, ["HL-202", "HL-203", "HL-204"]));
  });
  test.afterAll(async () => {
    await fixtures?.cleanup();
  });

  function seededFor(spec: { suffix: string }): Seeded {
    const s = seeded.get(spec.suffix);
    if (s === undefined) throw new Error(`fixture ${spec.suffix} was not seeded`);
    return s;
  }

  async function answer(page: Page, option: string, sure: string): Promise<void> {
    // "Next" does router.replace + router.refresh, so the question can re-render after the choice is made
    // and lose it (the confidence buttons stay disabled). Choose and submit together until it is accepted.
    const radio = page.getByRole("radio", { name: option });
    const submit = page.getByRole("button", { name: sure, exact: true });
    await expect(async () => {
      await radio.check({ timeout: 2000 });
      await submit.click({ timeout: 2000 });
    }).toPass();
    await expect(page.locator('section[aria-live="polite"]')).toBeVisible();
  }

  for (const c of CASES) {
    for (const { lang, dir } of LANGS) {
      row(`${c.doc}: What changed shows only the changed clauses, before the lesson (${lang} UI)`, async (page) => {
        const ui = UI[lang];
        const s = seededFor(c.spec);
        await useLanguage(page, lang);
        await signIn(page, c.learners[lang]);
        await expect(page).toHaveURL(/\/learn$/);
        const card = page.locator(`li a[href*="${s.procedureKey}"]`);
        await expect(card).toContainText(ui.refresh);
        await card.click();
        await expect(page.locator("html")).toHaveAttribute("dir", dir);
        await expect(page.getByRole("heading", { name: ui.whatChanged })).toBeVisible();
        const lesson = page.locator('article[aria-labelledby="what-changed-title"]');
        await expect(lesson).toContainText(ui.from);
        await expect(lesson).toContainText(ui.to);
        const quotes = lesson.locator("blockquote.source-quote");
        await expect(quotes).toHaveText([...c.shown]);
        for (const q of await quotes.all()) await expect(q).toHaveAttribute("dir", "auto");
        for (const hidden of c.hidden) await expect(page.locator("body")).not.toContainText(hidden);
        await expect(page.getByRole("link", { name: ui.continue })).toBeVisible();
      });
    }
  }

  for (const r of RECHECK) {
    row(`badge recheck: needs refresh survives a wrong exam answer and passing restores the badge (${r.lang} UI, ${r.spec.language} document)`, async (page) => {
      test.slow(); // eleven page loads and four graded answers
      const ui = UI[r.lang];
      const s = seededFor(r.spec);
      await useLanguage(page, r.lang);
      await signIn(page, r.email);
      await expect(page).toHaveURL(/\/learn$/);
      await page.goto(s.path);
      await page.getByRole("link", { name: ui.continue }).click();
      await page.getByRole("link", { name: ui.start }).click();

      await answer(page, r.spec.right, ui.sure); // practice
      await page.getByRole("button", { name: ui.next, exact: true }).click();
      await answer(page, r.spec.wrong, ui.sure); // exam, wrong
      await page.goto("/learn");
      await expect(page.locator(`li a[href*="${s.procedureKey}"]`)).toContainText(ui.refresh);

      await page.goto(s.path); // first answer given: the flow continues, What changed stays one click away
      await expect(page.getByRole("link", { name: ui.review })).toBeVisible();
      await answer(page, r.spec.right, ui.sure); // practice again after the failed exam
      await page.getByRole("button", { name: ui.next, exact: true }).click();
      await answer(page, r.spec.right, ui.sure); // exam, right
      await page.getByRole("link", { name: ui.back }).click();
      await expect(page).toHaveURL(/\/learn$/);
      await expect(page.locator(`li a[href*="${s.procedureKey}"]`)).toContainText(ui.mastered);
    });
  }
});
