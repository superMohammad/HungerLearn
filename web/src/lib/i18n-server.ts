import { notFound } from "next/navigation";
import { lang as langParam } from "next/root-params";
import { DICTIONARIES, isLanguage, type Dict } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** Current UI language in Server Components (the `[lang]` root segment). */
export async function getLang(): Promise<Language> {
  const value = await langParam();
  if (!isLanguage(value)) notFound();
  return value;
}

export async function getDict(): Promise<Dict> {
  return DICTIONARIES[await getLang()];
}
