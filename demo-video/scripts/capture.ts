/**
 * Captures high-DPI screenshots of the running Hunger Learn app (http://localhost:3000)
 * into public/shots/, used as footage by the demo video.
 * Usage: DEMO_PASSWORD=... npx tsx scripts/capture.ts
 * ONLY=name1,name2 limits the run to those shot names ("admin-ask" = the text-to-SQL capture).
 */
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

/** clickText: optional link text to click after load (e.g. open a review item). */
type Shot = { readonly name: string; readonly path: string; readonly fullPage: boolean; readonly clickText: string | null };
type Viewport = { readonly width: number; readonly height: number; readonly scale: number };

const BASE: string = "http://localhost:3000";
const OUT: string = "public/shots";
const DESKTOP: Viewport = { width: 1600, height: 1000, scale: 2 };
// procedure_key values of courier-pickup-wait v1 procedures used in the learner shots
const DELAY_KEY: string = "6a1cfcae-ebf4-47bc-8143-754c3fdbc9ba";
const LEAVE_KEY: string = "b5cfa937-17dc-4438-aba0-d03d296eeb9b";
const WRONG_BAG_KEY: string = "31228968-6767-41e7-8bf2-d3c346779eeb";
const PHONE: Viewport = { width: 390, height: 844, scale: 3 };

const requireEnv = (key: string): string => {
  const value: string | undefined = process.env[key];
  if (value === undefined || value === "") throw new Error(`Missing env var ${key}`);
  return value;
};

const signIn = async (page: Page, email: string, password: string): Promise<void> => {
  await page.goto(`${BASE}/ar/signin`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 30000 }), page.click('button[type="submit"]')]);
};

const ONLY: readonly string[] = (process.env.ONLY ?? "").split(",").filter((n: string) => n !== "");
const wanted = (name: string): boolean => ONLY.length === 0 || ONLY.includes(name);

const newPage = async (browser: Browser, viewport: Viewport): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    colorScheme: "light",
    locale: "ar-SA",
  });
  return context.newPage();
};

const shoot = async (page: Page, shots: readonly Shot[]): Promise<void> => {
  for (const shot of shots) {
    await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });
    if (shot.clickText !== null) {
      await page.getByText(shot.clickText, { exact: false }).first().click();
      await page.waitForLoadState("networkidle");
    }
    // Hide the Next.js dev-tools badge so it never appears in footage.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: shot.fullPage });
    console.log(JSON.stringify({ event: "shot", name: shot.name, path: shot.path }));
  }
};

/** Captures pages as a signed-in user. */
const capture = async (browser: Browser, viewport: Viewport, email: string, password: string, allShots: readonly Shot[]): Promise<void> => {
  const shots: readonly Shot[] = allShots.filter((shot: Shot) => wanted(shot.name));
  if (shots.length === 0) return;
  const page: Page = await newPage(browser, viewport);
  await signIn(page, email, password);
  await shoot(page, shots);
  await page.context().close();
};

/** Captures public pages without signing in. */
const captureSignedOut = async (browser: Browser, viewport: Viewport, allShots: readonly Shot[]): Promise<void> => {
  const shots: readonly Shot[] = allShots.filter((shot: Shot) => wanted(shot.name));
  if (shots.length === 0) return;
  const page: Page = await newPage(browser, viewport);
  await shoot(page, shots);
  await page.context().close();
};

/** Asks the read-only text-to-SQL box a question and captures the answer with its SQL expanded. */
const captureAsk = async (browser: Browser, password: string, question: string): Promise<void> => {
  const context = await browser.newContext({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
    deviceScaleFactor: DESKTOP.scale,
    colorScheme: "light",
    locale: "ar-SA",
  });
  const page: Page = await context.newPage();
  await signIn(page, "admin@hungerlearn.test", password);
  await page.goto(`${BASE}/ar/admin/readiness`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.fill('input[name="question"]', question);
  await page.click('form:has(input[name="question"]) button[type="submit"]');
  await page.locator("details summary").waitFor({ state: "visible", timeout: 240000 });
  await page.locator("details summary").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/admin-ask.png`, fullPage: true });
  console.log(JSON.stringify({ event: "shot", name: "admin-ask", question }));
  await context.close();
};

const main = async (): Promise<void> => {
  const password: string = requireEnv("DEMO_PASSWORD");
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ channel: "chrome" });
  await capture(browser, DESKTOP, "admin@hungerlearn.test", password, [
    { name: "admin-home", path: "/ar/admin", fullPage: false, clickText: null },
    { name: "admin-document", path: "/ar/admin/documents/courier-pickup-wait", fullPage: true, clickText: null },
    { name: "admin-review", path: "/ar/admin/review", fullPage: true, clickText: "نقطة الاستلام مغلقة؟" },
    { name: "admin-readiness", path: "/ar/admin/readiness", fullPage: true, clickText: null },
    { name: "admin-home-en", path: "/en/admin", fullPage: false, clickText: null },
  ]);
  await capture(browser, PHONE, "fahad@hungerlearn.test", password, [
    { name: "learn-home", path: "/ar/learn", fullPage: true, clickText: null },
    { name: "learn-home-en", path: "/en/learn", fullPage: true, clickText: null },
    { name: "learn-lesson", path: `/ar/learn/courier-pickup-wait/${DELAY_KEY}?lesson=1`, fullPage: true, clickText: null },
  ]);
  await capture(browser, PHONE, "nasser@hungerlearn.test", password, [
    { name: "learn-q-delay", path: `/ar/learn/courier-pickup-wait/${DELAY_KEY}?start=1`, fullPage: true, clickText: null },
    { name: "learn-q-leave", path: `/ar/learn/courier-pickup-wait/${LEAVE_KEY}?start=1`, fullPage: true, clickText: null },
    { name: "learn-q-wrongbag", path: `/ar/learn/courier-pickup-wait/${WRONG_BAG_KEY}?start=1`, fullPage: true, clickText: null },
  ]);
  await captureSignedOut(browser, PHONE, [
    { name: "landing-ar", path: "/ar", fullPage: false, clickText: null },
    { name: "landing-en", path: "/en", fullPage: false, clickText: null },
  ]);
  if (wanted("admin-ask")) await captureAsk(browser, password, "من أجاب بثقة وكان مخطئاً؟");
  await browser.close();
};

main().catch((error: Error) => { console.error(error); process.exit(1); });
