/**
 * Renders the presentation HTML pages in presentation/ to high-resolution images in out/.
 * Usage: npx tsx scripts/render-stills.ts
 */
import { chromium, type Browser, type Page } from "playwright";
import { resolve } from "node:path";

type Still = { readonly html: string; readonly out: string; readonly width: number; readonly height: number; readonly type: "png" | "jpeg" };

const STILLS: readonly Still[] = [
  { html: "presentation/collage.html", out: "out/HungerLearn-Screens.jpg", width: 1920, height: 1080, type: "jpeg" },
  { html: "presentation/architecture.html", out: "out/HungerLearn-Architecture.png", width: 1920, height: 1080, type: "png" },
];

const SCALE = 2;

const main = async (): Promise<void> => {
  const browser: Browser = await chromium.launch({ channel: "chrome" });
  for (const still of STILLS) {
    const context = await browser.newContext({ viewport: { width: still.width, height: still.height }, deviceScaleFactor: SCALE });
    const page: Page = await context.newPage();
    await page.goto(`file://${resolve(still.html)}`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screenshot({ path: still.out, type: still.type, ...(still.type === "jpeg" ? { quality: 92 } : {}) });
    console.log(JSON.stringify({ event: "still", out: still.out }));
    await context.close();
  }
  await browser.close();
};

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
