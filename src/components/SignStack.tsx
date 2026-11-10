"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand";
import { ArrowLeftIcon } from "./icons";

type Item = { href: string; label: string; match: (path: string) => boolean };

const SITE_SECTIONS = [
  ["overview", "Overview"],
  ["conversations", "Conversations"],
  ["knowledge", "Knowledge"],
  ["leads", "Leads"],
  ["emails", "Emails"],
  ["settings", "Settings"],
  ["install", "Install"],
] as const;

const startsWith = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The main navigation: a vertical stack of signboards, the current section lit. Becomes a
 * horizontally scrolling strip on narrow screens. `foot` holds account controls (sign out).
 */
export function SignStack({ area, foot }: { area: "app" | "owner"; foot?: ReactNode }) {
  const path = usePathname() ?? "";
  const strip = useRef<HTMLDivElement>(null);
  const siteId = area === "app" ? /^\/app\/sites\/([^/]+)/.exec(path)?.[1] : undefined;

  let label: string;
  let items: Item[];
  let back: Item | null = null;
  if (area === "owner") {
    label = "Owner";
    items = [{ href: "/owner", label: "Accounts", match: startsWith("/owner") }];
    back = { href: "/app", label: "Admin app", match: () => false };
  } else if (siteId) {
    label = "This website";
    const base = `/app/sites/${siteId}`;
    items = SITE_SECTIONS.map(([slug, text]) => ({
      href: `${base}/${slug}`,
      label: text,
      match: slug === "overview" ? (p) => p === base || startsWith(`${base}/overview`)(p) : startsWith(`${base}/${slug}`),
    }));
    back = { href: "/app", label: "All websites", match: () => false };
  } else {
    label = "Account";
    items = [
      { href: "/app", label: "Websites", match: (p) => p === "/app" },
      { href: "/app/usage", label: "Usage", match: startsWith("/app/usage") },
    ];
  }

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
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="sign" aria-current={it.match(path) ? "page" : undefined}>
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
        {foot}
      </div>
    </nav>
  );
}
