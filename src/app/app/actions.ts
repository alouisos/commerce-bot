"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getAccountForUser } from "@/lib/accounts";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createSite, deleteSite } from "@/lib/sites";

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

export type RemoveSiteState = { error?: string };

/** Deletes a website from the list, after the admin types its name. */
export async function removeSiteAction(
  siteId: string,
  _prev: RemoveSiteState,
  formData: FormData,
): Promise<RemoveSiteState> {
  const user = await requireUser();
  let site;
  try {
    site = await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (String(formData.get("confirmName") ?? "").trim() !== site.name) {
    return { error: "Type the website's name exactly to delete it." };
  }
  await deleteSite(site.id);
  revalidatePath("/app");
  return {};
}
