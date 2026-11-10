"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function isDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false; // storage blocked: just show it
  }
}

/**
 * A notice the admin can close. Dismissal is remembered in this browser under `storageKey`
 * (include what the notice is about, e.g. the crawl's finish time, so a new one shows again).
 * Not rendered on the server, so a dismissed notice never flashes on load.
 */
export function DismissibleNotice({
  storageKey,
  className,
  children,
}: {
  storageKey: string;
  className?: string;
  children: ReactNode;
}) {
  const [closed, setClosed] = useState(false);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => isDismissed(storageKey),
    () => true,
  );
  if (closed || dismissed) return null;
  return (
    <div role="status" className={`flex items-start justify-between gap-4 ${className ?? ""}`}>
      <div>{children}</div>
      <button
        type="button"
        aria-label="Dismiss"
        className="px-2"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, "1");
          } catch {
            // storage blocked: hide for this page view only
          }
          setClosed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
