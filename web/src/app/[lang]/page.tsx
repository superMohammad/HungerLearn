import Link from "next/link";
import { Suspense } from "react";
import { BrandPhoto, hasBrandPhoto } from "@/components/brand-photo";
import { AccountMenu } from "@/components/persona";
import { CheckIcon, TopBar } from "@/components/ui";
import type { Dict } from "@/lib/i18n";
import { getDict } from "@/lib/i18n-server";
import { ROLES } from "@/lib/types";

/** Product preview: the courier's lesson screen on a phone, with badge and level cards around it. */
function PhonePreview({ t }: { t: Dict["landing"]["preview"] }) {
  return (
    <div className="relative mx-auto w-[280px] sm:w-[300px]" aria-hidden="true">
      <div className="rounded-[2.6rem] border-[10px] border-night bg-night shadow-2xl shadow-night/30">
        <div className="overflow-hidden rounded-[1.9rem] bg-bg">
          <div className="relative aspect-[9/11] bg-night-2">
            {hasBrandPhoto("lesson-frame") ? (
              <BrandPhoto name="lesson-frame" alt="" className="object-cover" priority />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,var(--sun)_0,transparent_45%)] opacity-25" />
            )}
            <span className="absolute end-3 top-3 rounded-lg bg-on-night px-2 py-1 text-[10px] font-bold text-night">HungerLearn</span>
            <div className="absolute inset-x-3 bottom-3 rounded-xl bg-night/85 px-3 py-2 text-sm font-bold text-on-night">
              <span className="text-sun">✓</span> {t.overlay}
            </div>
          </div>
          <div className="p-4">
            <p className="text-xs font-semibold text-ink-soft">{t.today}</p>
            <p className="mt-1 font-bold">{t.lesson}</p>
            <div className="mt-3 h-2 rounded-full bg-surface-2"><div className="h-full w-2/3 rounded-full bg-brand" /></div>
            <p className="mt-1.5 text-xs text-ink-soft">{t.progress}</p>
            <div className="mt-4 rounded-xl bg-accent py-2.5 text-center text-sm font-bold text-on-accent">{t.continue}</div>
          </div>
        </div>
      </div>
      <div className="absolute -start-20 top-20 hidden w-48 rounded-2xl border border-line bg-surface p-3 shadow-xl sm:block">
        <p className="flex items-center gap-2 text-sm font-bold">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent text-on-accent"><CheckIcon /></span>
          {t.badge}
        </p>
        <p className="mt-1 text-xs text-ink-soft">{t.badgeBody}</p>
      </div>
      <div className="absolute -bottom-8 -end-14 hidden w-44 rounded-2xl bg-night p-3 text-on-night shadow-xl sm:block">
        <p className="text-xs text-on-night-soft">{t.level}</p>
        <p className="mt-0.5 text-xl font-bold text-sun">{t.levelName}</p>
      </div>
    </div>
  );
}

