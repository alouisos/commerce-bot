"use server";

import { redirect } from "next/navigation";
import { unsubscribeBuyer } from "@/lib/buyers/feedback";

export async function unsubscribeBuyerAction(token: string): Promise<void> {
  await unsubscribeBuyer(token);
  redirect(`/e/b/${encodeURIComponent(token)}`);
}
