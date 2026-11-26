/**
 * Seeds demo learners from the synthetic corpus (data/synthetic_sops/dev/gold/learners.json), one sign-in
 * account per learner, and the platform admin account. All demo accounts share DEMO_PASSWORD (web/.env.local).
 * Run: pnpm db:seed
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { hashPassword } from "../src/lib/password";

const GoldLearnersSchema = z.object({
  learners: z.array(
    z.object({
      learner_id: z.string(),
      role: z.enum(["courier", "employee", "partner"]),
      language: z.enum(["ar", "en"]),
      branch: z.string(),
      device_type: z.string(),
    }),
  ),
});

/** Display names for the demo personas (synthetic). */
const NAMES: Record<string, string> = {
  "HL-101": "فهد العتيبي",
  "HL-102": "سارة القحطاني",
  "HL-103": "ناصر الدوسري",
  "HL-104": "خالد الغامدي",
  "HL-105": "هيا الزهراني",
  "HL-201": "نورة الشمري",
  "HL-202": "عبدالله المطيري",
  "HL-203": "منيرة السبيعي",
  "HL-301": "مطعم ليمونة",
  "HL-302": "متجر الريحان",
  "HL-303": "مخبز السنبلة",
  "HL-304": "مقهى الهيل",
};

/** Demo sign-in emails (reserved .test domain). */
const EMAILS: Record<string, string> = {
  "HL-101": "fahad@hungerlearn.test",
  "HL-102": "sara@hungerlearn.test",
  "HL-103": "nasser@hungerlearn.test",
  "HL-104": "khalid@hungerlearn.test",
  "HL-105": "haya@hungerlearn.test",
  "HL-201": "noura@hungerlearn.test",
  "HL-202": "abdullah@hungerlearn.test",
  "HL-203": "munira@hungerlearn.test",
  "HL-301": "laymouna@hungerlearn.test",
  "HL-302": "alrayhan@hungerlearn.test",
  "HL-303": "alsunbula@hungerlearn.test",
  "HL-304": "alhail@hungerlearn.test",
};
const ADMIN = { email: "admin@hungerlearn.test", name: "ريم الحربي" };

/** The corpus uses English branch codes; learners see the Arabic branch names. */
const BRANCH_AR: Record<string, string> = {
  "Fig Gate": "فرع حي الملقا",
  "Papaya Bend": "فرع حي النرجس",
  "Sidr Square": "مركز العمليات – العليا",
  "Olive Lane": "فرع حي الياسمين",
  "Caper Walk": "فرع حي الصحافة",
};

const DEVICE_FOR_ROLE = { courier: "phone", employee: "laptop", partner: "tablet" } as const;

function required<T>(map: Record<string, T>, key: string, what: string): T {
  const value = map[key];
  if (value === undefined) throw new Error(`No ${what} for "${key}"; add it to the seed script`);
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
