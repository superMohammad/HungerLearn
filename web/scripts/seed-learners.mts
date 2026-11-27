/**
 * Seeds demo learners from the synthetic corpus (data/synthetic_sops/dev/gold/learners.json), one sign-in
 * account per learner, and the platform admin account. All demo accounts share DEMO_PASSWORD (web/.env.local).
 * Run: pnpm db:seed
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { ADMIN, BRANCH_AR, EMAILS, GoldLearnersSchema, NAMES } from "../src/lib/demo-personas";
import { hashPassword } from "../src/lib/password";

const DEVICE_FOR_ROLE = { courier: "phone", employee: "laptop", partner: "tablet" } as const;

function required<T>(map: Record<string, T>, key: string, what: string): T {
  const value = map[key];
  if (value === undefined) throw new Error(`No ${what} for "${key}"; add it to web/src/lib/demo-personas.ts`);
  return value;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set (see web/.env.example)");
  const file = path.join(import.meta.dirname, "..", "..", "data", "synthetic_sops", "dev", "gold", "learners.json");
  const gold = GoldLearnersSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const password = process.env.DEMO_PASSWORD;
  if (password === undefined || password.length < 8) throw new Error("DEMO_PASSWORD (min 8 chars) is not set (see web/.env.example)");
  const db = postgres(url, { max: 1 });
  try {
    for (const l of gold.learners) {
      const name = required(NAMES, l.learner_id, "display name");
      const branch = required(BRANCH_AR, l.branch, "Arabic branch name");
      await db`
        INSERT INTO learners (learner_id, name, role, branch, language, device)
        VALUES (${l.learner_id}, ${name}, ${l.role}, ${branch}, ${l.language}, ${DEVICE_FOR_ROLE[l.role]})
        ON CONFLICT (learner_id) DO UPDATE SET name = EXCLUDED.name, branch = EXCLUDED.branch`;
      await db`
        INSERT INTO accounts (email, password_hash, display_name, kind, learner_id)
        VALUES (${required(EMAILS, l.learner_id, "email")}, ${await hashPassword(password)}, ${name}, 'learner', ${l.learner_id})
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name`;
    }
    await db`
      INSERT INTO accounts (email, password_hash, display_name, kind, learner_id)
      VALUES (${ADMIN.email}, ${await hashPassword(password)}, ${ADMIN.name}, 'admin', NULL)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name`;
    console.log("seeded learners and accounts", { learners: gold.learners.length, admin: ADMIN.email });
  } finally {
    await db.end();
  }
}

await main();
