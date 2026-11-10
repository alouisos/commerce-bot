import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { effectiveEmailMode, updateEmailSettings } from "@/lib/site-settings";
import { resetDb } from "../helpers/db";
import { makeAccount, makeSite } from "../helpers/factories";

beforeEach(async () => {
  await resetDb();
});

const reload = async (id: string) => (await db.select().from(sites).where(eq(sites.id, id)))[0];

const valid = {
  emailMode: "approval",
  emailIntervalDays: 5,
  emailMaxPerPerson: 2,
  emailFromName: "Milian Jo",
  emailFromLocal: "hello.team",
  retentionMonths: 12,
  consentMode: "required",
};

describe("email and privacy settings", () => {
  it("a new site has the conservative defaults", async () => {
    const site = await makeSite((await makeAccount()).id);
    expect(site).toMatchObject({
      emailMode: "approval",
      emailIntervalDays: 4,
      emailMaxPerPerson: 3,
      emailFromLocal: "hello",
      emailFromName: null,
      sendingDomain: null,
      sendingDomainStatus: "none",
      retentionMonths: 24,
      consentMode: "auto",
    });
  });

  it("saves valid settings", async () => {
    const site = await makeSite((await makeAccount({ plan: "starter" })).id);
    await updateEmailSettings(site.id, valid);
    expect(await reload(site.id)).toMatchObject({ ...valid });
  });

  it("an empty from name is stored as null", async () => {
    const site = await makeSite((await makeAccount({ plan: "starter" })).id);
    await updateEmailSettings(site.id, { ...valid, emailFromName: "" });
    expect((await reload(site.id)).emailFromName).toBeNull();
  });

  it.each([
    ["interval 0", { emailIntervalDays: 0 }],
    ["interval 31", { emailIntervalDays: 31 }],
    ["max 0", { emailMaxPerPerson: 0 }],
    ["max 11", { emailMaxPerPerson: 11 }],
    ["a space in the from address", { emailFromLocal: "a b" }],
    ["retention 18", { retentionMonths: 18 }],
    ["an unknown consent mode", { consentMode: "maybe" }],
  ])("rejects %s", async (_name, patch) => {
    const site = await makeSite((await makeAccount({ plan: "starter" })).id);
    await expect(updateEmailSettings(site.id, { ...valid, ...patch })).rejects.toBeInstanceOf(ValidationError);
    expect((await reload(site.id)).emailIntervalDays).toBe(4);
  });

  it("automatic sending needs a plan that allows it", async () => {
    const starter = await makeSite((await makeAccount({ plan: "starter" })).id);
    await expect(updateEmailSettings(starter.id, { ...valid, emailMode: "automatic" })).rejects.toThrow(
      new ValidationError("Automatic sending needs the Growth plan or higher"),
    );
    expect((await reload(starter.id)).emailMode).toBe("approval");

    const growth = await makeSite((await makeAccount({ plan: "growth" })).id);
    await updateEmailSettings(growth.id, { ...valid, emailMode: "automatic" });
    expect((await reload(growth.id)).emailMode).toBe("automatic");
  });

  it("effectiveEmailMode falls back to approval after a downgrade", async () => {
    const starter = await makeAccount({ plan: "starter" });
    const growth = await makeAccount({ plan: "growth" });
    const s1 = await makeSite(starter.id, { emailMode: "automatic" });
    const s2 = await makeSite(growth.id, { emailMode: "automatic" });
    const s3 = await makeSite(growth.id);
    expect(effectiveEmailMode(s1, starter)).toBe("approval");
    expect(effectiveEmailMode(s2, growth)).toBe("automatic");
    expect(effectiveEmailMode(s3, growth)).toBe("approval");
  });
});
