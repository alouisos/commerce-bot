import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { contacts, conversations, emailMessages, leads, messages, promptImpressions, sales } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { approveDraft, deletePerson, discardDraft, listPeople, listQueue, listSent, updateDraft } from "@/lib/email/admin";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeLead, makeMembership, makeMessage, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import EmailsPage from "@/app/app/sites/[siteId]/emails/page";
import {
  approveDraftAction,
  deletePersonAction,
  saveDraftAction,
} from "@/app/app/sites/[siteId]/emails/actions";
import LeadsPage from "@/app/app/sites/[siteId]/leads/page";

beforeEach(resetDb);

let n = 0;
async function contact(siteId: string, email: string, over: Partial<typeof contacts.$inferInsert> = {}) {
  n++;
  const [c] = await db
    .insert(contacts)
    .values({
      siteId,
      email,
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: new Date("2026-11-01T10:00:00Z"),
      confirmedAt: new Date("2026-11-01T11:00:00Z"),
      token: `tok${n}`.padEnd(43, "x"),
      ref: `ref${n}`.padEnd(22, "y"),
      ...over,
    })
    .returning();
  return c;
}

async function email(siteId: string, contactId: string, over: Partial<typeof emailMessages.$inferInsert> = {}) {
  const [m] = await db
    .insert(emailMessages)
    .values({
      siteId,
      contactId,
      step: 1,
      status: "draft",
      subject: "Your hair",
      body: "Hello",
      language: "en",
      scheduledFor: new Date("2026-11-02T10:00:00Z"),
      ...over,
    })
    .returning();
  return m;
}

async function setup() {
  const u = await makeUser();
  const account = await makeAccount({ plan: "starter" });
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email };
  const site = await makeSite(account.id, { name: "Milian Jo", baseUrl: "https://milianjo.com", allowedOrigins: ["https://milianjo.com"] });
  const foreign = await makeSite((await makeAccount()).id);
  return { site, foreign };
}

const rowOf = async (id: string) => (await db.select().from(emailMessages).where(eq(emailMessages.id, id)))[0];
const render = async (siteId: string, tab?: string) =>
  renderToStaticMarkup(
    await EmailsPage({
      params: Promise.resolve({ siteId }),
      searchParams: Promise.resolve(tab ? { tab } : {}),
    } as never),
  );
