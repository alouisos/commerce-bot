"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { addSendingDomain, refreshSendingDomain, removeSendingDomain } from "@/lib/email/domain";
import { EmailNotConfiguredError } from "@/lib/email/provider";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { connectWooCommerce, disconnectStore } from "@/lib/sales/connections";
import { removeGreetingImage, setGreetingImage, updateEmailSettings, updateSiteSettings } from "@/lib/site-settings";
import { deleteSite, updateSiteDetails } from "@/lib/sites";
import { requireUser } from "@/lib/session";

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
    if (err instanceof ValidationError || err instanceof EmailNotConfiguredError) return { error: err.message };
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
      proactivity: String(formData.get("proactivity") ?? ""),
    }),
  );
}

export async function saveEmailSettingsAction(
  siteId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await authorize(siteId);
  return run(siteId, () =>
    updateEmailSettings(siteId, {
      emailMode: String(formData.get("emailMode") ?? "approval"),
      emailIntervalDays: String(formData.get("emailIntervalDays") ?? ""),
      emailMaxPerPerson: String(formData.get("emailMaxPerPerson") ?? ""),
      emailFromName: String(formData.get("emailFromName") ?? ""),
      emailFromLocal: String(formData.get("emailFromLocal") ?? ""),
      retentionMonths: String(formData.get("retentionMonths") ?? ""),
      consentMode: String(formData.get("consentMode") ?? ""),
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

export async function saveSiteDetailsAction(
  siteId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await authorize(siteId);
  const state = await run(siteId, () =>
    updateSiteDetails(siteId, {
      name: String(formData.get("name") ?? ""),
      baseUrl: String(formData.get("baseUrl") ?? ""),
    }),
  );
  // The site's name and URL are shown in its layout header and on the websites list.
  if (state.saved) {
    revalidatePath("/app/sites/[siteId]", "layout");
    revalidatePath("/app");
  }
  return state;
}

export async function deleteSiteAction(siteId: string, _prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const site = await authorize(siteId);
  if (String(formData.get("confirmName") ?? "").trim() !== site.name) {
    return { error: `To confirm, type the website's name exactly: ${site.name}` };
  }
  await deleteSite(site.id);
  revalidatePath("/app");
  redirect("/app");
}

export async function addSendingDomainAction(
  siteId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await authorize(siteId);
  return run(siteId, async () => {
    await addSendingDomain(siteId, String(formData.get("domain") ?? ""));
  });
}

export async function refreshSendingDomainAction(siteId: string): Promise<SettingsState> {
  await authorize(siteId);
  return run(siteId, async () => {
    await refreshSendingDomain(siteId);
  });
}

export async function removeSendingDomainAction(siteId: string): Promise<void> {
  await authorize(siteId);
  await removeSendingDomain(siteId);
  revalidatePath(`/app/sites/${siteId}/settings`);
}

export async function connectStoreAction(
  siteId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await authorize(siteId);
  return run(siteId, () =>
    connectWooCommerce(siteId, {
      storeUrl: String(formData.get("storeUrl") ?? ""),
      consumerKey: String(formData.get("consumerKey") ?? ""),
      consumerSecret: String(formData.get("consumerSecret") ?? ""),
    }),
  );
}

export async function disconnectStoreAction(siteId: string): Promise<void> {
  await authorize(siteId);
  await disconnectStore(siteId);
  revalidatePath(`/app/sites/${siteId}/settings`);
}
