"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { approveDraft, deletePerson, discardDraft, updateDraft } from "@/lib/email/admin";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

export type EmailActionState = { error?: string; saved?: boolean };

async function guarded<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
  const user = await requireUser();
  try {
    await requireSiteAccess(user.id, siteId);
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

function refresh(siteId: string) {
  revalidatePath(`/app/sites/${siteId}/emails`);
  revalidatePath(`/app/sites/${siteId}/leads`);
}

async function withState(siteId: string, fn: () => Promise<void>): Promise<EmailActionState> {
  try {
    await guarded(siteId, fn);
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  refresh(siteId);
  return { saved: true };
}

export async function saveDraftAction(
  siteId: string,
  id: string,
  _prev: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  return withState(siteId, () =>
    updateDraft(siteId, id, {
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    }),
  );
}

export async function approveDraftAction(siteId: string, id: string): Promise<EmailActionState> {
  return withState(siteId, () => approveDraft(siteId, id));
}

export async function discardDraftAction(siteId: string, id: string): Promise<EmailActionState> {
  return withState(siteId, () => discardDraft(siteId, id));
}

export async function deletePersonAction(
  siteId: string,
  _prev: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
  return guarded(siteId, async () => {
    if (!email || confirm !== email) return { error: `To confirm, type the email exactly: ${email}` };
    await deletePerson(siteId, email);
    refresh(siteId);
    return { saved: true };
  });
}
