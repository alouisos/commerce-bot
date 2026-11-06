import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { leads } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
type Email = { to: string; subject: string; text: string };
const email = vi.hoisted(() => ({ sendEmail: vi.fn<(msg: Email) => Promise<void>>(async () => {}) }));
vi.mock("@/lib/email", () => email);

import LeadsPage from "@/app/app/sites/[siteId]/leads/page";
import { createLead } from "@/lib/widget/lead";
import { getSiteByPublicKey } from "@/lib/sites";

beforeEach(async () => {
  await resetDb();
  email.sendEmail.mockReset();
  email.sendEmail.mockImplementation(async () => {});
});

async function setup() {
  const owner = await makeUser("owner@example.com");
  const admin = await makeUser("admin@example.com");
  const acc = await makeAccount();
  await makeMembership(acc.id, owner.id, "owner");
  await makeMembership(acc.id, admin.id, "admin");
  const site = await makeSite(acc.id, { name: "Argan Shop" });
  const site2 = await makeSite(acc.id, { name: "Second Shop" });
  const other = await makeSite((await makeAccount()).id);
  current.user = { id: owner.id, email: owner.email };
  return { owner, site, site2, other };
}

async function digest(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
  return undefined;
}

const render = async (siteId: string) =>
  renderToStaticMarkup(await LeadsPage({ params: Promise.resolve({ siteId }) } as never));

describe("leads page", () => {
  it("lists this site's leads newest first, and nothing from another site", async () => {
    const s = await setup();
    const conv = await makeConversation(s.site.id);
    const t = Date.now();
    await db.insert(leads).values([
      { siteId: s.site.id, email: "old@example.com", message: "Older question", createdAt: new Date(t - 3 * 3_600_000) },
      { siteId: s.site.id, conversationId: conv.id, email: "new@example.com", message: "Newer question", createdAt: new Date(t - 60_000) },
      { siteId: s.site2.id, email: "elsewhere@example.com", message: "Other site" },
    ]);
    const html = await render(s.site.id);
    expect(html).toContain("new@example.com");
    expect(html).toContain("Newer question");
    expect(html).toContain(conv.id);
    expect(html).toContain("1 minute ago");
    expect(html).toContain("3 hours ago");
    expect(html.indexOf("new@example.com")).toBeLessThan(html.indexOf("old@example.com"));
    expect(html).not.toContain("elsewhere@example.com");
  });

  it("shows at most 200 leads", async () => {
    const s = await setup();
    const t = Date.now();
    await db.insert(leads).values(
      Array.from({ length: 205 }, (_, i) => ({
        siteId: s.site.id,
        email: `v${i}@example.com`,
        message: "m",
        createdAt: new Date(t - i * 1000),
      })),
    );
    const html = await render(s.site.id);
    expect(html).toContain("v199@example.com");
    expect(html).not.toContain("v200@example.com");
  });

  it("is not found for another account's site", async () => {
    const s = await setup();
    expect(await digest(render(s.other.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("createLead notification", () => {
  it("emails the account owner with the lead and a link to the leads page, without blocking", async () => {
    const s = await setup();
    const site = (await getSiteByPublicKey(s.site.publicKey))!;
    await createLead(site, { sid: "visitor_session_1", cid: null, email: "Visitor@Example.com", message: "Do you ship to Crete?" }, "203.0.113.9");
    await vi.waitFor(() => expect(email.sendEmail).toHaveBeenCalledTimes(1));
    const msg = email.sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("owner@example.com");
    expect(msg.subject).toBe("New message from a visitor on Argan Shop");
    expect(msg.text).toContain("visitor@example.com");
    expect(msg.text).toContain("Do you ship to Crete?");
    expect(msg.text).toContain(`http://localhost:3000/app/sites/${s.site.id}/leads`);
  });

  it("stores the lead even when sending the email fails, and logs the failure", async () => {
    const s = await setup();
    const site = (await getSiteByPublicKey(s.site.publicKey))!;
    email.sendEmail.mockRejectedValue(new Error("resend down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      createLead(site, { sid: "visitor_session_1", cid: null, email: "a@b.co", message: "Hi" }, "203.0.113.9"),
    ).resolves.toBeUndefined();
    expect(await db.select().from(leads)).toHaveLength(1);
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    errors.mockRestore();
  });
});
