"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { approveBuyerDraft, discardBuyerDraft, updateBuyerDraft } from "@/lib/buyers/admin";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

export type BuyerActionState = { error?: string; saved?: boolean };

async function withState(siteId: string, fn: () => Promise<void>): Promise<BuyerActionState> {
  const user = await requireUser();
  try {
    await requireSiteAccess(user.id, siteId);
    await fn();
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/app/sites/${siteId}/buyers`);
  return { saved: true };
}

const fields = (formData: FormData) => ({
  subject: String(formData.get("subject") ?? ""),
  body: String(formData.get("body") ?? ""),
});

export async function saveBuyerDraftAction(
  siteId: string,
  id: string,
  _prev: BuyerActionState,
  formData: FormData,
): Promise<BuyerActionState> {
  return withState(siteId, () => updateBuyerDraft(siteId, id, fields(formData)));
}

/** Saves what's in the editor, then approves it: the admin's last edits are what gets sent. */
export async function approveBuyerDraftAction(
  siteId: string,
  id: string,
  _prev: BuyerActionState,
  formData: FormData,
): Promise<BuyerActionState> {
  return withState(siteId, async () => {
    await updateBuyerDraft(siteId, id, fields(formData));
    await approveBuyerDraft(siteId, id);
  });
}

export async function discardBuyerDraftAction(siteId: string, id: string): Promise<BuyerActionState> {
  return withState(siteId, () => discardBuyerDraft(siteId, id));
}
