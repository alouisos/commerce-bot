import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { accounts, siteGreetings, sites, type Account, type Site } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { sniffImageType } from "@/lib/files";
import { planStatus } from "@/lib/plans";
import { clearPromptCache } from "@/lib/prompts/cache";
import { getStorage, greetingImageKey } from "@/lib/storage";

const lang = z.string().regex(/^[a-z]{2}$/, "Use a two-letter language code such as en");

const origin = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && u.origin === v;
    } catch {
      return false;
    }
  }, "Enter an origin like https://example.com (no path)");

export const siteSettingsSchema = z.object({
  botName: z.string().trim().min(1, "Bot name is required").max(40, "Bot name is at most 40 characters"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1f2937"),
  corner: z.enum(["bottom-right", "bottom-left"]),
  defaultLanguage: lang,
  guardrails: z.string().max(2000, "Guardrails are at most 2,000 characters"),
  greetings: z
    .array(z.object({ language: lang, message: z.string().trim().min(1, "Greeting is required").max(280, "Greeting is at most 280 characters") }))
    .max(10)
    .refine((g) => new Set(g.map((x) => x.language)).size === g.length, "Each language can only appear once"),
  allowedOrigins: z.array(origin).max(10, "At most 10 allowed origins"),
  proactivity: z.enum(["off", "gentle", "active"], { error: "Choose how proactive the bot should be" }),
});

export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;

export async function updateSiteSettings(siteId: string, input: unknown): Promise<void> {
  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const s = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .update(sites)
      .set({
        botName: s.botName,
        accentColor: s.accentColor,
        corner: s.corner,
        defaultLanguage: s.defaultLanguage,
        guardrails: s.guardrails,
        allowedOrigins: [...new Set(s.allowedOrigins)],
        proactivity: s.proactivity,
      })
      .where(eq(sites.id, siteId));
    await tx.delete(siteGreetings).where(eq(siteGreetings.siteId, siteId));
    if (s.greetings.length > 0) {
      await tx.insert(siteGreetings).values(s.greetings.map((g) => ({ siteId, ...g })));
    }
  });
  // Guardrails may have changed; suggestions written under the old rules are dropped.
  await clearPromptCache(siteId);
}

export const RETENTION_MONTHS = [6, 12, 24, 36] as const;

export const emailSettingsSchema = z.object({
  emailMode: z.enum(["approval", "automatic"], { error: "Choose how emails are sent" }),
  emailIntervalDays: z.coerce
    .number({ error: "Enter the days between emails" })
    .int("Enter whole days")
    .min(1, "Send at most one email a day")
    .max(30, "Wait at most 30 days between emails"),
  emailMaxPerPerson: z.coerce
    .number({ error: "Enter how many emails per person" })
    .int("Enter a whole number")
    .min(1, "Send at least 1 email per person")
    .max(10, "Send at most 10 emails per person"),
  emailFromName: z.string().trim().max(60, "The from name is at most 60 characters"),
  emailFromLocal: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "Use only letters, numbers, dots, dashes or underscores before the @"),
  retentionMonths: z.coerce
    .number()
    .refine((n) => (RETENTION_MONTHS as readonly number[]).includes(n), "Choose 6, 12, 24 or 36 months"),
  consentMode: z.enum(["auto", "required", "off"], { error: "Choose a cookie-consent mode" }),
});

export async function updateEmailSettings(siteId: string, input: unknown): Promise<void> {
  const parsed = emailSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const s = parsed.data;
  if (s.emailMode === "automatic") {
    const [row] = await db
      .select({ plan: accounts.plan, trialEndsAt: accounts.trialEndsAt, limitOverrides: accounts.limitOverrides })
      .from(sites)
      .innerJoin(accounts, eq(accounts.id, sites.accountId))
      .where(eq(sites.id, siteId));
    if (!row || !planStatus(row, new Date()).limits.autoSendEmails) {
      throw new ValidationError("Automatic sending needs the Growth plan or higher");
    }
  }
  await db
    .update(sites)
    .set({
      emailMode: s.emailMode,
      emailIntervalDays: s.emailIntervalDays,
      emailMaxPerPerson: s.emailMaxPerPerson,
      emailFromName: s.emailFromName === "" ? null : s.emailFromName,
      emailFromLocal: s.emailFromLocal.toLowerCase(),
      retentionMonths: s.retentionMonths,
      consentMode: s.consentMode,
    })
    .where(eq(sites.id, siteId));
}

/** "automatic" only while the plan allows it; a downgraded site goes back to the approval queue. */
export function effectiveEmailMode(
  site: Pick<Site, "emailMode">,
  account: Pick<Account, "plan" | "trialEndsAt" | "limitOverrides">,
  now: Date = new Date(),
): "approval" | "automatic" {
  return site.emailMode === "automatic" && planStatus(account, now).limits.autoSendEmails ? "automatic" : "approval";
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export async function setGreetingImage(siteId: string, file: File): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) throw new ValidationError("The image must be 2 MB or smaller");
  const body = new Uint8Array(await file.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw new ValidationError("The image must be 2 MB or smaller");
  const sniffed = sniffImageType(body);
  if (sniffed !== "image/png" && sniffed !== "image/jpeg" && sniffed !== "image/webp") {
    throw new ValidationError("The image must be a PNG, JPEG or WEBP file");
  }
  if (file.type !== sniffed) throw new ValidationError("The file content does not match its type");

  const storage = getStorage();
  const key = greetingImageKey(siteId, IMAGE_EXT[sniffed]);
  await storage.put(key, body, sniffed);
  const [prev] = await db.select({ key: sites.greetingImageKey }).from(sites).where(eq(sites.id, siteId));
  await db.update(sites).set({ greetingImageKey: key }).where(eq(sites.id, siteId));
  if (prev?.key) await storage.delete(prev.key);
}

export async function removeGreetingImage(siteId: string): Promise<void> {
  const [prev] = await db.select({ key: sites.greetingImageKey }).from(sites).where(eq(sites.id, siteId));
  await db.update(sites).set({ greetingImageKey: null }).where(eq(sites.id, siteId));
  if (prev?.key) await getStorage().delete(prev.key);
}
