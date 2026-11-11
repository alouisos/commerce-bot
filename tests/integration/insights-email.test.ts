import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, memberships, siteInsights } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { sendDailyInsightEmails, setInsightsEmail } from "@/lib/insights/email";
import { setInsightsEmailAction } from "@/app/app/sites/[siteId]/overview/actions";
import { GET, POST } from "@/app/e/i/[token]/route";
import { isInsightFresh } from "@/lib/insights/schedule";
import { JOBS } from "@/lib/jobs";
import { handlers } from "@/worker/handlers";

beforeEach(resetDb);

const HOUR = 3600_000;

async function insightAt(siteId: string, createdAt: Date) {
  await db.insert(siteInsights).values({
    siteId,
    window: "24h",
    periodFrom: new Date(createdAt.getTime() - 24 * HOUR),
    periodTo: createdAt,
    conversationCount: 4,
    model: "claude-opus-5-5",
    createdAt,
    content: {
      summary: "Visitors want help choosing a shampoo.",
      topQuestions: [{ topic: "Dry hair", detail: "Which product for dry hair" }],
      knowledgeGaps: [{ question: "Do you ship to Cyprus?", suggestion: "Add your shipping countries" }],
      objections: [{ concern: "Price", detail: "Seems high" }],
      curiousProducts: [{ product: "Argan oil", note: "Asked twice" }],
    },
  });
}

async function insightWith(siteId: string, content: Record<string, unknown>) {
  await db.insert(siteInsights).values({
    siteId,
    window: "24h",
    periodFrom: new Date(Date.now() - 25 * HOUR),
    periodTo: new Date(Date.now() - HOUR),
    conversationCount: 2,
    model: "claude-opus-5-5",
    content: { summary: "", topQuestions: [], knowledgeGaps: [], objections: [], curiousProducts: [], ...content },
  });
}

async function setup() {
  const account = await makeAccount();
  const site = await makeSite(account.id);
  const on = await makeUser("on@example.com");
  const off = await makeUser("off@example.com");
  const onM = await makeMembership(account.id, on.id);
  const offM = await makeMembership(account.id, off.id, "admin");
  await db.update(memberships).set({ insightsEmail: false }).where(eq(memberships.id, offM.id));
  return { account, site, on, off, onM, offM };
}

function collector() {
  const sent: { to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];
  return { sent, send: async (m: (typeof sent)[number]) => void sent.push(m) };
}

