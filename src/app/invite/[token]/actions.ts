"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/accept-invite";

export type AcceptState = { error?: string };

export async function acceptInviteAction(token: string, _prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const res = await acceptInvite(
    token,
    { name: String(formData.get("name") ?? ""), password: String(formData.get("password") ?? "") },
    await headers(),
  );
  if (!res.ok) return { error: res.error };
  redirect("/app");
}
