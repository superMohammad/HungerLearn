import { z } from "zod";

/**
 * The demo personas behind `pnpm db:seed`: one sign-in account per learner in
 * data/synthetic_sops/dev/gold/learners.json. Kept apart from the seed script so a test can check that every gold
 * learner has a persona (a dataset change that adds learners otherwise breaks the seed only in CI's web-e2e).
 */
export const GoldLearnersSchema = z.object({
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
export const NAMES: Record<string, string> = {
  "HL-101": "فهد العتيبي",
  "HL-102": "سارة القحطاني",
  "HL-103": "ناصر الدوسري",
  "HL-104": "خالد الغامدي",
  "HL-105": "هيا الزهراني",
  "HL-106": "ماجد الحربي",
  "HL-107": "ريان الشهري",
  "HL-201": "نورة الشمري",
  "HL-202": "عبدالله المطيري",
  "HL-203": "منيرة السبيعي",
  "HL-204": "لمى القرني",
  "HL-205": "تركي العنزي",
  "HL-301": "مطعم ليمونة",
  "HL-302": "متجر الريحان",
  "HL-303": "مخبز السنبلة",
  "HL-304": "مقهى الهيل",
  "HL-305": "مطعم سنا",
  "HL-306": "مقهى الدلة",
};

/** Demo sign-in emails (reserved .test domain). */
export const EMAILS: Record<string, string> = {
  "HL-101": "fahad@hungerlearn.test",
  "HL-102": "sara@hungerlearn.test",
  "HL-103": "nasser@hungerlearn.test",
  "HL-104": "khalid@hungerlearn.test",
  "HL-105": "haya@hungerlearn.test",
  "HL-106": "majed@hungerlearn.test",
  "HL-107": "rayan@hungerlearn.test",
  "HL-201": "noura@hungerlearn.test",
  "HL-202": "abdullah@hungerlearn.test",
  "HL-203": "munira@hungerlearn.test",
  "HL-204": "lama@hungerlearn.test",
  "HL-205": "turki@hungerlearn.test",
  "HL-301": "laymouna@hungerlearn.test",
  "HL-302": "alrayhan@hungerlearn.test",
  "HL-303": "alsunbula@hungerlearn.test",
  "HL-304": "alhail@hungerlearn.test",
  "HL-305": "sana@hungerlearn.test",
  "HL-306": "aldalla@hungerlearn.test",
};

/** The corpus uses English branch codes; learners see the Arabic branch names. */
export const BRANCH_AR: Record<string, string> = {
  "Fig Gate": "فرع حي الملقا",
  "Papaya Bend": "فرع حي النرجس",
  "Sidr Square": "مركز العمليات – العليا",
  "Olive Lane": "فرع حي الياسمين",
  "Caper Walk": "فرع حي الصحافة",
};

export type GoldLearner = z.infer<typeof GoldLearnersSchema>["learners"][number];

const DEMO_EMAIL_DOMAIN = "@hungerlearn.test";

/** The platform admin account; its email must not collide with a learner's. */
export const ADMIN = { email: "admin@hungerlearn.test", name: "ريم الحربي" } as const;

/** Every reason the seed would fail or collide for these learners; empty when each has a full, unique persona. */
export function personaProblems(learners: readonly GoldLearner[]): string[] {
  const problems: string[] = [];
  const emails = new Map<string, string>([[ADMIN.email, "the admin account"]]);
  for (const l of learners) {
    if (NAMES[l.learner_id] === undefined) problems.push(`${l.learner_id}: no display name in NAMES`);
    if (BRANCH_AR[l.branch] === undefined) problems.push(`${l.learner_id}: no Arabic name for branch "${l.branch}" in BRANCH_AR`);
    const email = EMAILS[l.learner_id];
    if (email === undefined) {
      problems.push(`${l.learner_id}: no email in EMAILS`);
      continue;
    }
    // verify-…@verify.hungerlearn.test accounts are throwaway learners created by verify-app, never seeded.
    if (!email.endsWith(DEMO_EMAIL_DOMAIN) || email.startsWith("verify-")) problems.push(`${l.learner_id}: email ${email} is not a demo ${DEMO_EMAIL_DOMAIN} address`);
    const other = emails.get(email);
    if (other !== undefined) problems.push(`${l.learner_id}: email ${email} is already used by ${other}`);
    emails.set(email, l.learner_id);
  }
  return problems;
}
