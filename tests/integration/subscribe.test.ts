import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { contacts, conversations, emailMessages, leads, rateLimits } from "@/db/schema";
import { POST as subscribePOST } from "@/app/api/widget/subscribe/route";
import ConfirmPage from "@/app/e/confirm/[token]/page";
import { confirmContact, consentWording } from "@/lib/email/contacts";
import { setProviderForTests, type OutgoingEmail } from "@/lib/email/provider";
import { hit } from "@/lib/usage/rate-limit";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeMessage, makeSite } from "../helpers/factories";

const ORIGIN = "https://www.milianjo.com";
const sent: OutgoingEmail[] = [];

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  setProviderForTests({
    send: async (m) => {
      sent.push(m);
      return { id: `msg_${sent.length}` };
    },
  });
});
afterEach(() => setProviderForTests(null));

async function setup(verified = true) {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, {
    name: "Milian Jo",
    baseUrl: "https://www.milianjo.com",
    allowedOrigins: [ORIGIN],
    ...(verified ? { sendingDomain: "milianjo.com", sendingDomainStatus: "verified" as const } : {}),
  });
  const sid = "sid-visitor-1";
  const convo = await makeConversation(site.id, { visitorSessionId: sid, language: "el" });
  await makeMessage(convo.id, { content: "Έχω ξηρά μαλλιά" });
  return { account, site, sid, convo };
}

const post = (key: string, body: unknown, ip = "1.2.3.4") =>
  subscribePOST(
    new Request(`http://localhost:3000/api/widget/subscribe?key=${key}`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify(body),
    }),
  );

const contactOf = async (email: string) => (await db.select().from(contacts).where(eq(contacts.email, email)))[0];