describe("sendDailyInsightEmails", () => {
  it("emails only the opted-in member, with the insight and links", async () => {
    const { site, onM } = await setup();
    await insightAt(site.id, new Date(Date.now() - 2 * HOUR));
    const { sent, send } = collector();
    expect(await sendDailyInsightEmails(new Date(), send)).toBe(1);
    expect(sent).toHaveLength(1);
    const [m] = sent;
    expect(m.to).toBe("on@example.com");
    expect(m.subject).toBe("Milian Jo: what visitors asked in the last 24 hours");
    for (const part of [
      "Visitors want help choosing a shampoo.",
      "Dry hair: Which product for dry hair",
      "Do you ship to Cyprus? Add your shipping countries",
      "Price: Seems high",
      "Argan oil: Asked twice",
      `/app/sites/${site.id}/overview?insights=24h`,
      `/app/sites/${site.id}/ask`,
      "Written by AI from your conversations",
      `/e/i/${onM.insightsToken}`,
    ]) {
      expect(m.text).toContain(part);
    }
    expect(m.headers?.["List-Unsubscribe"]).toContain(`/e/i/${onM.insightsToken}`);
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.text).not.toContain("off@example.com");
  });

  it("removes visitor addresses and off-site links from the AI text, keeping the shop's own", async () => {
    const { site } = await setup();
    await insightWith(site.id, {
      summary: "Bob (bob@x.com) asked; see http://evil.test/x and https://example.com/shipping for details.",
      knowledgeGaps: [{ question: "Can carol@shop.org order?", suggestion: "Add [a page](https://evil.test/p) to Knowledge" }],
    });
    const { sent, send } = collector();
    await sendDailyInsightEmails(new Date(), send);
    const text = sent[0].text;
    expect(text).not.toContain("bob@x.com");
    expect(text).not.toContain("carol@shop.org");
    expect(text).not.toContain("evil.test");
    expect(text).toContain("[email]");
    expect(text).toContain("https://example.com/shipping");
    expect(text).toContain("Add a page to Knowledge");
  });

  it("sends nothing without an insight from the last 24 hours", async () => {
    const { site } = await setup();
    await insightAt(site.id, new Date(Date.now() - 30 * HOUR));
    const { sent, send } = collector();
    expect(await sendDailyInsightEmails(new Date(), send)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a removed account", async () => {
    const { site, account } = await setup();
    await insightAt(site.id, new Date(Date.now() - HOUR));
    await db.update(accounts).set({ removedAt: new Date() }).where(eq(accounts.id, account.id));
    const { sent, send } = collector();
    expect(await sendDailyInsightEmails(new Date(), send)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("uses the newest insight and keeps going when one send fails", async () => {
    const { site, account } = await setup();
    const other = await makeUser("other@example.com");
    await makeMembership(account.id, other.id, "admin");
    await insightAt(site.id, new Date(Date.now() - 5 * HOUR));
    const calls: string[] = [];
    const send = async (m: { to: string }) => {
      calls.push(m.to);
      if (calls.length === 1) throw new Error("boom");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendDailyInsightEmails(new Date(), send)).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("is a registered job", () => {
    expect(handlers[JOBS.dailyInsightsEmail]).toBeTypeOf("function");
  });
});

describe("isInsightFresh", () => {
  const now = new Date("2026-11-11T06:00:00Z");
  it("is fresh exactly at the window edge and stale 1 ms older", () => {
    const edge = new Date(now.getTime() - 24 * HOUR);
    expect(isInsightFresh({ periodTo: edge }, "24h", now)).toBe(true);
    expect(isInsightFresh({ periodTo: new Date(edge.getTime() - 1) }, "24h", now)).toBe(false);
    expect(isInsightFresh({ periodTo: new Date(now.getTime() - 7 * 24 * HOUR) }, "7d", now)).toBe(true);
    expect(isInsightFresh({ periodTo: new Date(now.getTime() - 7 * 24 * HOUR - 1) }, "7d", now)).toBe(false);
  });
  it("the email skips an insight whose period ended more than 24 hours ago", async () => {
    const { site } = await setup();
    await insightAt(site.id, new Date(Date.now() - 25 * HOUR));
    const { sent, send } = collector();
    expect(await sendDailyInsightEmails(new Date(), send)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("turning the email off", () => {
  it("GET /e/i/<token> turns it off, and an unknown token changes nothing", async () => {
    const { onM } = await setup();
    const bad = await GET(new Request("http://x/e/i/nope"), { params: Promise.resolve({ token: "nope" }) } as never);
    expect(bad.status).toBe(404);
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ token: onM.insightsToken! }) } as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("any more");
    const [row] = await db.select().from(memberships).where(eq(memberships.id, onM.id));
    expect(row.insightsEmail).toBe(false);
  });

  it("a one-click POST turns it off too", async () => {
    const { onM } = await setup();
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ token: onM.insightsToken! }) } as never);
    expect(res.status).toBe(200);
    const [row] = await db.select().from(memberships).where(eq(memberships.id, onM.id));
    expect(row.insightsEmail).toBe(false);
  });

  it("each member has their own token", async () => {
    const { onM, offM } = await setup();
    expect(onM.insightsToken).toBeTruthy();
    expect(onM.insightsToken).not.toBe(offM.insightsToken);
  });
});

describe("setInsightsEmail and its action", () => {
  it("is a 404 for a non-member and changes nothing", async () => {
    const { account, site } = await setup();
    const stranger = await makeUser();
    current.user = { id: stranger.id, email: stranger.email, emailVerified: true };
    let digest: string | undefined;
    try {
      await setInsightsEmailAction(site.id, false);
    } catch (e) {
      digest = (e as { digest?: string }).digest;
    }
    expect(digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    const rows = await db.select().from(memberships).where(eq(memberships.accountId, account.id));
    expect(rows.find((r) => r.insightsEmail)).toBeTruthy();
    expect(rows.filter((r) => r.insightsEmail)).toHaveLength(1);
  });

  it("switches the member's own setting only", async () => {
    const { account, site, on, off } = await setup();
    current.user = { id: on.id, email: on.email, emailVerified: true };
    await setInsightsEmailAction(site.id, false);
    const rows = await db.select().from(memberships).where(eq(memberships.accountId, account.id));
    expect(rows.find((r) => r.userId === on.id)?.insightsEmail).toBe(false);
    await setInsightsEmail(off.id, account.id, true);
    const again = await db.select().from(memberships).where(eq(memberships.accountId, account.id));
    expect(again.find((r) => r.userId === off.id)?.insightsEmail).toBe(true);
    expect(again.find((r) => r.userId === on.id)?.insightsEmail).toBe(false);
  });
});
