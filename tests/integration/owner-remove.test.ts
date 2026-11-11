import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accountInvites, accounts, conversations, memberships, sites, user } from "@/db/schema";
import { account as credential, session } from "@/db/auth-schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMembership, makeSite, makeUser } from "../helpers/factories";
import { ValidationError } from "@/lib/errors";

type Email = { to: string; subject: string; text: string };
const email = vi.hoisted(() => ({ sent: [] as Email[] }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: Email) => void email.sent.push(m) }));

const who = vi.hoisted(() => ({ id: "u", email: "boss@example.com" }));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ ...who, emailVerified: true }) }));
vi.mock("@/lib/access", async (orig) => {
  const mod = await orig<typeof import("@/lib/access")>();
  return { ...mod, isPlatformOwner: (u: { email: string; emailVerified: boolean }) => mod.isPlatformOwner(u, ["boss@example.com"]) };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { removeAccountAction } from "@/app/owner/actions";
import { removeAccount, restoreAccount } from "@/lib/owner/accounts";
import { getSiteByPublicKey } from "@/lib/sites";
import { findUsableInvite } from "@/lib/invites";

beforeEach(async () => {
  await resetDb();
  email.sent.length = 0;
});

async function seed() {
  const acct = await makeAccount();
  const member = await makeUser("cust@example.com");
  await makeMembership(acct.id, member.id);
  await db.insert(session).values({ id: "s1", token: "t1", userId: member.id, expiresAt: new Date(Date.now() + 1e7) });
  await db.insert(credential).values({ id: "c1", accountId: member.id, providerId: "credential", userId: member.id });
  const site = await makeSite(acct.id);
  const convo = await makeConversation(site.id);
  const other = await makeAccount();
  const bystander = await makeUser("other@example.com");
  await makeMembership(other.id, bystander.id);
  await db.insert(session).values({ id: "s2", token: "t2", userId: bystander.id, expiresAt: new Date(Date.now() + 1e7) });
  return { acct, member, site, convo, bystander };
}

describe("removeAccount", () => {
  it("deletes only the account's logins and sessions, keeps data, turns the bot off", async () => {
    const { acct, member, site, convo, bystander } = await seed();
    const actor = await makeUser("boss@example.com");
    const now = new Date("2026-11-11T10:00:00Z");
    await removeAccount(acct.id, actor.id, now);

    expect(await db.select().from(user).where(eq(user.id, member.id))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, member.id))).toHaveLength(0);
    expect(await db.select().from(credential).where(eq(credential.userId, member.id))).toHaveLength(0);
    expect(await db.select().from(memberships).where(eq(memberships.accountId, acct.id))).toHaveLength(0);
    // Other customers and the acting owner are untouched.
    expect(await db.select().from(user).where(eq(user.id, bystander.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.userId, bystander.id))).toHaveLength(1);
    expect(await db.select().from(user).where(eq(user.id, actor.id))).toHaveLength(1);

    const [row] = await db.select().from(accounts).where(eq(accounts.id, acct.id));
    expect(row.removedAt?.toISOString()).toBe(now.toISOString());
    expect(await db.select().from(sites).where(eq(sites.id, site.id))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.id, convo.id))).toHaveLength(1);
    expect(await getSiteByPublicKey(site.publicKey)).toBeNull();
  });

  it("refuses to remove the acting owner's own account and changes nothing", async () => {
    const { acct, member } = await seed();
    await expect(removeAccount(acct.id, member.id)).rejects.toThrow("You can't remove your own account.");
    await expect(removeAccount(acct.id, member.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(user).where(eq(user.id, member.id))).toHaveLength(1);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, acct.id));
    expect(row.removedAt).toBeNull();
  });

  it("drops pending invites so nobody can log back in with an old link", async () => {
    const { acct } = await seed();
    await db.insert(accountInvites).values({ accountId: acct.id, email: "x@example.com", tokenHash: "h", expiresAt: new Date(Date.now() + 1e9) });
    await removeAccount(acct.id, (await makeUser()).id);
    expect(await db.select().from(accountInvites).where(eq(accountInvites.accountId, acct.id))).toHaveLength(0);
  });
});

describe("restoreAccount", () => {
  it("clears removedAt, turns the bot on and invites the email to the same account", async () => {
    const { acct, site } = await seed();
    await removeAccount(acct.id, (await makeUser()).id);
    const { inviteId } = await restoreAccount(acct.id, " New@Example.com ");
    const [row] = await db.select().from(accounts).where(eq(accounts.id, acct.id));
    expect(row.removedAt).toBeNull();
    expect(await getSiteByPublicKey(site.publicKey)).not.toBeNull();
    const [invite] = await db.select().from(accountInvites).where(eq(accountInvites.id, inviteId));
    expect(invite.accountId).toBe(acct.id);
    expect(invite.email).toBe("new@example.com");
    expect(email.sent).toHaveLength(1);
    const token = email.sent[0].text.match(/\/invite\/(\S+)/)![1];
    expect((await findUsableInvite(token))?.accountId).toBe(acct.id);
    expect(await db.$count(accounts)).toBe(2);
  });

  it("rejects an account that isn't removed", async () => {
    const acct = await makeAccount();
    await expect(restoreAccount(acct.id, "a@example.com")).rejects.toBeInstanceOf(ValidationError);
  });

  it("stays removed when the invite can't be created", async () => {
    const { acct } = await seed();
    await removeAccount(acct.id, (await makeUser()).id);
    await makeUser("taken@example.com");
    await expect(restoreAccount(acct.id, "taken@example.com")).rejects.toBeInstanceOf(ValidationError);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, acct.id));
    expect(row.removedAt).not.toBeNull();
  });
});

describe("removeAccountAction", () => {
  it("needs the typed name, and only the platform owner can use it", async () => {
    const { acct, member } = await seed();
    const form = (name: string) => {
      const f = new FormData();
      f.set("confirmName", name);
      return f;
    };
    who.email = "boss@example.com";
    expect(await removeAccountAction(acct.id, {}, form("wrong"))).toEqual({ error: "The name doesn't match." });
    expect(await db.select().from(user).where(eq(user.id, member.id))).toHaveLength(1);

    who.email = "nobody@example.com";
    await expect(removeAccountAction(acct.id, {}, form(acct.name))).rejects.toThrow();
    expect(await db.select().from(user).where(eq(user.id, member.id))).toHaveLength(1);

    who.email = "boss@example.com";
    expect(await removeAccountAction(acct.id, {}, form(acct.name))).toEqual({ saved: true });
    expect(await db.select().from(user).where(eq(user.id, member.id))).toHaveLength(0);
  });
});