describe("subscribe", () => {
  it("stores the server's wording, a consent lead, the conversation link, and sends one confirmation", async () => {
    const { site, sid, convo } = await setup();
    const res = await post(site.publicKey, {
      key: site.publicKey,
      sid,
      cid: convo.id,
      email: "  Maria@Example.COM ",
      language: "el",
      consentText: "I agree to nothing",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    const c = await contactOf("maria@example.com");
    expect(c).toMatchObject({ status: "pending", language: "el", consentLanguage: "el", siteId: site.id });
    expect(c.consentText).toBe(consentWording("el", "Milian Jo"));
    expect(c.consentText).toContain("Milian Jo");
    expect(c.consentText).not.toContain("{site}");
    expect(c.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const [lead] = await db.select().from(leads).where(eq(leads.siteId, site.id));
    expect(lead).toMatchObject({
      source: "consent",
      email: "maria@example.com",
      message: "Asked for personalised recommendations",
      conversationId: convo.id,
    });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, convo.id));
    expect(row.contactId).toBe(c.id);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "maria@example.com", subject: "Επιβεβαιώστε το email σας για το Milian Jo" });
    expect(sent[0].from).toBe('"Milian Jo" <hello@milianjo.com>');
    expect(sent[0].text).toContain(`http://localhost:3000/e/confirm/${c.token}`);
  });

  it("a second subscribe while pending sends a new confirmation without a duplicate contact", async () => {
    const { site, sid, convo } = await setup();
    const body = { key: site.publicKey, sid, cid: convo.id, email: "a@example.com", language: "en" };
    expect((await post(site.publicKey, body)).status).toBe(201);
    const first = await contactOf("a@example.com");
    expect((await post(site.publicKey, body)).status).toBe(201);
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(sent).toHaveLength(2);
    const second = await contactOf("a@example.com");
    expect(sent[1].text).toContain(`/e/confirm/${second.token}`);
    expect(sent[1].subject).toBe("Please confirm your email for Milian Jo");
    expect(second.id).toBe(first.id);
  });

  it("an unsubscribed email goes back to pending with a new confirmation", async () => {
    const { site, sid, convo } = await setup();
    const body = { key: site.publicKey, sid, cid: convo.id, email: "a@example.com", language: "en" };
    await post(site.publicKey, body);
    await db.update(contacts).set({ status: "unsubscribed", unsubscribedAt: new Date() });
    await post(site.publicKey, body);
    expect(await contactOf("a@example.com")).toMatchObject({ status: "pending", unsubscribedAt: null });
    expect(sent).toHaveLength(2);
  });

  it("an already subscribed address entered in another chat changes nothing about that person's emails", async () => {
    const { site, sid, convo } = await setup();
    const body = { key: site.publicKey, sid, cid: convo.id, email: "a@example.com", language: "en" };
    await post(site.publicKey, body);
    const c = await contactOf("a@example.com");
    await confirmContact(c.token);
    const [draft] = await db
      .insert(emailMessages)
      .values({ siteId: site.id, contactId: c.id, conversationId: convo.id, step: 1, status: "draft", subject: "s", body: "b", language: "en", scheduledFor: new Date() })
      .returning();
    // Someone else, in their own chat, types the subscriber's address.
    const stranger = await makeConversation(site.id, { visitorSessionId: "sid-stranger-2" });
    expect((await post(site.publicKey, { ...body, sid: "sid-stranger-2", cid: stranger.id }, "5.6.7.8")).status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(await contactOf("a@example.com")).toMatchObject({ status: "subscribed", sequenceConversationId: convo.id });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, stranger.id));
    expect(row.contactId).toBeNull();
    const [d] = await db.select().from(emailMessages).where(eq(emailMessages.id, draft.id));
    expect(d.status).toBe("draft");
    const strangerLeads = (await db.select().from(leads)).filter((l) => l.conversationId === stranger.id);
    expect(strangerLeads).toHaveLength(0);
  });

  it("403 when the site can't send email", async () => {
    const { site, sid, convo } = await setup(false);
    const res = await post(site.publicKey, { key: site.publicKey, sid, cid: convo.id, email: "a@example.com", language: "en" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Email is not available" });
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("400 on a bad email or language", async () => {
    const { site, sid } = await setup();
    expect((await post(site.publicKey, { key: site.publicKey, sid, cid: null, email: "nope", language: "en" })).status).toBe(400);
    expect((await post(site.publicKey, { key: site.publicKey, sid, cid: null, email: "a@b.com", language: "eng" })).status).toBe(400);
  });

  it("the 4th request in an hour from one visit is rate limited", async () => {
    const { site, sid } = await setup();
    for (let i = 0; i < 3; i++) {
      expect((await post(site.publicKey, { key: site.publicKey, sid, cid: null, email: `p${i}@example.com`, language: "en" })).status).toBe(201);
    }
    expect((await post(site.publicKey, { key: site.publicKey, sid, cid: null, email: "p9@example.com", language: "en" })).status).toBe(429);
  });

  it("one address gets at most 3 confirmations a day, whatever the visit", async () => {
    const { site } = await setup();
    for (let i = 0; i < 3; i++) {
      const res = await post(site.publicKey, { key: site.publicKey, sid: `sid-other-${i}`, cid: null, email: "victim@example.com", language: "en" }, `9.9.9.${i}`);
      expect(res.status).toBe(201);
    }
    const res = await post(site.publicKey, { key: site.publicKey, sid: "sid-other-9", cid: null, email: "victim@example.com", language: "en" }, "9.9.9.9");
    expect(res.status).toBe(429);
    expect(sent).toHaveLength(3);
  });

  it("rate-limit records never hold the address itself", async () => {
    const { site, sid } = await setup();
    await post(site.publicKey, { key: site.publicKey, sid, cid: null, email: "secret.person@example.com", language: "en" });
    const keys = (await db.select().from(rateLimits)).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("sub:email:"))).toBe(true);
    expect(keys.join(" ")).not.toContain("secret.person");
  });

  it("a site sends at most 30 confirmation emails an hour, whatever the IP or visit", async () => {
    const { site } = await setup();
    const windowMs = 3600_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + 1000);
    try {
      for (let i = 0; i < 29; i++) await hit(`sub:site:${site.id}:hour`, 30, 3600);
      const body = (i: number) => ({ key: site.publicKey, sid: `sid-cap-${i}-xxxx`, cid: null, email: `cap${i}@example.com`, language: "en" });
      expect((await post(site.publicKey, body(1), "203.0.113.1")).status).toBe(201);
      expect((await post(site.publicKey, body(2), "203.0.113.2")).status).toBe(429);
      expect(sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("someone else typing a pending address doesn't re-link it to their chat or cancel the first link", async () => {
    const { site, sid, convo } = await setup();
    await post(site.publicKey, { key: site.publicKey, sid, cid: convo.id, email: "pending@example.com", language: "en" });
    const first = await contactOf("pending@example.com");
    const stranger = await makeConversation(site.id, { visitorSessionId: "sid-stranger-9" });
    await post(site.publicKey, { key: site.publicKey, sid: "sid-stranger-9", cid: stranger.id, email: "pending@example.com", language: "en" }, "5.5.5.5");
    const after = await contactOf("pending@example.com");
    expect(after.token).toBe(first.token);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, stranger.id));
    expect(row.contactId).toBeNull();
    expect(await confirmContact(first.token)).not.toBeNull();
    expect((await contactOf("pending@example.com")).sequenceConversationId).toBe(convo.id);
  });

  it("a cid from another visit links nothing", async () => {
    const { site, convo } = await setup();
    await post(site.publicKey, { key: site.publicKey, sid: "sid-attacker", cid: convo.id, email: "x@example.com", language: "en" });
    const [lead] = await db.select().from(leads);
    expect(lead.conversationId).toBeNull();
    const [row] = await db.select().from(conversations).where(eq(conversations.id, convo.id));
    expect(row.contactId).toBeNull();
  });
});

describe("confirmContact", () => {
  async function pending() {
    const s = await setup();
    await post(s.site.publicKey, { key: s.site.publicKey, sid: s.sid, cid: s.convo.id, email: "a@example.com", language: "el" });
    return { ...s, contact: await contactOf("a@example.com") };
  }

  it("subscribes and starts the sequence on the linked conversation", async () => {
    const { contact, convo } = await pending();
    expect(await confirmContact(contact.token)).toEqual({ siteName: "Milian Jo", language: "el" });
    const c = await contactOf("a@example.com");
    expect(c.status).toBe("subscribed");
    expect(c.confirmedAt).toBeInstanceOf(Date);
    expect(c.sequenceConversationId).toBe(convo.id);
    expect(c.sequenceStartedAt).toBeInstanceOf(Date);
    // Idempotent.
    expect(await confirmContact(contact.token)).toEqual({ siteName: "Milian Jo", language: "el" });
    expect((await contactOf("a@example.com")).confirmedAt).toEqual(c.confirmedAt);
  });

  it("an 8-day-old token is expired", async () => {
    const { contact } = await pending();
    await db.update(contacts).set({ consentedAt: new Date(Date.now() - 8 * 86400_000) });
    expect(await confirmContact(contact.token)).toBeNull();
    expect((await contactOf("a@example.com")).status).toBe("pending");
  });

  it("an unknown or unsubscribed token does nothing", async () => {
    const { contact } = await pending();
    expect(await confirmContact("not-a-token")).toBeNull();
    await db.update(contacts).set({ status: "unsubscribed" });
    expect(await confirmContact(contact.token)).toBeNull();
  });

  it("a token only ever affects its own contact", async () => {
    const { contact } = await pending();
    const other = await makeSite((await makeAccount()).id, { sendingDomain: "example.com", sendingDomainStatus: "verified" });
    await db.insert(contacts).values({
      siteId: other.id,
      email: "a@example.com",
      language: "en",
      status: "pending",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: new Date(),
      token: "other-token-other-token-other-token-012345678",
      ref: "other-ref-other-ref-01",
    });
    await confirmContact(contact.token);
    const rows = await db.select().from(contacts).where(eq(contacts.siteId, other.id));
    expect(rows[0].status).toBe("pending");
  });
});

describe("confirm page", () => {
  const render = async (token: string) =>
    renderToStaticMarkup(await ConfirmPage({ params: Promise.resolve({ token }) } as never));

  it("asks for a click, then shows the Greek success text once confirmed", async () => {
    const s = await setup();
    await post(s.site.publicKey, { key: s.site.publicKey, sid: s.sid, cid: s.convo.id, email: "a@example.com", language: "el" });
    const c = await contactOf("a@example.com");
    const before = await render(c.token);
    expect(before).toContain("Επιβεβαίωση");
    expect((await contactOf("a@example.com")).status).toBe("pending");
    await confirmContact(c.token);
    expect(await render(c.token)).toContain("Η εγγραφή σας στο Milian Jo ολοκληρώθηκε.");
  });

  it("an invalid token shows the expired text", async () => {
    expect(await render("bogus")).toContain("This link has expired or isn&#x27;t valid.");
  });
});
