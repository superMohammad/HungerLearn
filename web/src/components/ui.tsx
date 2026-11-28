import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LangSwitch } from "@/components/lang-switch";
import { DICTIONARIES, otherLanguage } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";

/** Small presentational building blocks shared by every page (server components). */

export function Logo({ size }: { size: "sm" | "lg" }) {
  const height = size === "sm" ? 32 : 72;
  const width = Math.round((height * 448) / 184);
  return (
    <span className="inline-flex">
      <Image src="/brand/hungerlearn-logo.png" alt="HungerLearn" width={width} height={height} className="block dark:hidden" />
      <Image src="/brand/hungerlearn-logo-light.png" alt="HungerLearn" width={width} height={height} className="hidden dark:block" />
    </span>
  );
}

export type NavLink = { href: string; label: string };

/**
 * Site header, sticky, never wraps; the nav scrolls sideways on narrow screens. The logo always sits
 * at the top right: first child in RTL, and the row is reversed in LTR (the nav keeps its own order).
 */
export async function TopBar({ links, persona }: { links: NavLink[]; persona: ReactNode }) {
  const lang = await getLang();
  const t = DICTIONARIES[lang];
  const other = otherLanguage(lang);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className={`mx-auto flex h-16 max-w-7xl flex-nowrap items-center gap-4 px-4 sm:gap-8 sm:px-8 ${lang === "ar" ? "" : "flex-row-reverse"}`}>
        <Link href="/" aria-label={t.common.homeAria} className="shrink-0">
          <Logo size="sm" />
        </Link>
        <nav aria-label={t.common.mainNav} className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink sm:px-4">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <LangSwitch to={other} label={t.common.switchLanguage.label} aria={t.common.switchLanguage.aria} />
          {persona}
        </div>
      </div>
    </header>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold tracking-wide text-ink-soft">{eyebrow}</p>
      <h1 className="mt-1 text-3xl font-bold text-ink sm:text-4xl"><span dir="auto">{title}</span></h1>
      <div className="mt-2 max-w-3xl text-ink-soft">{children}</div>
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className: string }) {
  return <section className={`rounded-3xl border border-line bg-surface p-6 ${className}`}>{children}</section>;
}

/** Percentage as a mono number plus a bar; meaning never depends on color alone. */
export function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium" dir="auto">{label}</span>
        <span className="num text-lg">
          {pct}% <span className="text-sm text-ink-soft">({value}/{total})</span>
        </span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${label}: ${pct}%`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export { NumText } from "@/components/num-text";

export function Pill({ children, tone }: { children: ReactNode; tone: "neutral" | "accent" | "warn" | "brand" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-soft",
    accent: "bg-accent text-on-accent",
    warn: "bg-ember-bg text-ember",
    brand: "bg-brand text-bg",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse rounded-3xl border border-line bg-surface p-6 text-ink-soft" aria-busy="true">
      {label}
    </div>
  );
}

export function WarnIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current">
      <path d="M10 1.5 19 18H1L10 1.5Zm-.9 6v5h1.8v-5H9.1Zm0 6.5v1.8h1.8V14H9.1Z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current">
      <path d="M7.6 13.6 3.9 9.9 2.5 11.3l5.1 5.1L17.5 6.5l-1.4-1.4-8.5 8.5Z" />
    </svg>
  );
}
