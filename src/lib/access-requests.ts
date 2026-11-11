import { createHash } from "node:crypto";
import { z } from "zod";
import { SIGNUP_EMAIL } from "@/lib/brand";
import { env } from "@/lib/env";
import { EmailNotConfiguredError, logUnsent, sendMail } from "@/lib/email/provider";
import { hit } from "@/lib/usage/rate-limit";

export type AccessRequestResult = { ok: true; email: string } | { ok: false; error: string };

type Mail = { to: string; subject: string; text: string };
export type SendFn = (msg: Mail) => Promise<void>;

/**
 * Sends the request to the platform owner. Unlike sendEmail, a production server with no provider
 * refuses rather than logging, so a visitor is never told "thanks" for a request nobody received.
 */
export const sendAccessEmail: SendFn = async (msg) => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (process.env.NODE_ENV === "production") throw new EmailNotConfiguredError();
    logUnsent(msg);
    return;
  }
  await sendMail({ from: env.EMAIL_FROM, ...msg });
};

/** Rate-limit records hold a hash of the address, never the address (as widget/subscribe.ts does). */
const emailKey = (email: string) => createHash("sha256").update(email).digest("base64url").slice(0, 22);

const emailSchema = z.email().max(254);

/**
 * A visitor asks for an invite (sign-up is invite-only). Emails the address to SIGNUP_EMAIL.
 * `website` is a honeypot field people never see: when it's filled, report success and send nothing.
 */
export async function requestAccess(
  input: { email: string; website?: string; ip: string },
  send: SendFn = sendAccessEmail,
  now: Date = new Date(),
): Promise<AccessRequestResult> {
  const email = input.email.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) return { ok: false, error: "Enter a valid email address." };
  if (input.website) return { ok: true, email };

  const allowed =
    (await hit(`access:ip:${input.ip}`, 5, 3600, now)) &&
    (await hit(`access:email:${emailKey(email)}`, 3, 86_400, now)) &&
    (await hit("access:all", 100, 86_400, now));
  if (!allowed) return { ok: false, error: "Too many requests. Please try again later." };

  const appUrl = env.APP_URL.replace(/\/+$/, "");
  try {
    await send({
      to: SIGNUP_EMAIL,
      subject: `Concierge invite request: ${email}`,
      text: [
        `${email} asked for a Concierge account on ${now.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
        "",
        `Send them an invite from the owner console: ${appUrl}/owner`,
      ].join("\n"),
    });
  } catch {
    return { ok: false, error: "We couldn't send your request just now. Please try again in a few minutes." };
  }
  return { ok: true, email };
}
