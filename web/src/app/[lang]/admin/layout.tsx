import { Suspense } from "react";
import { AccountMenu } from "@/components/persona";
import { TopBar } from "@/components/ui";
import { getDict } from "@/lib/i18n-server";

export default async function AdminLayout({ children }: LayoutProps<"/[lang]/admin">) {
  const t = await getDict();
  const links = [
    { href: "/admin", label: t.admin.nav.documents },
    { href: "/admin/review", label: t.admin.nav.review },
    { href: "/admin/readiness", label: t.admin.nav.readiness },
    { href: "/admin/scoreboard", label: t.admin.nav.scoreboard },
  ];
  return (
    <>
      <TopBar links={links} persona={<Suspense fallback={null}><AccountMenu /></Suspense>} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">{children}</main>
    </>
  );
}
