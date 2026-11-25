"use client";

import type { MouseEvent } from "react";
import type { Language } from "@/lib/types";

/**
 * Switches the UI language for the current page. `/<lang>/<path>` makes the proxy store the choice
 * and redirect back to the clean URL; a full load is needed because the root layout (lang, dir) changes.
 */
export function LangSwitch({ to, label, aria }: { to: Language; label: string; aria: string }) {
  function go(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    // A full document load on purpose: the proxy must see /<lang>/… to store the choice, and <html lang dir> changes.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/${to}${window.location.pathname}${window.location.search}`);
  }
  return (
    <a href={`/${to}`} onClick={go} hrefLang={to} lang={to} aria-label={aria} className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2">
      {label}
    </a>
  );
}
