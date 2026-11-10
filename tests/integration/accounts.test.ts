import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, memberships, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeUser } from "../helpers/factories";
import { createAccountForUser, getAccountForUser } from "@/lib/accounts";
import { isPlatformOwner, requireSiteAccess } from "@/lib/access";
import { NotFoundError } from "@/lib/errors";

beforeEach(async () => {
  await resetDb();
});

describe("accounts and access", () => {
  it("sign-up creates a trial account ending 14 days later with an owner membership", async () => {
    const now = new Date("2026-11-06T10:00:00Z");
    const user = await makeUser("maria@milianjo.com");
    const account = await createAccountForUser(user.id, user.email, now);
    expect(account.plan).toBe("trial");
    expect(account.trialEndsAt).toEqual(new Date("2026-11-20T10:00:00Z"));
    expect(account.name).toBe("maria's workspace");
    const rows = await db.select().from(memberships).where(eq(memberships.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: account.id, role: "owner" });
    expect((await getAccountForUser(user.id)).id).toBe(account.id);
  });

  it("requireSiteAccess returns the site for a member", async () => {
    const a = await makeAccount();
    const user = await makeUser();
    await makeMembership(a.id, user.id);
    const site = await makeSite(a.id);
    expect((await requireSiteAccess(user.id, site.id)).id).toBe(site.id);
  });

  it("requireSiteAccess rejects a member of another account", async () => {
    const [a, b] = [await makeAccount(), await makeAccount()];
    const userA = await makeUser();
    await makeMembership(a.id, userA.id);
    const siteB = await makeSite(b.id);
    await expect(requireSiteAccess(userA.id, siteB.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requireSiteAccess rejects an unknown site id and a malformed id", async () => {
    const user = await makeUser();
    await expect(
      requireSiteAccess(user.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(requireSiteAccess(user.id, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("isPlatformOwner is case-insensitive", () => {
    expect(isPlatformOwner({ email: "A@X.com", emailVerified: true }, ["a@x.com"])).toBe(true);
    expect(isPlatformOwner({ email: "b@x.com", emailVerified: true }, ["a@x.com"])).toBe(false);
  });

  it("isPlatformOwner requires a verified email (sign-up does not verify, so a listed address can be claimed)", () => {
    expect(isPlatformOwner({ email: "a@x.com", emailVerified: false }, ["a@x.com"])).toBe(false);
  });

  it("a fresh login from an invite with a listed owner address is not an owner", async () => {
    const email = `owner-${Date.now()}@example.com`;
    const { createInvite } = await import("@/lib/invites");
    const { acceptInvite } = await import("@/lib/accept-invite");
    const sent: string[] = [];
    const mod = await import("@/lib/email");
    const spy = vi.spyOn(mod, "sendEmail").mockImplementation(async (m) => void sent.push(m.text));
    await createInvite({ email, accountName: "X", plan: "starter" });
    const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(sent[0])![1];
    expect((await acceptInvite(token, { name: "x", password: "long-enough-password" })).ok).toBe(true);
    spy.mockRestore();
    const [u] = await db.select().from(user).where(eq(user.email, email));
    expect(u.emailVerified).toBe(false);
    expect(isPlatformOwner(u, [email])).toBe(false);
  });

  it("sign-up through Better Auth without an invite is refused", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "hook@example.com", password: "password-12345", name: "Hook" } }),
    ).rejects.toBeTruthy();
    expect(await db.select().from(accounts)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
  });

  it("getAccountForUser self-heals a user without an account, once, under concurrency", async () => {
    const user = await makeUser("heal@example.com");
    const results = await Promise.all(Array.from({ length: 5 }, () => getAccountForUser(user.id)));
    expect(new Set(results.map((a) => a.id)).size).toBe(1);
    expect(results[0].name).toBe("heal's workspace");
    expect(await db.select().from(accounts)).toHaveLength(1);
    expect(await db.select().from(memberships)).toHaveLength(1);
  });

  it("getAccountForUser throws NotFoundError for an unknown user", async () => {
    await expect(getAccountForUser("no-such-user")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createAccountForUser returns the existing account when the user already has one", async () => {
    const user = await makeUser("twice@example.com");
    const first = await createAccountForUser(user.id, user.email);
    const second = await createAccountForUser(user.id, user.email);
    expect(second.id).toBe(first.id);
    expect(await db.select().from(accounts)).toHaveLength(1);
    expect(await db.select().from(memberships)).toHaveLength(1);
  });
});
