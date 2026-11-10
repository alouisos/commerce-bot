import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, emailMessages, sales, storeConnections } from "@/db/schema";
import { POST as orderPOST } from "@/app/api/widget/order/route";
import { clearEnqueuedJobs, enqueuedJobs, JOBS } from "@/lib/jobs";
import { recordSighting } from "@/lib/sales/record";
import { getSiteByPublicKey } from "@/lib/sites";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeImpression, makeMessage, makeSite } from "../helpers/factories";

beforeEach(async () => {
  await resetDb();
  clearEnqueuedJobs();
});

const SID = "visitor_buying_1";
const URL_ = "https://example.com/checkout/order-received/1234/";
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

async function setup() {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id);
  return { site: (await getSiteByPublicKey(site.publicKey))!, raw: site };
}

let n = 0;
async function subscriber(siteId: string, clickedDaysAgo: number | null) {
  n++;
  const [c] = await db
    .insert(contacts)
    .values({
      siteId,
      email: `buyer${n}@example.com`,
      language: "en",
      status: "subscribed",
      consentText: "x",
      consentLanguage: "en",
      consentedAt: daysAgo(40),
      confirmedAt: daysAgo(40),
      token: `tok-sales-${n}`.padEnd(43, "x"),
      ref: `ref-sales-${n}`.padEnd(22, "y"),
      sequenceConversationId: (await makeConversation(siteId)).id,
    })
    .returning();
  const [sentMsg] = await db
    .insert(emailMessages)
    .values({
      siteId,
      contactId: c.id,
      step: 1,
      status: "sent",
      subject: "s",
      body: "b",
      language: "en",
      scheduledFor: daysAgo(10),
      sentAt: daysAgo(10),
      lastClickedAt: clickedDaysAgo === null ? null : daysAgo(clickedDaysAgo),
      clickedAt: clickedDaysAgo === null ? null : daysAgo(clickedDaysAgo),
    })
    .returning();
  const [draft] = await db
    .insert(emailMessages)
    .values({ siteId, contactId: c.id, step: 2, status: "draft", subject: "s", body: "b", language: "en", scheduledFor: now })
    .returning();
  return { contact: c, sentMsg, draft };
}

const sighting = (over: Record<string, unknown> = {}) => ({ sid: SID, url: URL_, orderId: null, orderKey: null, ref: null, ...over });
const allSales = () => db.select().from(sales);

describe("recording a purchase (no store connection)", () => {
  it("after a chat in this visit: an unverified sale without an amount", async () => {
    const { site } = await setup();
    const convo = await makeConversation(site.id, { visitorSessionId: SID, createdAt: daysAgo(0.01) });
    await makeMessage(convo.id, { role: "visitor" });
    await recordSighting(site, sighting({ orderId: "1234" }), now);
    const [sale] = await allSales();
    expect(sale).toMatchObject({
      source: "page",
      verified: false,
      amountMinor: null,
      externalId: "1234",
      viaChat: true,
      viaPrompt: false,
      viaEmail: false,
      conversationId: convo.id,
      visitorSessionId: SID,
      pageUrl: URL_,
    });
  });

  it("opening the chat without typing isn't a chat sale", async () => {
    const { site } = await setup();
    await makeConversation(site.id, { visitorSessionId: SID, createdAt: daysAgo(0.01) });
    await recordSighting(site, sighting(), now);
    expect(await allSales()).toHaveLength(0);
  });

  it("a chat in another visit doesn't count", async () => {
    const { site } = await setup();
    const convo = await makeConversation(site.id, { visitorSessionId: "someone_else_1", createdAt: daysAgo(0.01) });
    await makeMessage(convo.id);
    await recordSighting(site, sighting(), now);
    expect(await allSales()).toHaveLength(0);
  });

  it("a tapped suggestion counts; one only shown doesn't", async () => {
    const { site } = await setup();
    await makeImpression(site.id, { visitorSessionId: SID, shownAt: daysAgo(0.01), createdAt: daysAgo(0.01) });
    await recordSighting(site, sighting(), now);
    expect(await allSales()).toHaveLength(0);
    const tapped = await makeImpression(site.id, {
      visitorSessionId: SID,
      shownAt: daysAgo(0.01),
      createdAt: daysAgo(0.01),
      outcome: "tapped",
    });
    await recordSighting(site, sighting({ url: "https://example.com/thank-you/" }), now);
    const [sale] = await allSales();
    expect(sale).toMatchObject({ viaPrompt: true, viaChat: false, promptImpressionId: tapped.id });
  });

  it("an email click within 30 days counts and stops the series; at 31 days it doesn't", async () => {
    const { site } = await setup();
    const recent = await subscriber(site.id, 5);
    await recordSighting(site, sighting({ ref: recent.contact.ref }), now);
    const [sale] = await allSales();
    expect(sale).toMatchObject({ viaEmail: true, contactId: recent.contact.id, emailMessageId: recent.sentMsg.id });
    const [draft] = await db.select().from(emailMessages).where(eq(emailMessages.id, recent.draft.id));
    expect(draft.status).toBe("discarded");
    const [c] = await db.select().from(contacts).where(eq(contacts.id, recent.contact.id));
    expect(c.sequenceConversationId).toBeNull();

    const old = await subscriber(site.id, 31);
    await recordSighting(site, sighting({ ref: old.contact.ref, sid: "visitor_other_2" }), now);
    expect(await allSales()).toHaveLength(1);
  });

  it("another site's ref attributes nothing", async () => {
    const { site } = await setup();
    const other = await makeSite((await makeAccount()).id);
    const foreign = await subscriber(other.id, 2);
    await recordSighting(site, sighting({ ref: foreign.contact.ref }), now);
    expect(await allSales()).toHaveLength(0);
    const [draft] = await db.select().from(emailMessages).where(eq(emailMessages.id, foreign.draft.id));
    expect(draft.status).toBe("draft");
  });

  it("the same page seen twice in a visit is one sale", async () => {
    const { site } = await setup();
    const convo = await makeConversation(site.id, { visitorSessionId: SID, createdAt: daysAgo(0.01) });
    await makeMessage(convo.id);
    await recordSighting(site, sighting(), now);
    await recordSighting(site, sighting(), now);
    expect(await allSales()).toHaveLength(1);
  });
});

