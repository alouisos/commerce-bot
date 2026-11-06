import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { siteGreetings, sites } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { sniffImageType } from "@/lib/files";
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
      })
      .where(eq(sites.id, siteId));
    await tx.delete(siteGreetings).where(eq(siteGreetings.siteId, siteId));
    if (s.greetings.length > 0) {
      await tx.insert(siteGreetings).values(s.greetings.map((g) => ({ siteId, ...g })));
    }
  });
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
