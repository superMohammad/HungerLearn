import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { BRANCHES, DEVICE_FOR_ROLE, ROLES, type Language, type Role } from "@/lib/types";

/** Validation messages are keys of `auth.errors` in the UI dictionaries; the form shows them in the page language. */
export const AUTH_ERROR_KEYS = [
  "emailInvalid", "passwordMissing", "nameShort", "nameLong", "passwordShort", "passwordLong", "roleMissing", "branchMissing", "badCredentials", "emailTaken",
] as const;
export type AuthErrorKey = (typeof AUTH_ERROR_KEYS)[number];

export function isAuthErrorKey(value: string): value is AuthErrorKey {
  return (AUTH_ERROR_KEYS as readonly string[]).includes(value);
}

export const SignInSchema = z.object({
  email: z.string({ error: "emailInvalid" }).trim().toLowerCase().pipe(z.email({ error: "emailInvalid" })),
  password: z.string({ error: "passwordMissing" }).min(1, { error: "passwordMissing" }),
});
export type SignInInput = z.infer<typeof SignInSchema>;

/** Self sign-up creates learner accounts only; admin accounts are provisioned by the platform (pnpm db:seed). */
export const SignUpSchema = z.object({
  name: z.string({ error: "nameShort" }).trim().min(3, { error: "nameShort" }).max(80, { error: "nameLong" }),
  email: z.string({ error: "emailInvalid" }).trim().toLowerCase().pipe(z.email({ error: "emailInvalid" })),
  password: z.string({ error: "passwordShort" }).min(8, { error: "passwordShort" }).max(128, { error: "passwordLong" }),
  role: z.enum(ROLES, { error: "roleMissing" }),
  branch: z.enum(BRANCHES, { error: "branchMissing" }),
});
export type SignUpInput = z.infer<typeof SignUpSchema>;

/** Returns the account id when the credentials match, null otherwise (no hint which part was wrong). */
export async function checkCredentials(input: SignInInput): Promise<string | null> {
  const rows = await sql()<{ account_id: string; password_hash: string }[]>`
    SELECT account_id, password_hash FROM accounts WHERE email = ${input.email}`;
  if (rows.length === 0) return null;
  return (await verifyPassword(input.password, rows[0].password_hash)) ? rows[0].account_id : null;
}

export async function emailTaken(email: string): Promise<boolean> {
  const rows = await sql()`SELECT 1 FROM accounts WHERE email = ${email}`;
  return rows.length > 0;
}

/** Creates the learner profile (in the language they signed up in) and its account in one transaction; returns the account id. */
export async function createLearnerAccount(input: SignUpInput, language: Language): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  return sql().begin(async (tx) => {
    const [{ learner_id }] = await tx<{ learner_id: string }[]>`
      INSERT INTO learners (learner_id, name, role, branch, language, device)
      VALUES ('HL-' || nextval('learner_number_seq'), ${input.name}, ${input.role}, ${input.branch}, ${language}, ${DEVICE_FOR_ROLE[input.role]})
      RETURNING learner_id`;
    const [{ account_id }] = await tx<{ account_id: string }[]>`
      INSERT INTO accounts (email, password_hash, display_name, kind, learner_id)
      VALUES (${input.email}, ${passwordHash}, ${input.name}, 'learner', ${learner_id})
      RETURNING account_id`;
    return account_id;
  });
}

const DEMO_DOMAIN = "@hungerlearn.test";

/** `role` is null for the admin account. */
export type DemoAccount = { email: string; name: string; role: Role | null; branch: string | null };

/** Seeded demo accounts (reserved .test domain), admin first, for the sign-in page's quick fill. */
export async function listDemoAccounts(): Promise<DemoAccount[]> {
  const rows = await sql()<{ email: string; display_name: string; kind: "admin" | "learner"; role: Role | null; branch: string | null }[]>`
    SELECT a.email, a.display_name, a.kind, l.role, l.branch
    FROM accounts a LEFT JOIN learners l ON l.learner_id = a.learner_id
    WHERE a.email LIKE ${"%" + DEMO_DOMAIN}
    ORDER BY a.kind, l.role, a.email`;
  return rows.map((r) => ({ email: r.email, name: r.display_name, role: r.role, branch: r.branch }));
}
