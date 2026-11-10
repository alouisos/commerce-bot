// Limits the platform owner sets for one account, on top of its plan.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { LimitOverrides } from "@/lib/plans";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const USD = 1_000_000;

const whole = (label: string, max: number) =>
  z
    .number({ error: `${label}: enter a whole number` })
    .int(`${label}: enter a whole number`)
    .min(0, `${label} can't be negative`)
    .max(max, `${label} is at most ${max.toLocaleString("en")}`);

export const limitOverridesSchema = z
  .object({
    websites: whole("Websites", 100),
    conversationsPerMonth: whole("Conversations per month", 1_000_000),
    emailsPerMonth: whole("Emails per month", 1_000_000),
    storageBytes: whole("Storage", 50 * GB),
    aiCostCeilingMicros: whole("AI spend ceiling", 10_000 * USD),
    autoSendEmails: z.boolean(),
    removeBadge: z.boolean(),
  })
  .partial()
  .strict();

function num(fd: FormData, name: string, label: string): number | undefined {
  const raw = String(fd.get(name) ?? "").trim();
  if (raw === "") return undefined;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new ValidationError(`${label}: enter a whole number of 0 or more`);
  return Number(raw);
}

function toggle(fd: FormData, name: string): boolean | undefined {
  const v = String(fd.get(name) ?? "default");
  return v === "on" ? true : v === "off" ? false : undefined;
}

/** The Limits form: empty means "plan default"; storage in MB; the AI ceiling in USD per month. */
export function parseLimitsForm(fd: FormData): LimitOverrides {
  const storageMb = num(fd, "storageMb", "Storage");
  const ceilingUsd = num(fd, "aiCeilingUsd", "AI spend ceiling");
  const raw: Record<string, unknown> = {
    websites: num(fd, "websites", "Websites"),
    conversationsPerMonth: num(fd, "conversationsPerMonth", "Conversations per month"),
    emailsPerMonth: num(fd, "emailsPerMonth", "Emails per month"),
    storageBytes: storageMb === undefined ? undefined : Math.round(storageMb * MB),
    aiCostCeilingMicros: ceilingUsd === undefined ? undefined : Math.round(ceilingUsd * USD),
    autoSendEmails: toggle(fd, "autoSendEmails"),
    removeBadge: toggle(fd, "removeBadge"),
  };
  const set = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  const parsed = limitOverridesSchema.safeParse(set);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
}

export async function setAccountLimits(accountId: string, overrides: LimitOverrides): Promise<void> {
  const parsed = limitOverridesSchema.safeParse(overrides);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const updated = await db
    .update(accounts)
    .set({ limitOverrides: parsed.data })
    .where(eq(accounts.id, accountId))
    .returning({ id: accounts.id });
  if (updated.length === 0) throw new NotFoundError("Account not found");
}

/** Moves a trial's end date; only for accounts on the trial plan. */
export async function setTrialEnd(accountId: string, date: Date): Promise<void> {
  if (Number.isNaN(date.getTime())) throw new ValidationError("Enter a date");
  const [account] = await db.select({ plan: accounts.plan }).from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new NotFoundError("Account not found");
  if (account.plan !== "trial") throw new ValidationError("Only a trial has an end date");
  await db.update(accounts).set({ trialEndsAt: date }).where(eq(accounts.id, accountId));
}
