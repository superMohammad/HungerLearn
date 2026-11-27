/**
 * Pure publication rules shared by the app (pipeline.ts, review.ts) and the generation eval
 * (generation-eval.ts), so the eval scores the rules the app really applies. No DB, no server-only.
 */
import type { ItemStatus, PackageStatus } from "@/lib/types";

/** Flags and first status of a freshly generated item: clean items are verified, flagged ones stay drafts. */
export function initialItemState(packageStatus: PackageStatus, itemFlags: string[]): { flags: string[]; status: ItemStatus } {
  const flags = packageStatus === "needs_human" ? [...new Set([...itemFlags, "needs_human"])] : itemFlags;
  return { flags, status: flags.length === 0 ? "verified" : "draft" };
}

/**
 * Whether an item with these flags may be approved and published. Today a trainer may approve an item
 * despite its flags (the approval note records them), so this returns true. The deterministic
 * publication gates change this one function, and the generation eval follows automatically.
 */
export function canPublishWithFlags(flags: readonly string[]): boolean {
  void flags;
  return true;
}

/** The items that the rule does not let a trainer approve and publish (none today). */
export function blockedFromPublishing<T extends { flags: readonly string[] }>(
  items: readonly T[],
  rule: (flags: readonly string[]) => boolean = canPublishWithFlags,
): T[] {
  return items.filter((i) => !rule(i.flags));
}
