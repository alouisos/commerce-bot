import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand";

/** Frame for signed-out screens: the lit brand sign above one centred panel (the page's <main>). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="cx auth-shell">
      <p className="brand-mark" aria-hidden="true">
        {PRODUCT_NAME.toUpperCase()}
      </p>
      {children}
    </div>
  );
}