export default async function Landing() {
  const t = await getDict();
  const l = t.landing;
  const nav = [
    { href: "/#paths", label: l.nav.paths },
    { href: "/#journey", label: l.nav.journey },
    { href: "/#levels", label: l.nav.levels },
    { href: "/#faq", label: l.nav.faq },
  ];
  return (
    <>
      <TopBar links={nav} persona={<Suspense fallback={null}><AccountMenu /></Suspense>} />
      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="absolute -top-40 end-[-10rem] size-[34rem] rounded-full bg-accent/25 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pb-24 lg:pt-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold text-brand">
                <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
                {l.badge}
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.25] sm:text-5xl lg:text-6xl">
                {l.heroLine1}
                <br />
                {l.heroLine2} <span className="rounded-2xl bg-accent px-3 text-on-accent">{l.heroHighlight}</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
                {l.heroBody}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className="inline-flex min-h-13 items-center rounded-2xl bg-accent px-7 text-lg font-bold text-on-accent transition-colors hover:bg-accent-strong">
                  {l.startNow}
                </Link>
                <Link href="/#paths" className="inline-flex min-h-13 items-center rounded-2xl border-2 border-brand px-7 text-lg font-bold text-brand transition-colors hover:bg-surface-2">
                  {l.explorePaths}
                </Link>
              </div>
              <p className="mt-4 text-sm text-ink-soft">
                {l.haveAccount}{" "}
                <Link href="/signin" className="font-semibold text-brand underline-offset-4 hover:underline">{l.signInLink}</Link>
              </p>
            </div>
            <PhonePreview t={l.preview} />
          </div>
        </section>

        <section aria-label={l.whyAria} className="border-y border-line bg-surface">
          <dl className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-line lg:grid-cols-4">
            {l.highlights.map((h) => (
              <div key={h.label} className="bg-surface px-4 py-8 sm:px-6">
                <dt className="sr-only">{h.label}</dt>
                <dd className="text-3xl font-bold text-brand">{h.value}</dd>
                <dd className="mt-1 text-sm text-ink-soft">{h.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="paths" aria-labelledby="paths-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-8">
          <h2 id="paths-title" className="text-3xl font-bold sm:text-4xl">{l.pathsTitle}</h2>
          <p className="mt-3 max-w-2xl text-lg text-ink-soft">{l.pathsBody}</p>
          <ul className="mt-10 grid gap-5 lg:grid-cols-3">
            {ROLES.map((role) => ({ ...l.paths[role], photo: `role-${role}` })).map((p) => (
              <li key={p.photo} className="flex flex-col overflow-hidden rounded-3xl border border-line bg-surface transition-colors hover:border-brand">
                {hasBrandPhoto(p.photo) ? (
                  <div className="relative aspect-[16/10] bg-surface-2">
                    <BrandPhoto name={p.photo} alt={p.title} className="object-cover" priority={false} />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col p-6">
                  <p className="text-sm font-semibold text-brand">{p.tagline}</p>
                  <h3 className="mt-1 text-xl font-bold">{p.title}</h3>
                  <p className="mt-2 text-ink-soft">{p.body}</p>
                  <ul className="mt-5 grid gap-2 border-t border-line pt-4 text-sm">
                    {p.points.map((x) => (
                      <li key={x} className="flex items-center gap-2"><span className="text-brand"><CheckIcon /></span>{x}</li>
                    ))}
                  </ul>
                  <Link href="/signup" className="mt-6 inline-flex min-h-11 items-center self-start rounded-xl bg-surface-2 px-4 text-sm font-bold text-brand hover:bg-accent hover:text-on-accent">
                    {l.startPath}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="journey" aria-labelledby="journey-title" className="scroll-mt-16 bg-night text-on-night">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
            <h2 id="journey-title" className="text-3xl font-bold sm:text-4xl">{l.journeyTitle}</h2>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {l.journey.map((s, i) => (
                <li key={s.title} className="border-t-2 border-sun pt-5">
                  <span className="num text-sm text-sun">0{i + 1}</span>
                  <h3 className="mt-2 text-xl font-bold">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-on-night-soft">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="levels" aria-labelledby="levels-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-8">
          <h2 id="levels-title" className="text-3xl font-bold sm:text-4xl">{l.levelsTitle}</h2>
          <p className="mt-3 max-w-2xl text-lg text-ink-soft">{l.levelsBody}</p>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {l.levels.map((level, i) => (
              <li key={level.name} className={`rounded-3xl p-6 ${i === 2 ? "bg-accent text-on-accent" : "border border-line bg-surface"}`}>
                <div className="flex gap-1.5" aria-hidden="true">
                  {l.levels.map((_, j) => (
                    <span key={j} className={`h-2 flex-1 rounded-full ${j <= i ? (i === 2 ? "bg-night" : "bg-brand") : "bg-surface-2"}`} />
                  ))}
                </div>
                <p className={`mt-5 text-sm font-semibold ${i === 2 ? "" : "text-ink-soft"}`}>{l.levelOrdinal[i]}</p>
                <h3 className="mt-1 text-2xl font-bold">{level.name}</h3>
                <p className={`mt-2 ${i === 2 ? "" : "text-ink-soft"}`}>{level.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-20 sm:px-8">
            <h2 id="faq-title" className="text-3xl font-bold sm:text-4xl">{l.faqTitle}</h2>
            <div className="mt-8 grid gap-3">
              {l.faq.map((f) => (
                <details key={f.q} className="group rounded-2xl border border-line bg-bg p-5 open:bg-surface-2">
                  <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold">
                    {f.q}
                    <span aria-hidden="true" className="text-2xl text-brand transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-ink-soft">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="bg-accent">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-14 sm:px-8 lg:flex-row lg:items-center">
            <div>
              <h2 id="cta-title" className="text-3xl font-bold text-on-accent">{l.ctaTitle}</h2>
              <p className="mt-2 text-on-accent/80">{l.ctaBody}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex min-h-13 items-center rounded-2xl bg-night px-7 text-lg font-bold text-on-night hover:bg-night-2">{l.startNow}</Link>
              <Link href="/signin" className="inline-flex min-h-13 items-center rounded-2xl border-2 border-night px-7 text-lg font-bold text-night hover:bg-accent-strong">{t.common.signIn}</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="bg-night text-on-night-soft">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 py-10 text-sm sm:px-8 md:flex-row">
          <p><span className="font-bold text-on-night">HungerLearn</span> · {l.footerTagline}</p>
          <nav aria-label={l.footerNav} className="flex gap-5">
            <Link href="/signin" className="hover:text-on-night">{t.common.signIn}</Link>
            <Link href="/signup" className="hover:text-on-night">{t.common.signUp}</Link>
            <Link href="/#faq" className="hover:text-on-night">{l.faqTitle}</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
