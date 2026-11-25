import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { SignInForm } from "@/components/auth-forms";
import { Skeleton } from "@/components/ui";
import { listDemoAccounts } from "@/lib/accounts";
import { serverEnv } from "@/lib/env";
import { getDict } from "@/lib/i18n-server";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).meta.signIn };
}

async function SignIn() {
  await connection();
  const [session, demoAccounts] = await Promise.all([getSession(), listDemoAccounts()]);
  if (session !== null) redirect(session.kind === "admin" ? "/admin" : "/learn");
  return <SignInForm demoAccounts={demoAccounts} demoPassword={serverEnv().demoPassword} />;
}

export default async function SignInPage() {
  const t = await getDict();
  return (
    <AuthShell title={t.auth.signInTitle} subtitle={t.auth.signInSubtitle}>
      <Suspense fallback={<Skeleton label={t.common.loading} />}>
        <SignIn />
      </Suspense>
    </AuthShell>
  );
}
