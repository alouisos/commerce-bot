export type SignGroupItem = { href: string; label: string; current: boolean };
export type SignLink = { href: string; label: string };
export type SignItems = {
  label: string;
  groups: SignGroupItem[];
  back: SignLink | null;
  ownerLink: boolean;
};

const SITE_SECTIONS = [
  ["overview", "Overview"],
  ["conversations", "Conversations"],
  ["knowledge", "Knowledge"],
  ["leads", "Leads"],
  ["emails", "Emails"],
  ["settings", "Settings"],
  ["install", "Install"],
] as const;

const startsWith = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Pure nav model for the sign stack: which signs to show for an area and path, and which is lit. */
export function signItems(area: "app" | "owner", path: string, isOwner: boolean): SignItems {
  if (area === "owner") {
    return {
      label: "Owner",
      groups: [{ href: "/owner", label: "Accounts", current: startsWith(path, "/owner") }],
      back: { href: "/app", label: "Admin app" },
      ownerLink: false,
    };
  }
  const siteId = /^\/app\/sites\/([^/]+)/.exec(path)?.[1];
  if (siteId) {
    const base = `/app/sites/${siteId}`;
    return {
      label: "This website",
      groups: SITE_SECTIONS.map(([slug, text]) => ({
        href: `${base}/${slug}`,
        label: text,
        current: slug === "overview" ? path === base || startsWith(path, `${base}/overview`) : startsWith(path, `${base}/${slug}`),
      })),
      back: { href: "/app", label: "All websites" },
      ownerLink: isOwner,
    };
  }
  return {
    label: "Account",
    groups: [
      { href: "/app", label: "Websites", current: path === "/app" },
      { href: "/app/usage", label: "Usage", current: startsWith(path, "/app/usage") },
    ],
    back: null,
    ownerLink: isOwner,
  };
}
