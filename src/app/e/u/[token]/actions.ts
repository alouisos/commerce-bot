"use server";

import { redirect } from "next/navigation";
import { unsubscribe } from "@/lib/email/links";

export async function unsubscribeAction(token: string): Promise<void> {
  await unsubscribe(token);
  redirect(`/e/u/${encodeURIComponent(token)}`);
}
