import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships } from "@/db/schema";
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
    expect(isPlatformOwner("A@X.com", ["a@x.com"])).toBe(true);
    expect(isPlatformOwner("b@x.com", ["a@x.com"])).toBe(false);
  });
});
