import { handleChat } from "@/lib/chat/handle-chat";
import { preflight } from "@/lib/widget/guard";

export function POST(req: Request): Promise<Response> {
  return handleChat(req);
}

export const OPTIONS = preflight;
