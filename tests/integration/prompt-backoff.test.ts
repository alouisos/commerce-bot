import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { makeAccount, makeImpression, makeSite } from "../helpers/factories";
import { pausedKinds, promptStats } from "@/lib/prompts/backoff";
import { parseRange } from "@/lib/stats/range";

beforeEach(resetDb);

const now = new Date("2026-11-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

async function shown(siteId: string, n: number, dismissed: number, opts: { kind?: "question" | "pairing"; at?: Date } = {}) {
  for (let i = 0; i < n; i++) {
    await makeImpression(siteId, {
      kind: opts.kind ?? "question",
      shownAt: opts.at ?? hoursAgo(2),
      outcome: i < dismissed ? "dismissed" : null,
      outcomeAt: i < dismissed ? hoursAgo(1) : null,
    });
  }
}

async function site() {
  return makeSite((await makeAccount()).id);
}

describe("pausedKinds", () => {
  it("needs at least 20 shown", async () => {
    const s = await site();
    await shown(s.id, 19, 19);
    expect(await pausedKinds(s.id, now)).toEqual([]);
  });

  it("pauses a type when half or more of 20+ shown were dismissed", async () => {
    const s = await site();
    await shown(s.id, 20, 10);
    expect(await pausedKinds(s.id, now)).toEqual(["question"]);
  });

  it("does not pause under half", async () => {
    const s = await site();
    await shown(s.id, 20, 9);
    expect(await pausedKinds(s.id, now)).toEqual([]);
  });

  it("ignores impressions older than 14 days and ones never shown", async () => {
    const s = await site();
    await shown(s.id, 25, 25, { at: hoursAgo(15 * 24) });
    for (let i = 0; i < 30; i++) await makeImpression(s.id, { shownAt: null, outcome: "dismissed" });
    expect(await pausedKinds(s.id, now)).toEqual([]);
  });

  it("counts only this site", async () => {
    const s = await site();
    const other = await site();
    await shown(other.id, 20, 20, { kind: "pairing" });
    expect(await pausedKinds(s.id, now)).toEqual([]);
    expect(await pausedKinds(other.id, now)).toEqual(["pairing"]);
  });
});

describe("promptStats", () => {
  it("counts shown, tapped and dismissed per type in range", async () => {
    const s = await site();
    await makeImpression(s.id, { shownAt: hoursAgo(2), outcome: "tapped" });
    await makeImpression(s.id, { shownAt: hoursAgo(2), outcome: "dismissed" });
    await makeImpression(s.id, { shownAt: hoursAgo(2) });
    await makeImpression(s.id, { kind: "pairing", shownAt: hoursAgo(3), outcome: "tapped" });
    await makeImpression(s.id, { shownAt: null });
    await makeImpression(s.id, { shownAt: hoursAgo(40 * 24), outcome: "dismissed" });
    expect(await promptStats(s.id, parseRange("30d", now))).toEqual({
      question: { shown: 3, tapped: 1, dismissed: 1 },
      pairing: { shown: 1, tapped: 1, dismissed: 0 },
    });
  });
});
