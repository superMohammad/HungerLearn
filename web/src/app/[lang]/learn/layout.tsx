import { Suspense } from "react";
import { AccountMenu } from "@/components/persona";
import { TopBar } from "@/components/ui";
import { getDict } from "@/lib/i18n-server";

export default async function LearnLayout({ children }: LayoutProps<"/[lang]/learn">) {
  const t = await getDict();
  return (
    <>
      <TopBar links={[{ href: "/learn", label: t.learn.nav }]} persona={<Suspense fallback={null}><AccountMenu /></Suspense>} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
