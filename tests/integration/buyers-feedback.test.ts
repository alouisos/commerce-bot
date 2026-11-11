import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { buyerEmails, buyerFeedback, buyerOrders, buyers, type BuyerEmail } from "@/db/schema";
import { isSuppressed } from "@/lib/buyers/suppression";
import { submitFeedback, unsubscribeBuyer } from "@/lib/buyers/feedback";
import { GET as oneClickGET, POST as oneClickPOST } from "@/app/e/b/[token]/one-click/route";
import BuyerUnsubscribePage from "@/app/e/b/[token]/page";
import { unsubscribeBuyerAction } from "@/app/e/b/[token]/actions";
import FeedbackPage from "@/app/e/f/[token]/page";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const EMAIL = "maria@example.com";
const TOKEN = "b".repeat(43);

beforeEach(resetDb);

async function setup() {
  const account = await makeAccount();
  const site = await makeSite(account.id);
  const [buyer] = await db
    .insert(buyers)
    .values({ siteId: site.id, email: EMAIL, firstName: "Maria", status: "subscribed", token: TOKEN, ref: "q".repeat(22) })
    .returning();
  const [order] = await db
    .insert(buyerOrders)
    .values({
      siteId: site.id,
      buyerId: buyer.id,
      externalId: "1",
      orderedAt: new Date("2026-11-10T10:00:00Z"),
      items: [{ productId: 7, name: "Olive <b>oil</b>", url: null }],
    })
    .returning();
  const email = async (step: number, status: BuyerEmail["status"]) =>
    (
      await db
        .insert(buyerEmails)
        .values({ siteId: site.id, buyerId: buyer.id, orderId: order.id, step, status, language: "en", scheduledFor: new Date() })
        .returning()
    )[0];
  return { site, buyer, order, email };
}

const oneClick = (token: string) =>
  oneClickPOST(new Request(`http://localhost:3000/e/b/${token}/one-click`, { method: "POST", body: "List-Unsubscribe=One-Click" }), {
    params: Promise.resolve({ token }),
  });

describe("buyer unsubscribe", () => {
  it("one-click POST unsubscribes and discards every unsent email, scheduled ones included", async () => {
    const { site, buyer, email } = await setup();
    const sched = await email(2, "scheduled");
    const draft = await email(1, "draft");
    const sent = await email(3, "sent");
    expect((await oneClick(TOKEN)).status).toBe(200);
    const [b] = await db.select().from(buyers).where(eq(buyers.id, buyer.id));
    expect(b.status).toBe("unsubscribed");
    const status = async (id: string) => (await db.select().from(buyerEmails).where(eq(buyerEmails.id, id)))[0].status;
    expect(await status(sched.id)).toBe("discarded");
    expect(await status(draft.id)).toBe("discarded");
    expect(await status(sent.id)).toBe("sent");
    expect(await isSuppressed(site.id, EMAIL)).toBe(true);
    expect((await oneClick(TOKEN)).status).toBe(200);
  });

  it("an unknown token is answered the same way and changes nothing", async () => {
    const { buyer } = await setup();
    expect((await oneClick("no-such-token-at-all-000000")).status).toBe(200);
    expect(await unsubscribeBuyer("no-such-token-at-all-000000")).toBeNull();
    expect((await db.select().from(buyers).where(eq(buyers.id, buyer.id)))[0].status).toBe("subscribed");
  });

  it("opening the page or the one-click address never unsubscribes; the button does", async () => {
    await setup();
    const res = await oneClickGET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`http://localhost:3000/e/b/${TOKEN}`);
    const html = renderToStaticMarkup(await BuyerUnsubscribePage({ params: Promise.resolve({ token: TOKEN }) } as never));
    expect(html).toContain("Stop receiving emails from");
    expect((await db.select().from(buyers))[0].status).toBe("subscribed");
    await expect(unsubscribeBuyerAction(TOKEN)).rejects.toThrow("NEXT_REDIRECT");
    expect((await db.select().from(buyers))[0].status).toBe("unsubscribed");
    const after = renderToStaticMarkup(await BuyerUnsubscribePage({ params: Promise.resolve({ token: TOKEN }) } as never));
    expect(after).toContain("unsubscribed from Test Site");
  });

  it("an unknown token is a 404 page", async () => {
    await expect(BuyerUnsubscribePage({ params: Promise.resolve({ token: "x".repeat(30) }) } as never)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("buyer feedback", () => {
  it("rejects ratings outside 1 to 5", async () => {
    const { email } = await setup();
    const e = await email(2, "sent");
    for (const rating of [0, 6, 2.5, Number.NaN]) {
      expect(await submitFeedback(e.feedbackToken, { rating, comment: "" })).toEqual({ error: "Choose a rating from 1 to 5." });
    }
    expect(await db.select().from(buyerFeedback)).toHaveLength(0);
  });

  it("rejects a comment over 2000 characters", async () => {
    const { email } = await setup();
    const e = await email(2, "sent");
    expect(await submitFeedback(e.feedbackToken, { rating: 4, comment: "x".repeat(2001) })).toHaveProperty("error");
    expect(await submitFeedback(e.feedbackToken, { rating: 4, comment: "x".repeat(2000) })).toEqual({ ok: true });
  });

  it("stores the site from the email, and a second submission updates instead of duplicating", async () => {
    const { site, email } = await setup();
    const e = await email(2, "sent");
    expect(await submitFeedback(e.feedbackToken, { rating: 5, comment: "  Lovely  " })).toEqual({ ok: true });
    expect(await submitFeedback(e.feedbackToken, { rating: 3, comment: "Changed my mind" })).toEqual({ ok: true });
    const rows = await db.select().from(buyerFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 3, comment: "Changed my mind", siteId: site.id, buyerEmailId: e.id });
  });

  it("an unknown token is an error and a 404 page", async () => {
    await setup();
    expect(await submitFeedback("z".repeat(30), { rating: 5, comment: "" })).toHaveProperty("error");
    await expect(FeedbackPage({ params: Promise.resolve({ token: "z".repeat(30) }) } as never)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is rate-limited per token", async () => {
    const { email } = await setup();
    const e = await email(2, "sent");
    for (let i = 0; i < 10; i++) expect(await submitFeedback(e.feedbackToken, { rating: 4, comment: "" })).toEqual({ ok: true });
    expect(await submitFeedback(e.feedbackToken, { rating: 4, comment: "" })).toHaveProperty("error");
  });

  it("the page shows the order's products escaped, with labelled rating radios and the earlier answer", async () => {
    const { email } = await setup();
    const e = await email(2, "sent");
    await submitFeedback(e.feedbackToken, { rating: 4, comment: "<script>alert(1)</script>" });
    const html = renderToStaticMarkup(await FeedbackPage({ params: Promise.resolve({ token: e.feedbackToken }) } as never));
    expect(html).toContain("Olive &lt;b&gt;oil&lt;/b&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="4"/);
  });
});
