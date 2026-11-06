"use server";

import { revalidatePath } from "next/cache";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { removeGreetingImage, setGreetingImage, updateSiteSettings } from "@/lib/site-settings";
import { requireUser } from "@/lib/session";
import { notFound } from "next/navigation";

export type SettingsState = { error?: string; saved?: boolean };

async function authorize(siteId: string) {
  const user = await requireUser();
  try {
    return await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

async function run(siteId: string, fn: () => Promise<void>): Promise<SettingsState> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/app/sites/${siteId}/settings`);
  return { saved: true };
}

export async function saveSettingsAction(
  siteId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await authorize(siteId);
  const languages = formData.getAll("greetingLanguage").map(String);
  const messages = formData.getAll("greetingMessage").map(String);
  const greetings = languages
    .map((language, i) => ({ language: language.trim().toLowerCase(), message: (messages[i] ?? "").trim() }))
    .filter((g) => g.message !== "");
  const allowedOrigins = String(formData.get("allowedOrigins") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return run(siteId, () =>
    updateSiteSettings(siteId, {
      botName: String(formData.get("botName") ?? ""),
      accentColor: String(formData.get("accentColor") ?? ""),
      corner: String(formData.get("corner") ?? ""),
      defaultLanguage: String(formData.get("defaultLanguage") ?? "").trim().toLowerCase(),
      guardrails: String(formData.get("guardrails") ?? ""),
      greetings,
      allowedOrigins,
    }),
  );
}

export async function uploadGreetingImageAction(
  siteId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await authorize(siteId);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload" };
  return run(siteId, () => setGreetingImage(siteId, file));
}

export async function removeGreetingImageAction(siteId: string): Promise<void> {
  await authorize(siteId);
  await removeGreetingImage(siteId);
  revalidatePath(`/app/sites/${siteId}/settings`);
}
