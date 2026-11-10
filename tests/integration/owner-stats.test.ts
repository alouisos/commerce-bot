import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { usageEvents } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeLead, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";

const session = vi.hoisted(() => ({ email: "boss@example.com", emailVerified: true }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u", email: session.email, emailVerified: session.emailVerified }),
}));
vi.mock("@/lib/access", async (orig) => {
  const mod = await orig<typeof import("@/lib/access")>();
  return {
    ...mod,
    isPlatformOwner: (u: { email: string; emailVerified: boolean }) => mod.isPlatformOwner(u, ["boss@example.com"]),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { getAccountStats, getPlatformTotals } from "@/lib/stats/platform";
import { parseRange } from "@/lib/stats/range";
import OwnerPage from "@/app/owner/page";
import AccountPage from "@/app/owner/accounts/[accountId]/page";

beforeEach(async () => {
  await resetDb();
  session.email = "boss@example.com";
  session.emailVerified = true;
});

const now = new Date("2026-11-10T12:00:00Z");
const range = parseRange("7d", now);
const inRange = new Date("2026-11-08T10:00:00Z");
const before = new Date("2026-10-01T10:00:00Z");

async function seed() {
  const a = await makeAccount();
  const b = await makeAccount();
  const quiet = await makeAccount();
  await makeMembership(a.id, (await makeUser("owner-a@example.com")).id);
  const a1 = await makeSite(a.id, { name: "Alpha One", baseUrl: "https://one.example" });
  const a2 = await makeSite(a.id, { name: "Alpha Two", baseUrl: "https://two.example" });
  const b1 = await makeSite(b.id);

  const c1 = await makeConversation(a1.id, { createdAt: inRange });
  await makeMessage(c1.id);
  await makeMessage(c1.id, { role: "bot", kind: "fallback", content: "Sorry" });
  await makeLead(a1.id, { conversationId: c1.id, createdAt: inRange, email: "secret-lead@example.com" });
  await makeConversation(a2.id, { createdAt: inRange });
  await makeConversation(a2.id, { createdAt: before });
  await makeConversation(b1.id, { createdAt: inRange });
  await makeLead(b1.id, { createdAt: before });

  const ev = (accountId: string, costMicros: number, createdAt: Date) => ({
    accountId,
    kind: "chat" as const,
    model: "claude-opus-5-5",
    costMicros,
    createdAt,
  });
  await db.insert(usageEvents).values([ev(a.id, 1_500_000, inRange), ev(a.id, 9_000_000, before), ev(b.id, 250_000, inRange)]);
  return { a, b, quiet, a1, a2 };
}

describe("platform stats", () => {
  it("counts each account's sites and in-range numbers", async () => {
    const { a, b, quiet } = await seed();
    const stats = new Map((await getAccountStats(range)).map((s) => [s.accountId, s]));
    expect(stats.get(a.id)).toEqual({
      accountId: a.id,
      sites: 2,
      conversations: 2,
      visitorMessages: 1,
      emailsCaptured: 1,
      unanswered: 1,
      aiCostMicros: 1_500_000,
    });
    expect(stats.get(b.id)).toMatchObject({ sites: 1, conversations: 1, emailsCaptured: 0, aiCostMicros: 250_000 });
    expect(stats.get(quiet.id)).toMatchObject({ sites: 0, conversations: 0, aiCostMicros: 0 });
    expect(await getPlatformTotals(range)).toEqual({
      accounts: 3,
      sites: 3,
      conversations: 3,
      visitorMessages: 1,
      emailsCaptured: 1,
      unanswered: 1,
      aiCostMicros: 1_750_000,
    });
  });
});

async function digest(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
}

const account = (accountId: string) =>
  AccountPage({ params: Promise.resolve({ accountId }), searchParams: Promise.resolve({}) } as never);

describe("owner pages", () => {
  it("/owner shows platform tiles and links each account", async () => {
    const { a } = await seed();
    const html = renderToStaticMarkup(await OwnerPage({ searchParams: Promise.resolve({ range: "90d" }) } as never));
    expect(html).toContain("Emails captured");
    expect(html).toContain("AI cost");
    expect(html).toContain(`href="/owner/accounts/${a.id}?range=90d"`);
    expect(html).toContain('aria-current="page"');
    // Plan quotas are per calendar month, so the month-to-date numbers stay next to "Change plan".
    expect(html).toContain("Conversations (month)");
    expect(html).toContain("AI cost (month)");
  });

  it("the account page shows its sites' numbers but no lead emails or transcripts", async () => {
    const { a, a1 } = await seed();
    const html = renderToStaticMarkup(await account(a.id));
    expect(html).toContain("Alpha One");
    expect(html).toContain("Alpha Two");
    expect(html).toContain("owner-a@example.com");
    expect(html).not.toContain("secret-lead@example.com");
    expect(html).not.toContain("/conversations");
    expect(html).not.toContain(`/app/sites/${a1.id}`);
  });

  it("is not found for a non-owner, an unverified owner, or a bad id", async () => {
    const { a } = await seed();
    session.email = "nobody@example.com";
    expect(await digest(account(a.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    session.email = "boss@example.com";
    session.emailVerified = false;
    expect(await digest(account(a.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    session.emailVerified = true;
    expect(await digest(account("not-a-uuid"))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await digest(account("00000000-0000-4000-8000-000000000000"))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
