import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

// Sign-up is invite-only: accepting an invite calls Better Auth on the server, never this endpoint. Refusing
// it here, before Better Auth runs, also stops it from revealing which addresses already have an account.
export async function POST(req: Request): Promise<Response> {
  if (new URL(req.url).pathname.replace(/\/+$/, "").endsWith("/sign-up/email")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return handler.POST(req);
}
