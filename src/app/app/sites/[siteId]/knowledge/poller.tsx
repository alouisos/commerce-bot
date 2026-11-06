"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page every 5 seconds while sources are still being processed. */
export function Poller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
