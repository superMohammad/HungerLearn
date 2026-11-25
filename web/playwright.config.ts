import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Runtime verification of docs/feature-map.md rows against a running app (node scripts/verify-app.mjs).
 * The app must already be running at BASE_URL; evidence (screenshots, traces) goes to VERIFY_DIR.
 */
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseURL = process.env.BASE_URL;
const outputDir = process.env.VERIFY_DIR;
if (baseURL === undefined || outputDir === undefined) {
  throw new Error("Run through node scripts/verify-app.mjs, which sets BASE_URL and VERIFY_DIR.");
}

/** VERIFY_ROWS="F01,F02" limits the run to those feature-map rows (describe titles start with the id). */
const rows = (process.env.VERIFY_ROWS ?? "").split(",").filter((r) => r !== "");

export default defineConfig({
  testDir: "e2e",
  grep: rows.length > 0 ? new RegExp(`\\b(${rows.join("|")}) `) : undefined,
  outputDir: `${outputDir}/results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: `${outputDir}/report`, open: "never" }]],
  use: { baseURL, screenshot: "on", trace: "on", locale: "ar-SA" },
});
