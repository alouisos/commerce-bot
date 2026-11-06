import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { monthlyUsage } from "@/db/schema";
import { monthKey } from "@/lib/usage/meter";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));

import { QuotaBanner } from "@/components/QuotaBanner";
import UsagePage from "@/app/app/usage/page";

const AI_LIMIT_TEXT =
  "Your bot has reached this month's AI usage limit: visitors can leave their email but get no AI replies until next month.";

beforeEach(resetDb);

async function accountAtAiCeiling() {
  const u = await makeUser();
  const account = await makeAccount({ plan: "starter" });
  await makeMembership(account.id, u.id);
  current.user = { id: u.id, email: u.email };
  await db.insert(monthlyUsage).values({ accountId: account.id, month: monthKey(new Date()), aiCostMicros: 25_000_000 });
  return account;
}

describe("AI usage limit messaging", () => {
  it("QuotaBanner alerts when this month's AI usage limit is reached", async () => {
    const account = await accountAtAiCeiling();
    const html = renderToStaticMarkup((await QuotaBanner({ account }))!);
    expect(html).toContain('role="alert"');
    expect(html).toContain(AI_LIMIT_TEXT.replace(/'/g, "&#x27;"));
  });

  it("QuotaBanner says nothing under the limit", async () => {
    const account = await makeAccount({ plan: "starter" });
    expect(await QuotaBanner({ account })).toBeNull();
  });

  it("the usage page shows AI usage against the limit and the alert when reached", async () => {
    await accountAtAiCeiling();
    const html = renderToStaticMarkup(await UsagePage());
    expect(html).toContain("AI usage this month: $25.00 of $25.00");
    expect(html).toMatch(new RegExp(`role="alert"[^>]*>${AI_LIMIT_TEXT.replace(/'/g, "&#x27;").replace(/[.$]/g, "\\$&")}`));
  });
});
