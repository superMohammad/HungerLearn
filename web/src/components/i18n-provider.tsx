"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DICTIONARIES, type Dict } from "@/lib/i18n";
import type { Language } from "@/lib/types";

const LangContext = createContext<Language | null>(null);

/** Gives Client Components the page language (set once in the root layout). */
export function LangProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  return <LangContext value={lang}>{children}</LangContext>;
}

export function useDict(): Dict {
  const lang = useContext(LangContext);
  if (lang === null) throw new Error("useDict() needs a <LangProvider> above it (see app/[lang]/layout.tsx)");
  return DICTIONARIES[lang];
}
