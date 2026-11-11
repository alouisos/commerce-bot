import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({ env: { CRAWL_ALLOW_PRIVATE_HOSTS: false } }));

import { listOrdersSince, productUrls, setWooTransportForTests, WooError } from "@/lib/sales/woocommerce";

const creds = { storeUrl: "https://shop.example.com", consumerKey: "ck_x", consumerSecret: "cs_x" };
let urls: URL[] = [];
let respond: (u: URL) => Response;

const order = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  order_key: `wc_${id}`,
  status: "processing",
  currency: "eur",
  total: "10.00",
  date_created_gmt: "2026-11-10T10:00:00",
  billing: { email: "a@b.com", first_name: " Maria " },
  line_items: [
    { product_id: 7, name: "Olive oil" },
    { product_id: 0, name: "Custom fee" },
    { name: "no id" },
  ],
  ...over,
});

beforeEach(() => {
  urls = [];
  setWooTransportForTests({
    fetch: (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      urls.push(u);
      return respond(u);
    }) as typeof fetch,
    lookup: async () => ["93.184.216.34"],
  });
});
afterEach(() => setWooTransportForTests(null));

describe("listOrdersSince", () => {
  it("parses first name and line items, asking for paid orders after the time", async () => {
    respond = () => new Response(JSON.stringify([order(1)]), { status: 200 });
    const out = await listOrdersSince(creds, new Date("2026-11-10T00:00:00Z"));
    expect(out).toHaveLength(1);
    expect(out[0].firstName).toBe("Maria");
    expect(out[0].items).toEqual([{ productId: 7, name: "Olive oil" }]);
    expect(urls[0].searchParams.get("after")).toBe("2026-11-10T00:00:00.000Z");
    expect(urls[0].searchParams.get("status")).toBe("processing,completed");
    expect(urls[0].searchParams.get("per_page")).toBe("50");
  });

  it("has a null first name when billing has none, and no items without line_items", async () => {
    respond = () => new Response(JSON.stringify([order(1, { billing: { email: "a@b.com" }, line_items: undefined })]), { status: 200 });
    const [o] = await listOrdersSince(creds, new Date());
    expect(o.firstName).toBeNull();
    expect(o.items).toEqual([]);
  });

  it("pages until a short page, at most 10 pages", async () => {
    respond = (u) => {
      const page = Number(u.searchParams.get("page"));
      const n = page < 3 ? 50 : 2;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => order(page * 100 + i))), { status: 200 });
    };
    expect(await listOrdersSince(creds, new Date())).toHaveLength(102);
    expect(urls).toHaveLength(3);
    urls = [];
    respond = () => new Response(JSON.stringify(Array.from({ length: 50 }, (_, i) => order(i))), { status: 200 });
    await listOrdersSince(creds, new Date());
    expect(urls).toHaveLength(10);
  });

  it("throws a WooError when the shop refuses or fails", async () => {
    respond = () => new Response("{}", { status: 403 });
    await expect(listOrdersSince(creds, new Date())).rejects.toMatchObject({ kind: "unauthorized" });
    respond = () => new Response("{}", { status: 500 });
    await expect(listOrdersSince(creds, new Date())).rejects.toBeInstanceOf(WooError);
  });
});

describe("productUrls", () => {
  it("maps product ids to their permalinks", async () => {
    respond = () =>
      new Response(JSON.stringify([{ id: 7, permalink: "https://shop.example.com/p/oil" }, { id: 8, permalink: "" }]), { status: 200 });
    const map = await productUrls(creds, [7, 8, 7]);
    expect(map.get(7)).toBe("https://shop.example.com/p/oil");
    expect(map.has(8)).toBe(false);
    expect(urls[0].searchParams.get("include")).toBe("7,8");
  });
});
