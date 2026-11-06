import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpFetcher } from "@/lib/crawl/fetcher";

let server: Server;
let base: string;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    const m = /^\/r(\d+)$/.exec(req.url ?? "");
    if (m) {
      const n = Number(m[1]);
      res.writeHead(302, { location: n > 0 ? `/r${n - 1}` : "/final" }).end();
    } else if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("a".repeat(3 * 1024 * 1024));
    } else {
      res.writeHead(200, { "content-type": "text/html" }).end("<p>ok</p>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe("createHttpFetcher", () => {
  it("refuses loopback hosts when the guard is on, without contacting them", async () => {
    hits = 0;
    const r = await createHttpFetcher({ allowPrivate: false })(`${base}/`);
    expect(r.status).toBe(0);
    expect(hits).toBe(0);
  });
  it("follows up to 5 redirects and reports the final URL; 6 hops fail", async () => {
    const f = createHttpFetcher({ allowPrivate: true });
    const ok = await f(`${base}/r2`);
    expect(ok).toMatchObject({ status: 200, finalUrl: `${base}/final`, body: "<p>ok</p>" });
    expect((await f(`${base}/r4`)).status).toBe(200);
    expect((await f(`${base}/r5`)).status).toBe(0);
  });
  it("truncates bodies at 2 MB", async () => {
    const r = await createHttpFetcher({ allowPrivate: true })(`${base}/big`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(2 * 1024 * 1024);
  });
  it("blocks a redirect hop to a private address", async () => {
    const other = createServer((_q, res) => res.writeHead(302, { location: "http://169.254.169.254/x" }).end());
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    const port = (other.address() as AddressInfo).port;
    const r = await createHttpFetcher({ allowPrivate: false })(`http://127.0.0.1:${port}/`);
    expect(r.status).toBe(0);
    other.close();
  });
});
