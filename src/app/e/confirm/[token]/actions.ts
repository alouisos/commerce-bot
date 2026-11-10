"use server";

import { redirect } from "next/navigation";
import { confirmContact } from "@/lib/email/contacts";

export async function confirmAction(token: string): Promise<void> {
  await confirmContact(token);
  redirect(`/e/confirm/${encodeURIComponent(token)}`);
}
