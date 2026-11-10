import { env } from "@/lib/env";
import { sendMail } from "@/lib/email/provider";

/** The platform's own notifications (password reset, lead alerts), sent from EMAIL_FROM. */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return;
  }
  await sendMail({ from: env.EMAIL_FROM, ...msg });
}
