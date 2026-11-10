import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { monthlyUsage } from "@/db/schema";
import { setAccountLimits } from "@/lib/limits";
import { monthKey } from "@/lib/usage/meter";
import { sendUsageNotices } from "@/lib/usage/notices";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeUser } from "../helpers/factories";

type Email = { to: string; subject: string; text: string };
const mail = vi.hoisted(() => ({ sent: [] as Email[], failFor: null as string | null }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (m: Email) => {
    if (mail.failFor && m.to === mail.failFor) throw new Error("provider down");
    mail.sent.push(m);
  },
}));

beforeEach(async () => {
  await resetDb();
  mail.sent = [];
  mail.failFor = null;
});

const NOV = new Date("2026-11-20T09:00:00Z");
const DEC = new Date("2026-12-05T09:00:00Z");
const ADMIN = ["admin@example.com"];
const run = (now: Date) => sendUsageNotices(now, { platformOwners: ADMIN });

async function customer(opts: { plan?: "starter" | "trial" | "complimentary"; trialEndsAt?: Date | null; owner?: string } = {}) {
  const account = await makeAccount({ plan: opts.plan ?? "starter", trialEndsAt: opts.trialEndsAt ?? null });
  const u = await makeUser(opts.owner ?? `owner-${Math.random().toString(36).slice(2)}@shop.gr`);
  await makeMembership(account.id, u.id);
  return { account, owner: u.email };
}
async function conversations(accountId: string, n: number, now: Date) {
  await db
    .insert(monthlyUsage)
    .values({ accountId, month: monthKey(now), conversations: n })
    .onConflictDoUpdate({ target: [monthlyUsage.accountId, monthlyUsage.month], set: { conversations: n } });
}

describe("usage notices", () => {
  it("warns the owners once at 80 %", async () => {
    const { account, owner } = await customer();
    await conversations(account.id, 410, NOV);
    expect(await run(NOV)).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: owner, subject: "Test Account: 80 % of this month's conversations used" });
    expect(mail.sent[0].text).toContain("http://localhost:3000/app/usage");
    expect(await run(NOV)).toBe(0);
    expect(mail.sent).toHaveLength(1);
  });

  it("at 100 % tells the owners and the platform owner, without resending the 80 % one", async () => {
    const { account, owner } = await customer();
    await conversations(account.id, 410, NOV);
    await run(NOV);
    await conversations(account.id, 500, NOV);
    mail.sent = [];
    await run(NOV);
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
      [owner, "Test Account: this month's conversations are used up"],
      ["admin@example.com", "[Concierge admin] Test Account: this month's conversations are used up"],
    ]);
    expect(mail.sent[0].text).toContain("Your bot keeps answering visitors, but it won't make new suggestions or write new emails until next month.");
    expect(mail.sent[0].text).toContain("help@example.com");
  });

  it("fires again the next month", async () => {
    const { account } = await customer();
    await conversations(account.id, 410, NOV);
    await run(NOV);
    await conversations(account.id, 410, DEC);
    await run(DEC);
    expect(mail.sent.filter((m) => m.subject.includes("80 %"))).toHaveLength(2);
  });

  it("uses the account's own limits", async () => {
    const { account } = await customer();
    await setAccountLimits(account.id, { conversationsPerMonth: 1000 });
    await conversations(account.id, 500, NOV);
    expect(await run(NOV)).toBe(0);
  });

  it("reminds a trial that ends soon, and once when it ended", async () => {
    const soon = await customer({ plan: "trial", trialEndsAt: new Date(NOV.getTime() + 2 * 86400_000) });
    await run(NOV);
    expect(mail.sent.find((m) => m.to === soon.owner)?.subject).toBe("Your Concierge trial ends in 2 days");
    const ended = await customer({ plan: "trial", trialEndsAt: new Date(NOV.getTime() - 86400_000) });
    mail.sent = [];
    await run(NOV);
    await run(NOV);
    await run(NOV);
    expect(mail.sent.filter((m) => m.to === ended.owner && m.subject === "Your Concierge trial has ended")).toHaveLength(1);
    expect(mail.sent.filter((m) => m.to === "admin@example.com" && m.subject.startsWith("[Concierge admin]"))).toHaveLength(1);
  });

  it("complimentary accounts aren't warned about conversations", async () => {
    const { account } = await customer({ plan: "complimentary" });
    await conversations(account.id, 9000, NOV);
    expect(await run(NOV)).toBe(0);
  });

  it("a failing send for one account doesn't stop the others", async () => {
    const a = await customer({ owner: "a@shop.gr" });
    const b = await customer({ owner: "b@shop.gr" });
    await conversations(a.account.id, 410, NOV);
    await conversations(b.account.id, 410, NOV);
    mail.failFor = "a@shop.gr";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await run(NOV);
    errors.mockRestore();
    expect(mail.sent.map((m) => m.to)).toContain("b@shop.gr");
  });

  it("accounts without members are skipped", async () => {
    const lonely = await makeAccount({ plan: "starter" });
    await conversations(lonely.id, 450, NOV);
    expect(await run(NOV)).toBe(0);
  });
});
