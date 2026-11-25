import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { BrandPhoto } from "@/components/brand-photo";
import { LangSwitch } from "@/components/lang-switch";
import { otherLanguage } from "@/lib/i18n";
import { getDict, getLang } from "@/lib/i18n-server";

/**
 * Sign-in / sign-up frame: the form at the reading start (logo always top-right), and a deep-brown
 * brand panel beside it with the product promise. The panel hides on small screens.
 */
export async function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const [lang, t] = await Promise.all([getLang(), getDict()]);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <header className={`flex items-center justify-between ${lang === "ar" ? "" : "flex-row-reverse"}`}>
          <Link href="/" aria-label={t.common.homeAria} className="shrink-0">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink">
              {t.auth.back}
            </Link>
            <LangSwitch to={otherLanguage(lang)} label={t.common.switchLanguage.label} aria={t.common.switchLanguage.aria} />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
          <p className="mt-2 text-ink-soft">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
      <aside className="relative hidden overflow-hidden bg-night p-12 text-on-night lg:flex lg:flex-col lg:justify-between" aria-label={t.auth.panelAria}>
        <BrandPhoto name="auth" alt={t.auth.photoAlt} className="absolute inset-0 size-full object-cover opacity-35" priority />
        <div aria-hidden="true" className="absolute -bottom-24 -start-24 size-96 rounded-full bg-sun/15" />
        <p className="relative text-sm font-semibold tracking-wide text-sun">HungerLearn</p>
        <div className="relative">
          <p className="max-w-md text-4xl font-bold leading-snug">
            {t.auth.promiseLine1}
            <br />
            <span className="text-sun">{t.auth.promiseLine2}</span>
          </p>
          <ul className="mt-8 grid max-w-md gap-3 text-on-night-soft">
            {t.auth.promisePoints.map((point) => (
              <li key={point} className="flex gap-3"><Dot />{point}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-on-night-soft">{t.auth.footer}</p>
      </aside>
    </div>
  );
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-sun" />;
}
