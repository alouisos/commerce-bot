import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeUser } from "../helpers/factories";
import { NotFoundError, ValidationError } from "@/lib/errors";

const session = vi.hoisted(() => ({ email: "nobody@example.com" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u", email: session.email }),
}));
vi.mock("@/lib/access", async (orig) => {
  const mod = await orig<typeof import("@/lib/access")>();
  return { ...mod, isPlatformOwner: (email: string) => mod.isPlatformOwner(email, ["boss@example.com"]) };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setAccountPlan } from "@/app/owner/actions";
import OwnerPage from "@/app/owner/page";
import { renderToStaticMarkup } from "react-dom/server";

beforeEach(async () => {
  await resetDb();
});

describe("setAccountPlan", () => {
  it("throws NotFoundError for non-owners and changes nothing", async () => {
    const account = await makeAccount({ plan: "trial", trialEndsAt: new Date("2030-01-01") });
    await makeMembership(account.id, (await makeUser()).id);
    session.email = "nobody@example.com";
    await expect(setAccountPlan(account.id, "complimentary")).rejects.toBeInstanceOf(NotFoundError);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(row.plan).toBe("trial");
  });

  it("owner sets complimentary and clears trialEndsAt", async () => {
    const account = await makeAccount({ plan: "trial", trialEndsAt: new Date("2030-01-01") });
    session.email = "Boss@example.com";
    await setAccountPlan(account.id, "complimentary");
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(row.plan).toBe("complimentary");
    expect(row.trialEndsAt).toBeNull();
  });

  it("rejects an unknown plan", async () => {
    const account = await makeAccount();
    session.email = "boss@example.com";
    await expect(setAccountPlan(account.id, "gold" as never)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("/owner page", () => {
  it("renders Next's not-found for a non-owner, on its own (without the layout)", async () => {
    const account = await makeAccount();
    session.email = "nobody@example.com";
    let digest: string | undefined;
    try {
      await OwnerPage();
    } catch (e) {
      digest = (e as { digest?: string }).digest;
    }
    expect(digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(account.id).toBeTruthy();
  });

  it("lists accounts for the platform owner", async () => {
    await makeAccount();
    session.email = "boss@example.com";
    const html = renderToStaticMarkup(await OwnerPage());
    expect(html).toContain("Test Account");
  });
});
