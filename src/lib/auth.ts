import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { accountInvites, memberships } from "@/db/schema";
import { createAccountForUser } from "@/lib/accounts";
import { currentInvite } from "@/lib/invites-context";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { lazy } from "@/lib/lazy";

const createAuth = () =>
  betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    database: drizzleAdapter(db, { provider: "pg" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // A password reset must also end every other session (e.g. one an attacker holds).
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your password",
          text: `Reset your password using this link:\n\n${url}\n\nIf you did not request this, ignore this email.`,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Sign-up is invite-only: a new login is allowed only while an invite for that address is being
          // accepted (acceptInvite), or from server-side code with no request (scripts).
          before: async (user, ctx) => {
            const invite = currentInvite();
            if (invite && invite.email === user.email.toLowerCase()) return;
            if (ctx === null) return;
            return false;
          },
          after: async (user) => {
            const invite = currentInvite();
            if (!invite) {
              await createAccountForUser(user.id, user.email);
              return;
            }
            await db.transaction(async (tx) => {
              await tx.insert(memberships).values({ accountId: invite.accountId, userId: user.id, role: "owner" });
              await tx.update(accountInvites).set({ acceptedUserId: user.id }).where(eq(accountInvites.id, invite.id));
            });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });

/** Configured on first use, so importing this module needs no env (e.g. during `next build`). */
export const auth = lazy(createAuth);
