/** Applies web/db/migrations/*.sql in order (idempotent SQL). Run: pnpm db:migrate */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set (see web/.env.example)");
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    for (const file of files) {
      await db.unsafe(await readFile(path.join(dir, file), "utf8"));
      console.log("applied", { file });
    }
  } finally {
    await db.end();
  }
}

await main();
