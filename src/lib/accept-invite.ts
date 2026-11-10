// Turning an invite link into a login. The email always comes from the invite, never from the form.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accountInvites } from "@/db/schema";
import { auth } from "@/lib/auth";
import { contactEmail } from "@/lib/brand";
import { findUsableInvite } from "@/lib/invites";
import { runWithInvite } from "@/lib/invites-context";

export function invalidInviteText(): string {
  const contact = contactEmail();
  return `This invite link has expired or was already used.${contact ? ` Ask ${contact} for a new one.` : ""}`;
}

export async function acceptInvite(
  token: string,
  input: { name: string; password: string },
  headers?: Headers,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) return { ok: false, error: "Enter your name (up to 80 characters)." };
  if (input.password.length < 10) return { ok: false, error: "The password needs at least 10 characters." };

  const invite = await findUsableInvite(token);
  if (!invite) return { ok: false, error: invalidInviteText() };

  // Claim the invite first, so the same link can't create two logins even when submitted twice at once.
  const claimed = await db
    .update(accountInvites)
    .set({ acceptedAt: new Date() })
    .where(and(eq(accountInvites.id, invite.id), isNull(accountInvites.acceptedAt)))
    .returning({ id: accountInvites.id });
  if (claimed.length === 0) return { ok: false, error: invalidInviteText() };

  try {
    await runWithInvite(invite, () =>
      auth.api.signUpEmail({ body: { email: invite.email, password: input.password, name }, headers: headers ?? new Headers() }),
    );
    return { ok: true };
  } catch (err) {
    await db.update(accountInvites).set({ acceptedAt: null }).where(eq(accountInvites.id, invite.id));
    const message = err instanceof Error && err.message ? err.message : "Could not create the account";
    return { ok: false, error: message };
  }
}
