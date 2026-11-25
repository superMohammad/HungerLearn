import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { SignUpForm } from "@/components/auth-forms";
import { Skeleton } from "@/components/ui";
import { getDict } from "@/lib/i18n-server";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).meta.signUp };
}

async function SignUp() {
  await connection();
  const session = await getSession();
  if (session !== null) redirect(session.kind === "admin" ? "/admin" : "/learn");
  return <SignUpForm />;
}

export default async function SignUpPage() {
  const t = await getDict();
  return (
    <AuthShell title={t.auth.signUpTitle} subtitle={t.auth.signUpSubtitle}>
      <Suspense fallback={<Skeleton label={t.common.loading} />}>
        <SignUp />
      </Suspense>
    </AuthShell>
  );
}
