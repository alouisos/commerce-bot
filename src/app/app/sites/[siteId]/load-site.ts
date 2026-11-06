import { notFound } from "next/navigation";
import { requireSiteAccess } from "@/lib/access";
import { NotFoundError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

/** Authenticates the user and loads the site they may access, or renders the 404 page. */
export async function loadSite(siteId: string) {
  const user = await requireUser();
  try {
    return await requireSiteAccess(user.id, siteId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
