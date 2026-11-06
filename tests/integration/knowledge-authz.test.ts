import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { resetDb } from "../helpers/db";
import { makeAccount, makeMembership, makeSite, makeSource, makeUser } from "../helpers/factories";

const current = vi.hoisted(() => ({ user: { id: "", email: "a@example.com" } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => current.user }));

import { GET } from "@/app/app/sites/[siteId]/knowledge/image/[sourceId]/route";
import { deleteSourceAction, setExcludedAction } from "@/app/app/sites/[siteId]/knowledge/actions";

async function setup() {
  const userA = await makeUser();
  const accA = await makeAccount();
  await makeMembership(accA.id, userA.id);
  const siteA = await makeSite(accA.id);
  const siteA2 = await makeSite(accA.id);
  const accB = await makeAccount();
  const siteB = await makeSite(accB.id);
  current.user = { id: userA.id, email: userA.email };
  const key = `sites/${siteA.id}/kb/img/a.png`;
  await getStorage().put(key, new Uint8Array([1, 2, 3]), "image/png");
  const imgA = await makeSource(siteA.id, { kind: "image", storageKey: key, mimeType: "image/png" });
  const keyB = `sites/${siteA2.id}/kb/img/b.png`;
  await getStorage().put(keyB, new Uint8Array([9]), "image/png");
  const imgOther = await makeSource(siteA2.id, { kind: "image", storageKey: keyB, mimeType: "image/png" });
  const srcB = await makeSource(siteB.id);
  return { siteA, siteA2, siteB, imgA, imgOther, srcB };
}

const call = (siteId: string, sourceId: string) =>
  GET(new Request("http://x"), { params: Promise.resolve({ siteId, sourceId }) } as never);

async function digest(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
  return undefined;
}

describe("knowledge image route", () => {
  beforeEach(resetDb);
  it("serves own image, 404s for foreign site or cross-site source", async () => {
    const s = await setup();
    const ok = await call(s.siteA.id, s.imgA.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect((await call(s.siteB.id, s.srcB.id)).status).toBe(404);
    expect((await call(s.siteA.id, s.imgOther.id)).status).toBe(404);
  });
});

describe("knowledge actions", () => {
  beforeEach(resetDb);
  it("404 for a source of another site and leave it unchanged", async () => {
    const s = await setup();
    expect(await digest(deleteSourceAction(s.siteA.id, s.imgOther.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await digest(setExcludedAction(s.siteA.id, s.imgOther.id, true))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await digest(deleteSourceAction(s.siteB.id, s.srcB.id))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    const [row] = await db.select().from(kbSources).where(eq(kbSources.id, s.imgOther.id));
    expect(row.excluded).toBe(false);
    expect(await db.select().from(kbSources).where(eq(kbSources.id, s.srcB.id))).toHaveLength(1);
  });
});
