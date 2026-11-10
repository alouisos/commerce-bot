"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { isPlatformOwner } from "@/lib/access";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { cancelInvite, createInvite, INVITE_PLANS, resendInvite, type InvitePlan } from "@/lib/invites";
import { parseLimitsForm, setAccountLimits, setTrialEnd } from "@/lib/limits";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { requireUser } from "@/lib/session";

export async function setAccountPlan(accountId: string, plan: PlanId): Promise<void> {
  const user = await requireUser();
  if (!isPlatformOwner(user)) throw new NotFoundError();
  if (!Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)) throw new ValidationError("Unknown plan");
  const set = plan === "trial" ? { plan } : { plan, trialEndsAt: null };
  const updated = await db.update(accounts).set(set).where(eq(accounts.id, accountId)).returning({ id: accounts.id });
  if (updated.length === 0) throw new NotFoundError("Account not found");
  revalidatePath("/owner");
}

export type OwnerFormState = { error?: string; saved?: boolean };

async function requireOwner() {
  const user = await requireUser();
  if (!isPlatformOwner(user)) notFound();
}

/** The Limits form on an account's owner page: overrides over the plan, and a trial's end date. */
export async function saveLimitsAction(accountId: string, _prev: OwnerFormState, formData: FormData): Promise<OwnerFormState> {
  await requireOwner();
  try {
    await setAccountLimits(accountId, parseLimitsForm(formData));
    const trialEnd = String(formData.get("trialEndsOn") ?? "").trim();
    if (trialEnd) await setTrialEnd(accountId, new Date(`${trialEnd}T23:59:59Z`));
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  revalidatePath(`/owner/accounts/${accountId}`);
  return { saved: true };
}

export async function inviteAction(_prev: OwnerFormState, formData: FormData): Promise<OwnerFormState> {
  await requireOwner();
  const plan = String(formData.get("plan") ?? "");
  if (!(INVITE_PLANS as readonly string[]).includes(plan)) return { error: "Choose a plan" };
  try {
    await createInvite({
      email: String(formData.get("email") ?? ""),
      accountName: String(formData.get("accountName") ?? ""),
      plan: plan as InvitePlan,
    });
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  revalidatePath("/owner");
  return { saved: true };
}

export async function resendInviteAction(inviteId: string): Promise<void> {
  await requireOwner();
  try {
    await resendInvite(inviteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  revalidatePath("/owner");
}

export async function cancelInviteAction(inviteId: string): Promise<void> {
  await requireOwner();
  try {
    await cancelInvite(inviteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  revalidatePath("/owner");
}
