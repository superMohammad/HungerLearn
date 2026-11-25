"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data every few seconds while background work is running. */
export function AutoRefresh({ active, intervalMs }: { active: boolean; intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
