import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { accountInvites, accounts, memberships } from "@/db/schema";
import { createAccountForUser } from "@/lib/accounts";
import { currentInvite } from "@/lib/invites-context";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { lazy } from "@/lib/lazy";
import { hit } from "@/lib/usage/rate-limit";

/** Sign-in attempts per address per hour, whatever the IP: slows password guessing against one account. */
const SIGN_IN_ATTEMPTS_PER_EMAIL_PER_HOUR = 30;

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
      // Not awaited: the reply takes as long whether or not the address has an account.
      sendResetPassword: async ({ user, url }) => {
        void sendEmail({
          to: user.email,
          subject: "Reset your password",
          text: `Reset your password using this link:\n\n${url}\n\nIf you did not request this, ignore this email.`,
        }).catch((err) => console.error("password reset email failed", err));
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").trim().toLowerCase();
        if (!email) return;
        const key = createHash("sha256").update(email).digest("base64url").slice(0, 22);
        if (!(await hit(`signin:email:${key}`, SIGN_IN_ATTEMPTS_PER_EMAIL_PER_HOUR, 3600))) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in attempts. Try again later." });
        }
      }),
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
              // A trial's 14 days start when the invitee joins, not when the invite was sent.
              await tx
                .update(accounts)
                .set({ trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) })
                .where(and(eq(accounts.id, invite.accountId), eq(accounts.plan, "trial")));
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
