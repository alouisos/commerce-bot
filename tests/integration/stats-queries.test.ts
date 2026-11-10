import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { makeAccount, makeConversation, makeLead, makeMessage, makeSite } from "../helpers/factories";
import { parseRange } from "@/lib/stats/range";
import { getDailyConversations, getTopStartPages, getTotals, getTotalsBySite } from "@/lib/stats/queries";

beforeEach(resetDb);

const now = new Date("2026-11-10T15:00:00Z");
const range = parseRange("7d", now);
const zero = { conversations: 0, visitorMessages: 0, emailsCaptured: 0, unanswered: 0 };

async function seed() {
  const account = await makeAccount();
  const other = await makeAccount();
  const a = await makeSite(account.id);
  const b = await makeSite(account.id);
  const x = await makeSite(other.id);

  const late = await makeConversation(a.id, {
    createdAt: new Date("2026-11-09T23:59:59Z"),
    firstPageUrl: "https://example.com/shampoo",
  });
  await makeMessage(late.id, { content: "hi", createdAt: new Date("2026-11-09T23:59:59Z") });
  await makeMessage(late.id, { role: "bot", kind: "fallback", content: "sorry" });
  await makeMessage(late.id, { role: "bot", kind: "fallback", content: "sorry again" });
  await makeLead(a.id, { conversationId: late.id, createdAt: new Date("2026-11-10T00:00:10Z") });

  const early = await makeConversation(a.id, {
    createdAt: new Date("2026-11-10T00:00:00Z"),
    firstPageUrl: "https://example.com/shampoo",
  });
  await makeMessage(early.id, { content: "one" });
  await makeMessage(early.id, { content: "two" });

  const onB = await makeConversation(b.id, {
    createdAt: new Date("2026-11-05T10:00:00Z"),
    firstPageUrl: "https://example.com/",
  });
  await makeMessage(onB.id, { content: "hello" });

  // Out of range: before the window.
  const old = await makeConversation(a.id, { createdAt: new Date("2026-10-01T10:00:00Z") });
  await makeMessage(old.id, { content: "old", createdAt: new Date("2026-10-01T10:00:00Z") });
  await makeLead(a.id, { createdAt: new Date("2026-10-01T10:00:00Z") });

  // Another account: never counted.
  const foreign = await makeConversation(x.id, { createdAt: new Date("2026-11-10T01:00:00Z") });
  await makeMessage(foreign.id, { content: "foreign" });
  await makeLead(x.id, { createdAt: new Date("2026-11-10T01:00:00Z") });

  return { a, b, x };
}

describe("stats queries", () => {
  it("totals count only the given sites and the range", async () => {
    const { a, b } = await seed();
    expect(await getTotals([a.id, b.id], range)).toEqual({
      conversations: 3,
      visitorMessages: 4,
      emailsCaptured: 1,
      unanswered: 1,
    });
    expect(await getTotals([b.id], range)).toEqual({ ...zero, conversations: 1, visitorMessages: 1 });
  });

  it("no sites means zeros", async () => {
    await seed();
    expect(await getTotals([], range)).toEqual(zero);
    expect(await getTotalsBySite([], range)).toEqual(new Map());
  });

  it("buckets by UTC day, zero-filled, one entry per day", async () => {
    const { a, b } = await seed();
    const daily = await getDailyConversations([a.id, b.id], range);
    expect(daily).toHaveLength(7);
    expect(daily).toEqual([
      { day: "2026-11-04", conversations: 0 },
      { day: "2026-11-05", conversations: 1 },
      { day: "2026-11-06", conversations: 0 },
      { day: "2026-11-07", conversations: 0 },
      { day: "2026-11-08", conversations: 0 },
      { day: "2026-11-09", conversations: 1 },
      { day: "2026-11-10", conversations: 1 },
    ]);
  });

  it("top start pages group by first page, skipping none", async () => {
    const { a, b } = await seed();
    await makeConversation(a.id, { createdAt: new Date("2026-11-08T10:00:00Z"), firstPageUrl: null });
    expect(await getTopStartPages([a.id, b.id], range)).toEqual([
      { url: "https://example.com/shampoo", conversations: 2 },
      { url: "https://example.com/", conversations: 1 },
    ]);
  });

  it("totals by site include every given site", async () => {
    const { a, b, x } = await seed();
    const out = await getTotalsBySite([a.id, b.id], range);
    expect(out.get(a.id)).toEqual({ conversations: 2, visitorMessages: 3, emailsCaptured: 1, unanswered: 1 });
    expect(out.get(b.id)).toEqual({ ...zero, conversations: 1, visitorMessages: 1 });
    expect(out.has(x.id)).toBe(false);
  });
});
