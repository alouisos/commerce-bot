import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { accountInvites, accounts, sites } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { cancelInvite, createInvite, findUsableInvite, listPendingInvites, resendInvite } from "@/lib/invites";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeUser } from "../helpers/factories";

type Email = { to: string; subject: string; text: string };
const email = vi.hoisted(() => ({ sent: [] as Email[] }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: Email) => void email.sent.push(m) }));

const current = vi.hoisted(() => ({ user: { id: "", email: "", emailVerified: true } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/access", async (orig) => {
  const mod = await orig<typeof import("@/lib/access")>();
  return {
    ...mod,
    isPlatformOwner: (u: { email: string; emailVerified: boolean }) => mod.isPlatformOwner(u, ["boss@example.com"]),
  };
});

import { cancelInviteAction, inviteAction, resendInviteAction } from "@/app/owner/actions";
import OwnerPage from "@/app/owner/page";

beforeEach(async () => {
  await resetDb();
  email.sent = [];
});

const DAY = 86400_000;
const tokenIn = (m: Email) => /\/invite\/([A-Za-z0-9_-]+)/.exec(m.text)![1];
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("createInvite", () => {
  it("creates the account on its plan and emails a single link", async () => {
    const now = new Date("2026-11-11T10:00:00Z");
    const { inviteId, accountId } = await createInvite({ email: " Eleni@Shop.gr ", accountName: "Eleni's shop", plan: "growth" }, now);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account).toMatchObject({ name: "Eleni's shop", plan: "growth", trialEndsAt: null });
    const [invite] = await db.select().from(accountInvites).where(eq(accountInvites.id, inviteId));
    expect(invite).toMatchObject({ email: "eleni@shop.gr", accountId, acceptedAt: null });
    expect(invite.expiresAt).toEqual(new Date(now.getTime() + 7 * DAY));
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: "eleni@shop.gr", subject: "You're invited to Concierge" });
    expect(email.sent[0].text).toContain("http://localhost:3000/invite/");
    expect(email.sent[0].text).toContain("Eleni's shop");
    const token = tokenIn(email.sent[0]);
    expect(invite.tokenHash).not.toBe(token);
    expect(await findUsableInvite(token, now)).toEqual({ id: inviteId, accountId, email: "eleni@shop.gr" });
  });

  it("a trial invite gives a 14-day trial", async () => {
    const now = new Date("2026-11-11T10:00:00Z");
    const { accountId } = await createInvite({ email: "t@shop.gr", accountName: "T", plan: "trial" }, now);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.trialEndsAt).toEqual(new Date(now.getTime() + 14 * DAY));
  });

  it("refuses an email that already has a user, or a second pending invite", async () => {
    await makeUser("taken@shop.gr");
    await expect(createInvite({ email: "Taken@shop.gr", accountName: "X", plan: "starter" })).rejects.toThrow(
      new ValidationError("This person already has an account."),
    );
    await createInvite({ email: "new@shop.gr", accountName: "X", plan: "starter" });
    await expect(createInvite({ email: "new@shop.gr", accountName: "Y", plan: "starter" })).rejects.toThrow(
      new ValidationError("There's already a pending invite for this email. Resend it instead."),
    );
    await expect(createInvite({ email: "bad", accountName: "X", plan: "starter" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createInvite({ email: "a@b.gr", accountName: "", plan: "starter" })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(accounts)).toHaveLength(1);
  });

  it("an invite stops working after 7 days", async () => {
    const now = new Date("2026-11-11T10:00:00Z");
    await createInvite({ email: "e@shop.gr", accountName: "E", plan: "starter" }, now);
    const token = tokenIn(email.sent[0]);
    expect(await findUsableInvite(token, new Date(now.getTime() + 8 * DAY))).toBeNull();
    expect(await findUsableInvite("not-a-real-token", now)).toBeNull();
  });
});

describe("resend and cancel", () => {
  it("resend issues a new link and a new 7 days", async () => {
    const t0 = new Date("2026-11-11T10:00:00Z");
    const { inviteId } = await createInvite({ email: "e@shop.gr", accountName: "E", plan: "starter" }, t0);
    const first = tokenIn(email.sent[0]);
    const t1 = new Date(t0.getTime() + 6 * DAY);
    await resendInvite(inviteId, t1);
    const second = tokenIn(email.sent[1]);
    expect(second).not.toBe(first);
    expect(await findUsableInvite(first, t1)).toBeNull();
    expect(await findUsableInvite(second, new Date(t1.getTime() + 6 * DAY))).not.toBeNull();
  });

  it("cancel removes the invite and its empty account", async () => {
    const { inviteId, accountId } = await createInvite({ email: "e@shop.gr", accountName: "E", plan: "starter" });
    await cancelInvite(inviteId);
    expect(await db.select().from(accountInvites)).toHaveLength(0);
    expect(await db.select().from(accounts).where(eq(accounts.id, accountId))).toHaveLength(0);
  });

  it("cancel keeps an account that already has a website", async () => {
    const { inviteId, accountId } = await createInvite({ email: "e@shop.gr", accountName: "E", plan: "starter" });
    await db.insert(sites).values({ accountId, name: "S", baseUrl: "https://s.example.com", publicKey: "pk_cancel_test" });
    await cancelInvite(inviteId);
    expect(await db.select().from(accounts).where(eq(accounts.id, accountId))).toHaveLength(1);
  });
});

describe("owner console", () => {
  async function asBoss() {
    const u = await makeUser("boss@example.com");
    current.user = { id: u.id, email: u.email, emailVerified: true };
  }

  it("a platform owner invites, and sees the pending invite listed", async () => {
    await asBoss();
    expect(await inviteAction({}, form({ email: "eleni@shop.gr", accountName: "Eleni's shop", plan: "pro" }))).toEqual({ saved: true });
    const pending = await listPendingInvites();
    expect(pending).toMatchObject([{ email: "eleni@shop.gr", accountName: "Eleni's shop", plan: "pro" }]);
    const html = renderToStaticMarkup(await OwnerPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Invite a customer");
    expect(html).toContain("eleni@shop.gr");
    await resendInviteAction(pending[0].id);
    expect(email.sent).toHaveLength(2);
    await cancelInviteAction(pending[0].id);
    expect(await listPendingInvites()).toHaveLength(0);
  });

  it("an invite error is a message", async () => {
    await asBoss();
    expect(await inviteAction({}, form({ email: "bad", accountName: "X", plan: "starter" }))).toMatchObject({ error: expect.any(String) });
    expect(await inviteAction({}, form({ email: "a@b.gr", accountName: "X", plan: "inactive" }))).toMatchObject({ error: expect.any(String) });
  });

  it("a customer can't invite, resend or cancel", async () => {
    const u = await makeUser("owner@shop.gr");
    const a = await makeAccount();
    await makeMembership(a.id, u.id);
    current.user = { id: u.id, email: u.email, emailVerified: true };
    const digest = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return (e as { digest?: string }).digest;
      }
    };
    expect(await digest(inviteAction({}, form({ email: "x@shop.gr", accountName: "X", plan: "pro" })))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    const { inviteId } = await createInvite({ email: "y@shop.gr", accountName: "Y", plan: "pro" });
    expect(await digest(resendInviteAction(inviteId))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await digest(cancelInviteAction(inviteId))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(email.sent).toHaveLength(1);
  });
});
