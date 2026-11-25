import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { LANGUAGES, type Language } from "@/lib/types";

/**
 * UI languages. The URL never shows the language: `src/proxy.ts` rewrites every page request to
 * `/[lang]/…` from the `hl_lang` cookie (Arabic by default), and `/en/…` or `/ar/…` links set it.
 */
export type Dict = typeof ar;

export const DICTIONARIES: Record<Language, Dict> = { ar, en };
export const DEFAULT_LANGUAGE: Language = "ar";
export const LANG_COOKIE = "hl_lang";

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function dirOf(lang: Language): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

export function otherLanguage(lang: Language): Language {
  return lang === "ar" ? "en" : "ar";
}

/** Display name of a stored branch value; branches outside the known list are shown as stored. */
export function branchName(dict: Dict, branch: string): string {
  return branch in dict.labels.branch ? dict.labels.branch[branch as keyof Dict["labels"]["branch"]] : branch;
}
