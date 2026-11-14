import { z } from "zod";
import { LIMITS } from "@/shared/widget-protocol";

export const PAGE_KINDS = ["product", "cart", "checkout", "content", "listing", "home", "other"] as const;
export const INTENTS = ["learning", "exploring", "buying"] as const;

/** The page as the widget saw it (`PageContext`). */
export const pageSchema = z.object({
  url: z.string().max(LIMITS.urlMaxChars),
  title: z.string().max(LIMITS.titleMaxChars),
  lang: z.string().max(35).nullish().transform((v) => v ?? null),
  headings: z.array(z.string().max(LIMITS.headingMaxChars)).max(LIMITS.headingsMax),
  visibleText: z.string().max(LIMITS.visibleTextMaxChars),
  product: z
    .object({
      name: z.string().max(LIMITS.titleMaxChars),
      price: z.string().max(100).nullish().transform((v) => v ?? null),
      currency: z.string().max(10).nullish().transform((v) => v ?? null),
    })
    .nullish()
    .transform((v) => v ?? null),
  // Older widget bundles don't send it.
  kind: z.enum(PAGE_KINDS).default("other"),
});

/** What the visitor did this visit (`VisitSummary`). */
export const visitSchema = z.object({
  intent: z.enum(INTENTS).nullable(),
  confidence: z.number().min(0).max(1),
  pages: z
    .array(
      z.object({
        url: z.string().max(LIMITS.urlMaxChars),
        title: z.string().max(LIMITS.titleMaxChars),
        seconds: z.number().int().min(0).max(86400),
      }),
    )
    .max(LIMITS.visitPagesMax),
  addedToCart: z.boolean(),
  cartSeen: z.boolean(),
});

/** The owner's test key (`test` on widget requests). Optional; anything malformed is dropped, never an error. */
export const testKeySchema = z.string().max(100).nullish().catch(null).transform((v) => v ?? null);
