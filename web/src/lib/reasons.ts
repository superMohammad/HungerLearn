import type { Dict } from "@/lib/i18n";

/** Human label for a docproc change reason ("numbers: 15 -> 10", "wording changed", ...) in one language. Pure. */
export function reasonLabel(reason: string, labels: Dict["reasons"]): string {
  const exact: Record<string, string> = labels.exact;
  if (reason in exact) return exact[reason];
  const prefix = Object.entries(labels.prefix).find(([p]) => reason.startsWith(p));
  return prefix === undefined ? reason : `${prefix[1]}${reason.slice(prefix[0].length).replace("->", labels.arrow)}`;
}