describe("recording a purchase on a WooCommerce-connected site", () => {
  async function connect(siteId: string) {
    await db.insert(storeConnections).values({
      siteId,
      platform: "woocommerce",
      storeUrl: "https://example.com",
      consumerKey: "ck_" + "a".repeat(40),
      consumerSecretEnc: "v1.x.y.z",
      verifiedAt: now,
    });
  }

  it("hands the order to the verify job and stores nothing yet", async () => {
    const { site } = await setup();
    await connect(site.id);
    const convo = await makeConversation(site.id, { visitorSessionId: SID, createdAt: daysAgo(0.01) });
    await makeMessage(convo.id);
    await recordSighting(site, sighting({ orderId: "1234", orderKey: "wc_order_AbC123xyz", ref: "r1" }), now);
    expect(await allSales()).toHaveLength(0);
    const jobs = enqueuedJobs().filter((j) => j.name === JOBS.verifyOrder);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({
      siteId: site.id,
      sid: SID,
      url: URL_,
      orderId: "1234",
      orderKey: "wc_order_AbC123xyz",
      ref: "r1",
      seenAt: now.toISOString(),
    });
    expect(jobs[0].options).toMatchObject({ singletonKey: `${site.id}:1234`, singletonSeconds: 3600 });
  });

  it("without an order key, nothing happens", async () => {
    const { site } = await setup();
    await connect(site.id);
    const convo = await makeConversation(site.id, { visitorSessionId: SID, createdAt: daysAgo(0.01) });
    await makeMessage(convo.id);
    await recordSighting(site, sighting({ orderId: "1234" }), now);
    expect(enqueuedJobs()).toHaveLength(0);
    expect(await allSales()).toHaveLength(0);
  });
});

describe("POST /api/widget/order", () => {
  const post = (key: string, body: unknown, ip = "1.2.3.4") =>
    orderPOST(
      new Request(`http://localhost:3000/api/widget/order?key=${key}`, {
        method: "POST",
        headers: { Origin: "https://example.com", "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify(body),
      }),
    );

  it("204 for a well-formed beacon, attributed or not; 400 for a bad one; 429 past the limit", async () => {
    const { raw } = await setup();
    const ok = { key: raw.publicKey, ...sighting({ orderId: "1234", orderKey: "wc_order_AbC123xyz" }) };
    expect((await post(raw.publicKey, ok)).status).toBe(204);
    expect(await allSales()).toHaveLength(0);
    expect((await post(raw.publicKey, { ...ok, orderKey: "<script>" })).status).toBe(400);
    expect((await post(raw.publicKey, { ...ok, url: "javascript:alert(1)" })).status).toBe(400);
    for (let i = 0; i < 4; i++) await post(raw.publicKey, ok);
    expect((await post(raw.publicKey, ok)).status).toBe(429);
  });

  it("caps beacons per site, whatever the visit or address", async () => {
    const { raw } = await setup();
    let last = 0;
    for (let i = 0; i < 201; i++) {
      const res = await post(raw.publicKey, { key: raw.publicKey, ...sighting({ sid: `visitor_many_${i}` }) }, `10.1.${Math.floor(i / 50)}.${i % 50}`);
      last = res.status;
      if (i < 200) expect(res.status).toBe(204);
    }
    expect(last).toBe(429);
  });

  it("an unknown key or another origin is refused", async () => {
    const { raw } = await setup();
    expect((await post("pk_nope", { key: "pk_nope", ...sighting() })).status).toBe(404);
    const res = await orderPOST(
      new Request(`http://localhost:3000/api/widget/order?key=${raw.publicKey}`, {
        method: "POST",
        headers: { Origin: "https://evil.com", "Content-Type": "application/json" },
        body: JSON.stringify({ key: raw.publicKey, ...sighting() }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
