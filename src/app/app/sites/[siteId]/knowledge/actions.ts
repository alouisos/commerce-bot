"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import { recrawlNow } from "@/lib/crawl/recrawl";
import { addDocument, addImage, addText, deleteSource, setExcluded } from "@/lib/kb/sources";
import { requireUser } from "@/lib/session";

export type KnowledgeState = { error?: string; saved?: boolean };

async function authorize(siteId: string) {
  const user = await requireUser();
  try {
    return await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

async function run(siteId: string, fn: () => Promise<unknown>): Promise<KnowledgeState> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ValidationError || err instanceof PlanLimitError) return { error: err.message };
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  revalidatePath(`/app/sites/${siteId}/knowledge`);
  return { saved: true };
}

export async function addDocumentAction(siteId: string, _prev: KnowledgeState, formData: FormData): Promise<KnowledgeState> {
  await authorize(siteId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload" };
  return run(siteId, () => addDocument(siteId, file));
}

export async function addImageAction(siteId: string, _prev: KnowledgeState, formData: FormData): Promise<KnowledgeState> {
  await authorize(siteId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload" };
  const caption = String(formData.get("caption") ?? "");
  return run(siteId, () => addImage(siteId, file, caption));
}

export async function addTextAction(siteId: string, _prev: KnowledgeState, formData: FormData): Promise<KnowledgeState> {
  await authorize(siteId);
  return run(siteId, () =>
    addText(siteId, { title: String(formData.get("title") ?? ""), text: String(formData.get("text") ?? "") }),
  );
}

export async function deleteSourceAction(siteId: string, sourceId: string): Promise<void> {
  await authorize(siteId);
  await run(siteId, () => deleteSource(siteId, sourceId));
}

export async function setExcludedAction(siteId: string, sourceId: string, excluded: boolean): Promise<void> {
  await authorize(siteId);
  await run(siteId, () => setExcluded(siteId, sourceId, excluded));
}

export async function recrawlNowAction(siteId: string): Promise<void> {
  await authorize(siteId);
  await run(siteId, () => recrawlNow(siteId));
}