async function outcome(p: Promise<unknown>): Promise<{ value?: unknown; digest?: string }> {
  try {
    return { value: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest) throw e;
    return { digest };
  }
}
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("queue", () => {
  it("a member sees the drafts oldest first; a non-member gets the 404", async () => {
    const { site, foreign } = await setup();
    const convo = await makeConversation(site.id);
    const a = await contact(site.id, "a@example.com");
    const b = await contact(site.id, "b@example.com");
    await email(site.id, b.id, { subject: "Second", createdAt: new Date("2026-11-03T00:00:00Z") });
    await email(site.id, a.id, { subject: "First", conversationId: convo.id, createdAt: new Date("2026-11-02T00:00:00Z") });
    const q = await listQueue(site.id);
    expect(q.map((d) => [d.subject, d.email])).toEqual([
      ["First", "a@example.com"],
      ["Second", "b@example.com"],
    ]);
    const html = await render(site.id);
    expect(html).toContain("First");
    expect(html).toContain(`/app/sites/${site.id}/conversations/${convo.id}`);
    expect(html).toContain("Approve &amp; send");
    expect((await outcome(render(foreign.id))).digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("shows the banner without a verified domain, and the empty text", async () => {
    const { site } = await setup();
    const html = await render(site.id);
    expect(html).toContain("Set up your sending domain in Settings before emails can go out.");
    expect(html).toContain("No emails waiting for approval.");
  });

  it("shows the automatic banner", async () => {
    const u = await makeUser();
    const account = await makeAccount({ plan: "growth" });
    await makeMembership(account.id, u.id);
    current.user = { id: u.id, email: u.email };
    const site = await makeSite(account.id, { emailMode: "automatic", sendingDomain: "example.com", sendingDomainStatus: "verified" });
    const html = await render(site.id);
    expect(html).toContain("Emails send automatically. Switch to approval in Settings to review them first.");
    expect(html).not.toContain("Set up your sending domain");
  });

  it("an edit keeps on-site links and drops off-site ones; a sent email can't be edited", async () => {
    const { site } = await setup();
    const a = await contact(site.id, "a@example.com");
    const d = await email(site.id, a.id);
    await updateDraft(site.id, d.id, {
      subject: "  New subject ",
      body: "See [this](https://milianjo.com/p/1) and [that](https://evil.com/x).",
    });
    const row = await rowOf(d.id);
    expect(row.subject).toBe("New subject");
    expect(row.links).toEqual(["https://milianjo.com/p/1"]);
    expect(row.body).not.toContain("evil.com");

    await expect(updateDraft(site.id, d.id, { subject: "", body: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateDraft(site.id, d.id, { subject: "x".repeat(121), body: "x" })).rejects.toBeInstanceOf(ValidationError);
    const sent = await email(site.id, (await contact(site.id, "c@example.com")).id, { status: "sent" });
    await expect(updateDraft(site.id, sent.id, { subject: "s", body: "b" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("approve and discard", async () => {
    const { site } = await setup();
    const d1 = await email(site.id, (await contact(site.id, "a@example.com")).id);
    const d2 = await email(site.id, (await contact(site.id, "b@example.com")).id);
    await approveDraft(site.id, d1.id);
    const r1 = await rowOf(d1.id);
    expect(r1.status).toBe("approved");
    expect(r1.scheduledFor.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await discardDraft(site.id, d2.id);
    expect((await rowOf(d2.id)).status).toBe("discarded");
  });

  it("another site's draft id is not found through the actions, and nothing changes", async () => {
    const { site, foreign } = await setup();
    const d = await email(foreign.id, (await contact(foreign.id, "a@example.com")).id);
    expect((await outcome(approveDraftAction(site.id, d.id, {}, form({ subject: "s", body: "b" })))).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(
      (await outcome(saveDraftAction(site.id, d.id, {}, form({ subject: "hacked", body: "hacked" })))).digest,
    ).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await rowOf(d.id)).toMatchObject({ status: "draft", subject: "Your hair" });
    // And the foreign site itself is a 404.
    expect((await outcome(approveDraftAction(foreign.id, d.id, {}, form({ subject: "s", body: "b" })))).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});

describe("approving with edits", () => {
  it("Approve & send saves what the admin typed before approving", async () => {
    const { site } = await setup();
    const d = await email(site.id, (await contact(site.id, "a@example.com")).id);
    const res = await approveDraftAction(site.id, d.id, {}, form({ subject: "Fixed subject", body: "Corrected [link](https://milianjo.com/p/1)" }));
    expect(res).toEqual({ saved: true });
    expect(await rowOf(d.id)).toMatchObject({
      status: "approved",
      subject: "Fixed subject",
      body: "Corrected [link](https://milianjo.com/p/1)",
      links: ["https://milianjo.com/p/1"],
    });
  });

  it("an invalid edit is refused and nothing is approved", async () => {
    const { site } = await setup();
    const d = await email(site.id, (await contact(site.id, "a@example.com")).id);
    const res = await approveDraftAction(site.id, d.id, {}, form({ subject: "", body: "x" }));
    expect(res.error).toBeTruthy();
    expect((await rowOf(d.id)).status).toBe("draft");
  });
});

describe("sent and people", () => {
  it("lists sent emails newest first with clicks, and people with their counts", async () => {
    const { site } = await setup();
    const a = await contact(site.id, "a@example.com");
    await email(site.id, a.id, { status: "sent", subject: "Old", sentAt: new Date("2026-11-03T00:00:00Z"), clicks: 2 });
    await email(site.id, a.id, { status: "sent", subject: "New", sentAt: new Date("2026-11-07T00:00:00Z") });
    await contact(site.id, "p@example.com", { status: "pending", confirmedAt: null });
    const sent = await listSent(site.id, 1);
    expect(sent.rows.map((r) => [r.subject, r.clicks])).toEqual([
      ["New", 0],
      ["Old", 2],
    ]);
    const people = await listPeople(site.id);
    expect(people.find((p) => p.email === "a@example.com")).toMatchObject({ status: "subscribed", sent: 2 });
    expect(people.find((p) => p.email === "p@example.com")).toMatchObject({ status: "pending", sent: 0 });
    expect(await render(site.id, "sent")).toContain("New");
    expect(await render(site.id, "people")).toContain("p@example.com");
  });
});

describe("deletePerson: everything from the same visit", () => {
  it("also removes the visit's other conversations and suggestions, and anonymises its sales", async () => {
    const { site } = await setup();
    const sid = "visit_to_erase_1";
    const withLead = await makeConversation(site.id, { visitorSessionId: sid });
    const sameVisit = await makeConversation(site.id, { visitorSessionId: sid });
    await makeLead(site.id, { email: "erase@example.com", conversationId: withLead.id });
    await db.insert(promptImpressions).values({
      siteId: site.id, visitorSessionId: sid, kind: "question", intent: "exploring", confidence: 0.8, language: "en",
      pageUrl: "https://milianjo.com/p", text: "t", question: "q",
    });
    const [sale] = await db.insert(sales).values({
      siteId: site.id, source: "woocommerce", externalId: "77", verified: true, orderedAt: new Date(),
      visitorSessionId: sid, pageUrl: "https://milianjo.com/checkout/order-received/77/", viaChat: true,
    }).returning();
    const otherVisit = await makeConversation(site.id, { visitorSessionId: "someone_else_visit" });

    await deletePerson(site.id, "erase@example.com");

    expect(await db.select().from(conversations).where(eq(conversations.id, sameVisit.id))).toHaveLength(0);
    expect(await db.select().from(promptImpressions).where(eq(promptImpressions.visitorSessionId, sid))).toHaveLength(0);
    const [kept] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(kept).toMatchObject({ visitorSessionId: "", pageUrl: "", viaChat: true });
    expect(await db.select().from(conversations).where(eq(conversations.id, otherVisit.id))).toHaveLength(1);
  });
});

describe("deletePerson", () => {
  it("removes one person's leads, conversations, contact and emails, on one site only", async () => {
    const { site, foreign } = await setup();
    const aConvo = await makeConversation(site.id);
    await makeMessage(aConvo.id);
    const aLinked = await makeConversation(site.id);
    const a = await contact(site.id, "a@example.com", { sequenceConversationId: aConvo.id });
    await db.update(conversations).set({ contactId: a.id }).where(eq(conversations.id, aLinked.id));
    await makeLead(site.id, { email: "a@example.com", conversationId: aConvo.id });
    await email(site.id, a.id, { conversationId: aConvo.id });

    const bConvo = await makeConversation(site.id);
    const b = await contact(site.id, "b@example.com");
    await makeLead(site.id, { email: "b@example.com", conversationId: bConvo.id });
    await email(site.id, b.id);

    const elsewhere = await contact(foreign.id, "a@example.com");
    const elseLead = await makeLead(foreign.id, { email: "a@example.com" });

    expect(await deletePerson(site.id, "  A@Example.com ")).toEqual({ deleted: true });

    expect(await db.select().from(contacts).where(eq(contacts.id, a.id))).toHaveLength(0);
    expect(await db.select().from(emailMessages).where(eq(emailMessages.contactId, a.id))).toHaveLength(0);
    expect(await db.select().from(conversations).where(eq(conversations.id, aConvo.id))).toHaveLength(0);
    expect(await db.select().from(conversations).where(eq(conversations.id, aLinked.id))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.conversationId, aConvo.id))).toHaveLength(0);
    expect((await db.select().from(leads).where(eq(leads.siteId, site.id))).map((l) => l.email)).toEqual(["b@example.com"]);

    expect(await db.select().from(contacts).where(eq(contacts.id, b.id))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.id, bConvo.id))).toHaveLength(1);
    expect(await db.select().from(emailMessages).where(eq(emailMessages.contactId, b.id))).toHaveLength(1);
    expect(await db.select().from(contacts).where(eq(contacts.id, elsewhere.id))).toHaveLength(1);
    expect(await db.select().from(leads).where(eq(leads.id, elseLead.id))).toHaveLength(1);

    expect(await deletePerson(site.id, "a@example.com")).toEqual({ deleted: false });
  });

  it("the action needs the email typed again", async () => {
    const { site } = await setup();
    await contact(site.id, "a@example.com");
    expect(await deletePersonAction(site.id, {}, form({ email: "a@example.com", confirm: "b@example.com" }))).toEqual({
      error: "To confirm, type the email exactly: a@example.com",
    });
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(await deletePersonAction(site.id, {}, form({ email: "a@example.com", confirm: "A@example.com" }))).toEqual({
      saved: true,
    });
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("the leads page offers deleting the person", async () => {
    const { site } = await setup();
    await makeLead(site.id, { email: "lead@example.com" });
    const html = renderToStaticMarkup(await LeadsPage({ params: Promise.resolve({ siteId: site.id }) } as never));
    expect(html).toContain("Delete all data");
  });
});
