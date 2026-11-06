"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { isPlatformOwner } from "@/lib/access";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { requireUser } from "@/lib/session";

export async function setAccountPlan(accountId: string, plan: PlanId): Promise<void> {
  const user = await requireUser();
  if (!isPlatformOwner(user.email)) throw new NotFoundError();
  if (!Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)) throw new ValidationError("Unknown plan");
  const set = plan === "trial" ? { plan } : { plan, trialEndsAt: null };
  const updated = await db.update(accounts).set(set).where(eq(accounts.id, accountId)).returning({ id: accounts.id });
  if (updated.length === 0) throw new NotFoundError("Account not found");
  revalidatePath("/owner");
}
