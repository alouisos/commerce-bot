import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { accountInvites, accounts, memberships, session, user } from "@/db/schema";
import { acceptInvite } from "@/lib/accept-invite";
import { getAccountForUser } from "@/lib/accounts";
import { auth } from "@/lib/auth";
import { createInvite } from "@/lib/invites";
import { resetDb } from "../helpers/db";

type Email = { to: string; subject: string; text: string };
const email = vi.hoisted(() => ({ sent: [] as Email[] }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: Email) => void email.sent.push(m) }));

import { POST as authPOST } from "@/app/api/auth/[...all]/route";
import InvitePage from "@/app/invite/[token]/page";
import SignUpPage from "@/app/(auth)/sign-up/page";

beforeEach(async () => {
  await resetDb();
  email.sent = [];
});

const tokenOf = (to: string) => /\/invite\/([A-Za-z0-9_-]+)/.exec(email.sent.filter((m) => m.to === to).at(-1)!.text)![1];

async function invited(addr = "eleni@shop.gr", plan: "growth" | "pro" = "growth") {
  const { accountId, inviteId } = await createInvite({ email: addr, accountName: `${addr}'s shop`, plan });
  return { accountId, inviteId, token: tokenOf(addr) };
}

describe("public sign-up is closed", () => {
  it("Better Auth refuses a sign-up without an invite and leaves nothing behind", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "x@example.com", password: "long-enough-pass", name: "x" } }),
    ).rejects.toBeTruthy();
    expect(await db.select().from(user)).toHaveLength(0);
    expect(await db.select().from(accounts)).toHaveLength(0);
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it("so does the HTTP endpoint, even for an invited address", async () => {
    await invited();
    const res = await authPOST(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "eleni@shop.gr", password: "long-enough-pass", name: "Eve" }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(user)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
  });

  it("the sign-up page says it's invite-only", () => {
    const html = renderToStaticMarkup(SignUpPage());
    expect(html).toContain("Concierge is invite-only for now. Contact help@example.com.");
    expect(html).toContain('href="/sign-in"');
  });
});

describe("accepting an invite", () => {
  it("creates the user as owner of the invited account, with its plan", async () => {
    const { accountId, inviteId, token } = await invited();
    expect(await acceptInvite(token, { name: "Eleni", password: "password-12345" })).toEqual({ ok: true });
    const [u] = await db.select().from(user);
    expect(u).toMatchObject({ email: "eleni@shop.gr", name: "Eleni" });
    expect(await db.select().from(memberships)).toMatchObject([{ accountId, userId: u.id, role: "owner" }]);
    expect(await db.select().from(accounts)).toHaveLength(1);
    expect((await getAccountForUser(u.id)).plan).toBe("growth");
    const [inv] = await db.select().from(accountInvites).where(eq(accountInvites.id, inviteId));
    expect(inv.acceptedAt).toBeInstanceOf(Date);
    expect(inv.acceptedUserId).toBe(u.id);
  });

  it("a used, expired or unknown link does nothing", async () => {
    const { token } = await invited();
    await acceptInvite(token, { name: "Eleni", password: "password-12345" });
    const again = await acceptInvite(token, { name: "Eve", password: "password-12345" });
    expect(again).toEqual({ ok: false, error: "This invite link has expired or was already used. Ask help@example.com for a new one." });
    expect(await db.select().from(user)).toHaveLength(1);

    const other = await invited("late@shop.gr");
    await db.update(accountInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(accountInvites.email, "late@shop.gr"));
    expect((await acceptInvite(other.token, { name: "Late", password: "password-12345" })).ok).toBe(false);
    expect((await acceptInvite("nope-nope-nope-nope-nope", { name: "X", password: "password-12345" })).ok).toBe(false);
  });

  it("A's link only ever creates A, in A's account", async () => {
    const a = await invited("a@shop.gr", "growth");
    const b = await invited("b@shop.gr", "pro");
    await acceptInvite(a.token, { name: "A", password: "password-12345" });
    const users = await db.select().from(user);
    expect(users.map((u) => u.email)).toEqual(["a@shop.gr"]);
    expect((await db.select().from(memberships))[0].accountId).toBe(a.accountId);
    // B's invite is untouched and still usable.
    expect((await acceptInvite(b.token, { name: "B", password: "password-12345" })).ok).toBe(true);
    const bUser = (await db.select().from(user).where(eq(user.email, "b@shop.gr")))[0];
    expect((await getAccountForUser(bUser.id)).id).toBe(b.accountId);
  });

  it("checks the name and password", async () => {
    const { token } = await invited();
    expect((await acceptInvite(token, { name: "", password: "password-12345" })).ok).toBe(false);
    expect((await acceptInvite(token, { name: "Eleni", password: "short" })).ok).toBe(false);
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("two accepts at once make one user", async () => {
    const { token } = await invited();
    await Promise.all([
      acceptInvite(token, { name: "One", password: "password-12345" }),
      acceptInvite(token, { name: "Two", password: "password-12345" }),
    ]);
    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(memberships)).toHaveLength(1);
  });
});

describe("the invite page", () => {
  const render = async (token: string) =>
    renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ token }) } as never));

  it("shows who it's for, or that it's no longer valid", async () => {
    const { token } = await invited();
    const html = await render(token);
    expect(html).toContain("Set up your Concierge account");
    expect(html).toContain("for eleni@shop.gr");
    expect(await render("nope-nope-nope-nope-nope")).toContain("This invite link has expired or was already used.");
  });
});
