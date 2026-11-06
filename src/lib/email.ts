import { Resend } from "resend";
import { env } from "@/lib/env";

export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return;
  }
  const { error } = await new Resend(env.RESEND_API_KEY).emails.send({
    from: env.EMAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
  if (error) throw new Error(`Failed to send email: ${error.message}`);
}
