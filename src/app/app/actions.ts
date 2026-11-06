"use server";

import { redirect } from "next/navigation";
import { getAccountForUser } from "@/lib/accounts";
import { PlanLimitError, ValidationError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createSite } from "@/lib/sites";

export type AddSiteState = { error?: string };

export async function addSiteAction(_prev: AddSiteState, formData: FormData): Promise<AddSiteState> {
  const user = await requireUser();
  const account = await getAccountForUser(user.id);
  let siteId: string;
  try {
    const site = await createSite(account.id, {
      name: String(formData.get("name") ?? ""),
      baseUrl: String(formData.get("baseUrl") ?? ""),
    });
    siteId = site.id;
  } catch (err) {
    if (err instanceof PlanLimitError || err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  redirect(`/app/sites/${siteId}/settings`);
}
