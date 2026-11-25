import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/** Page-level guards: visitors without the right account go to the sign-in page. */
export async function ensureAdmin(): Promise<void> {
  const session = await getSession();
  if (session === null || session.kind !== "admin") redirect("/signin");
}

export async function ensureLearner(): Promise<string> {
  const session = await getSession();
  if (session === null || session.kind !== "learner") redirect("/signin");
  return session.learnerId;
}
