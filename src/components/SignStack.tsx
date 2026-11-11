"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand";
import { ArrowLeftIcon } from "./icons";
import { signItems } from "./sign-stack-items";

/**
 * The main navigation: a vertical stack of signboards, the current section lit. Becomes a
 * horizontally scrolling strip on narrow screens. `foot` holds account controls (sign out).
 */
export function SignStack({ area, foot, isOwner = false }: { area: "app" | "owner"; foot?: ReactNode; isOwner?: boolean }) {
  const path = usePathname() ?? "";
  const strip = useRef<HTMLDivElement>(null);
  const siteId = area === "app" ? /^\/app\/sites\/([^/]+)/.exec(path)?.[1] : undefined;
  const { label, groups, back, ownerLink } = signItems(area, path, isOwner);

  // On the phone strip, bring the lit sign into view without moving the page.
  useEffect(() => {
    const nav = strip.current;
    const lit = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !lit || nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const sign = lit.getBoundingClientRect();
    nav.scrollLeft += sign.left - box.left - (box.width - sign.width) / 2;
  }, [path]);

  return (
    <nav aria-label="Main" className="rail">
      <div className="rail-brand">
        <Link href={area === "owner" ? "/owner" : "/app"} className="brand-mark">
          {PRODUCT_NAME.toUpperCase()}
        </Link>
      </div>
      <div className="rail-scroll" ref={strip}>
      {back && (
        <div className="rail-group">
          <Link href={back.href} className="sign sign-quiet">
            <ArrowLeftIcon />
            {back.label}
          </Link>
        </div>
      )}
      <div className="rail-group">
        <span className="rail-label">{label}</span>
        {groups.map((it) => (
          <Link key={it.href} href={it.href} className="sign" aria-current={it.current ? "page" : undefined}>
            {it.label}
          </Link>
        ))}
      </div>
      </div>
      <div className="rail-foot">
        {area === "app" && siteId && (
          <Link href="/app/usage" className="sign sign-quiet">
            Usage
          </Link>
        )}
        {ownerLink && (
          <Link href="/owner" className="sign sign-quiet">
            Owner
          </Link>
        )}
        {foot}
      </div>
    </nav>
  );
}
