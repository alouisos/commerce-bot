import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function requireUser(): Promise<{ id: string; email: string }> {
  // Read the request first: it marks the route dynamic before anything touches the runtime env.
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");
  return { id: session.user.id, email: session.user.email };
}
