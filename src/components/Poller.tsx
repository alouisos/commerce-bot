"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page (server components included) every 5 seconds while `active`, e.g. during a crawl. */
export function Poller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
