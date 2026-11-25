import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { sql } from "@/lib/db";

/**
 * Email + password sign-in with server-side sessions (stands in for Supabase Auth in this local MVP).
 * The cookie holds a random token; the database stores only its SHA-256. Every server action re-checks it.
 */
export type Session =
  | { kind: "admin"; accountId: string; actor: string; displayName: string }
  | { kind: "learner"; accountId: string; learnerId: string; displayName: string };

const COOKIE = "hl_session";
const SESSION_DAYS = 30;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Per-request lookup (React.cache dedupes the header, guards and actions in one render). */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token === undefined || token === "") return null;
  const rows = await sql()<{ account_id: string; email: string; display_name: string; kind: "admin" | "learner"; learner_id: string | null }[]>`
    SELECT a.account_id, a.email, a.display_name, a.kind, a.learner_id
    FROM sessions s JOIN accounts a ON a.account_id = s.account_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now()`;
  if (rows.length === 0) return null;
  const a = rows[0];
  if (a.kind === "admin") return { kind: "admin", accountId: a.account_id, actor: `admin:${a.email}`, displayName: a.display_name };
  if (a.learner_id === null) throw new Error(`Learner account ${a.account_id} has no learner_id`);
  return { kind: "learner", accountId: a.account_id, learnerId: a.learner_id, displayName: a.display_name };
});

export async function startSession(accountId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql()`INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (${tokenHash(token)}, ${accountId}, ${expires})`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token !== undefined && token !== "") await sql()`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`;
  jar.delete(COOKIE);
}

export async function requireAdmin(): Promise<{ actor: string }> {
  const session = await getSession();
  if (session === null || session.kind !== "admin") throw new Error("Forbidden: admin account required");
  return { actor: session.actor };
}

export async function requireLearner(): Promise<{ learnerId: string }> {
  const session = await getSession();
  if (session === null || session.kind !== "learner") throw new Error("Forbidden: learner account required");
  return { learnerId: session.learnerId };
}
