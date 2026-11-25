import Link from "next/link";
import { connection } from "next/server";
import { signOut } from "@/app/actions";
import { getDict } from "@/lib/i18n-server";
import { getLearner } from "@/lib/repo";
import { getSession } from "@/lib/session";

/** Header account area: the signed-in name + sign out, or sign-in / sign-up links. Rendered inside Suspense. */
export async function AccountMenu() {
  await connection();
  const [session, t] = await Promise.all([getSession(), getDict()]);
  if (session === null) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/signin" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-ink hover:bg-surface-2">
          {t.common.signIn}
        </Link>
        <Link href="/signup" className="hidden min-h-11 items-center rounded-full bg-accent px-5 text-sm font-bold text-on-accent hover:bg-accent-strong sm:inline-flex">
          {t.common.signUp}
        </Link>
      </div>
    );
  }
  const subtitle = session.kind === "admin" ? t.common.admin : t.labels.roleShort[(await getLearner(session.learnerId)).role];
  return (
    <form action={signOut} className="flex items-center gap-3">
      <Link href={session.kind === "admin" ? "/admin" : "/learn"} className="hidden text-end leading-tight sm:block">
        <span className="block text-sm font-semibold" dir="auto">{session.displayName}</span>
        <span className="block text-xs text-ink-soft">{subtitle}</span>
      </Link>
      <button type="submit" className="min-h-11 cursor-pointer rounded-full border border-line px-4 text-sm hover:bg-surface-2">
        {t.common.signOut}
      </button>
    </form>
  );
}
