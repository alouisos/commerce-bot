"use server";

import { headers } from "next/headers";
import { requestAccess } from "@/lib/access-requests";

export type RequestAccessState = { error?: string; sentTo?: string };

export async function requestAccessAction(_prev: RequestAccessState, formData: FormData): Promise<RequestAccessState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const res = await requestAccess({
    email: String(formData.get("email") ?? ""),
    website: String(formData.get("website") ?? ""),
    ip,
  });
  return res.ok ? { sentTo: res.email } : { error: res.error };
}
