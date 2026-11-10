import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db/client";
import { storeConnections } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { connectWooCommerce, disconnectStore, getStoreConnectionSummary, getStoreCredentials } from "@/lib/sales/connections";
import { setWooTransportForTests } from "@/lib/sales/woocommerce";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { connectStoreAction } from "@/app/app/sites/[siteId]/settings/actions";
import SettingsPage from "@/app/app/sites/[siteId]/settings/page";

const CK = "ck_" + "a".repeat(40);
const CS = "cs_" + "b1".repeat(20);

type Call = { url: string; headers: Record<string, string>; redirect?: string };
let calls: Call[] = [];
let reply: (url: URL, attempt: number) => Response = () => new Response("[]", { status: 200 });
let addresses = ["93.184.216.34"];

beforeEach(async () => {
  await resetDb();
  calls = [];
  addresses = ["93.184.216.34"];
  reply = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  setWooTransportForTests({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), redirect: init?.redirect });
      return reply(new URL(url), calls.length);
    }) as typeof fetch,
    lookup: async () => addresses,
  });
});
afterEach(() => setWooTransportForTests(null));

async function shop() {
  const account = await makeAccount({ plan: "starter" });
  const site = await makeSite(account.id, {
    baseUrl: "https://milianjo.com",
    allowedOrigins: ["https://milianjo.com", "https://www.milianjo.com"],
  });
  return { account, site };
}
const input = (over: Record<string, string> = {}) => ({ storeUrl: "https://milianjo.com", consumerKey: CK, consumerSecret: CS, ...over });

describe("connecting WooCommerce", () => {
  it("tests the key, then stores it with the secret encrypted", async () => {
    const { site } = await shop();
    await connectWooCommerce(site.id, input());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://milianjo.com/wp-json/wc/v3/orders?per_page=1");
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from(`${CK}:${CS}`).toString("base64")}`);
    expect(calls[0].redirect).toBe("manual");
    const [row] = await db.select().from(storeConnections).where(eq(storeConnections.siteId, site.id));
    expect(row).toMatchObject({ platform: "woocommerce", storeUrl: "https://milianjo.com", consumerKey: CK, status: "connected" });
    expect(row.consumerSecretEnc).not.toContain(CS);
    expect(await getStoreCredentials(site.id)).toEqual({ storeUrl: "https://milianjo.com", consumerKey: CK, consumerSecret: CS });
    const summary = await getStoreConnectionSummary(site.id);
    expect(summary).toEqual({ storeUrl: "https://milianjo.com", keyLast4: CK.slice(-4), status: "connected", lastError: null });
    expect(JSON.stringify(summary)).not.toContain(CS);
  });

  it("falls back to query parameters when the host strips the Authorization header", async () => {
    const { site } = await shop();
    reply = (url) => (url.searchParams.get("consumer_key") ? new Response("[]", { status: 200 }) : new Response("{}", { status: 401 }));
    await connectWooCommerce(site.id, input());
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("consumer_secret")).toBe(CS);
    expect(calls[1].headers.authorization).toBeUndefined();
  });

  it("a refused key stores nothing", async () => {
    const { site } = await shop();
    reply = () => new Response("{}", { status: 401 });
    await expect(connectWooCommerce(site.id, input())).rejects.toThrow(
      new ValidationError("WooCommerce refused the key. Check it has Read access."),
    );
    expect(await db.select().from(storeConnections)).toHaveLength(0);
  });

  it("names the redirect target and never follows it with the key", async () => {
    const { site } = await shop();
    reply = () => new Response(null, { status: 301, headers: { location: "https://www.milianjo.com/wp-json/wc/v3/orders?per_page=1" } });
    await expect(connectWooCommerce(site.id, input())).rejects.toThrow(
      new ValidationError("Your shop redirects to https://www.milianjo.com. Use that address."),
    );
    expect(calls).toHaveLength(1);
  });

  it("no REST API at the address", async () => {
    const { site } = await shop();
    reply = () => new Response("not found", { status: 404 });
    await expect(connectWooCommerce(site.id, input())).rejects.toThrow("There's no WooCommerce REST API at this address.");
  });

  it.each(["https://evil.com", "http://milianjo.com", "https://milianjo.com/shop", "not a url"])(
    "refuses the store address %s without sending the key",
    async (storeUrl) => {
      const { site } = await shop();
      await expect(connectWooCommerce(site.id, input({ storeUrl }))).rejects.toBeInstanceOf(ValidationError);
      expect(calls).toHaveLength(0);
    },
  );

  it("an allowed origin's host is fine", async () => {
    const { site } = await shop();
    await connectWooCommerce(site.id, input({ storeUrl: "https://www.milianjo.com/" }));
    expect((await getStoreCredentials(site.id))?.storeUrl).toBe("https://www.milianjo.com");
  });

  it("refuses malformed keys", async () => {
    const { site } = await shop();
    await expect(connectWooCommerce(site.id, input({ consumerKey: "abc" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(connectWooCommerce(site.id, input({ consumerSecret: "cs_short" }))).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it("a host on a private address is never contacted", async () => {
    const { site } = await shop();
    addresses = ["10.0.0.5"];
    await expect(connectWooCommerce(site.id, input())).rejects.toThrow("Couldn't reach your shop. Try again in a minute.");
    expect(calls).toHaveLength(0);
  });

  it("remove clears the connection", async () => {
    const { site } = await shop();
    await connectWooCommerce(site.id, input());
    await disconnectStore(site.id);
    expect(await getStoreConnectionSummary(site.id)).toBeNull();
  });
});

describe("sales tracking settings", () => {
  async function member() {
    const s = await shop();
    const u = await makeUser();
    await makeMembership(s.account.id, u.id);
    current.user = { id: u.id, email: u.email };
    return s;
  }
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const render = async (siteId: string) =>
    renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ siteId }) } as never));

  it("connects through the action and shows the summary, never the secret", async () => {
    const { site } = await member();
    expect(await render(site.id)).toContain("Connect WooCommerce");
    expect(await connectStoreAction(site.id, {}, form(input()))).toEqual({ saved: true });
    const html = await render(site.id);
    expect(html).toContain(`Connected to https://milianjo.com · key ending ${CK.slice(-4)}`);
    expect(html).not.toContain(CS);
  });

  it("reports a refused key as a message", async () => {
    const { site } = await member();
    reply = () => new Response("{}", { status: 403 });
    expect(await connectStoreAction(site.id, {}, form(input()))).toEqual({
      error: "WooCommerce refused the key. Check it has Read access.",
    });
  });

  it("another account's site is a 404", async () => {
    await member();
    const foreign = await makeSite((await makeAccount()).id);
    let digest: string | undefined;
    try {
      await connectStoreAction(foreign.id, {}, form(input()));
    } catch (e) {
      digest = (e as { digest?: string }).digest;
    }
    expect(digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(calls).toHaveLength(0);
  });
});
