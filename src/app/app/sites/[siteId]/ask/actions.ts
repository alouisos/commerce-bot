"use server";

import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSiteAccess } from "@/lib/access";
import { answerQuestion } from "@/lib/ask/answer";
import { NotFoundError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

export type AskSource = { id: string; startedAt: string };
export type AskMessage = { role: "user" | "assistant"; content: string; sources?: AskSource[] };
/** The thread lives only in the page's state; it comes back with each question. */
export type AskState = { messages: AskMessage[]; error?: string; draft?: string };

const MAX_MESSAGES = 40;
const threadSchema = z.array(
  z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(20_000),
    sources: z.array(z.object({ id: z.uuid(), startedAt: z.string().max(40) })).max(40).optional(),
  }),
);

/** Asks the Concierge one question about the site's conversations and appends the answer to the thread. */
export async function askAction(siteId: string, prev: AskState, formData: FormData): Promise<AskState> {
  const user = await requireUser();
  let site;
  try {
    site = await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const question = String(formData.get("question") ?? "").trim();
  // The previous state comes from the browser: only a well-formed thread is kept.
  const parsed = threadSchema.safeParse(Array.isArray(prev?.messages) ? prev.messages.slice(-MAX_MESSAGES) : []);
  const thread: AskMessage[] = parsed.success ? parsed.data : [];
  const history = thread.map((m) => ({ role: m.role, content: m.content }));

  let out;
  try {
    out = await answerQuestion({ siteId: site.id, userId: user.id, question, history });
  } catch (err) {
    console.error("ask model error", { siteId: site.id }, err);
    return { messages: thread, error: "Something went wrong. Try again in a moment.", draft: question };
  }
  if ("error" in out) return { messages: thread, error: out.error, draft: question };
  return {
    messages: [
      ...thread,
      { role: "user", content: question },
      {
        role: "assistant",
        content: out.answer,
        sources: out.sources.map((s) => ({ id: s.id, startedAt: s.startedAt.toISOString() })),
      },
    ],
  };
}
