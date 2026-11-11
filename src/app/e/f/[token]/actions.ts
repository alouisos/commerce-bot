"use server";

import { submitFeedback } from "@/lib/buyers/feedback";

export type FeedbackState = { error?: string; done?: boolean };

export async function feedbackAction(token: string, _prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const rating = Number(formData.get("rating"));
  const comment = formData.get("comment");
  const res = await submitFeedback(token, { rating, comment: typeof comment === "string" ? comment : "" });
  return "error" in res ? { error: res.error } : { done: true };
}
