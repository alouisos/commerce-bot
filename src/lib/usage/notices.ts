// Daily: tell account owners when they reach 80 % or 100 % of a limit, or when their trial ends. Each
// notice is recorded before it's sent, so a crash loses one email rather than repeating it.
import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accountNotices, accounts, memberships, type Account } from "@/db/schema";
import { contactEmail } from "@/lib/brand";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { ownerEmails } from "@/lib/leads";
import { appBaseUrl } from "@/lib/widget/config";
import { monthKey } from "./meter";
import { usageLevels } from "./levels";

const DAY = 86400_000;
const TRIAL_SOON_DAYS = 3;

type Kind =
  | "conversations_80"
  | "conversations_100"
  | "emails_80"
  | "emails_100"
  | "storage_80"
  | "trial_ending"
  | "trial_ended";

const ADMIN_COPY = new Set<Kind>(["conversations_100", "emails_100", "trial_ended"]);

function message(kind: Kind, account: Account, now: Date): { subject: string; body: string } {
  const name = account.name;
  const contact = contactEmail();
  const reach = contact ? ` Contact ${contact} to raise your limit.` : "";
  const full = `Your bot keeps answering visitors, but it won't make new suggestions or write new emails until next month.${reach}`;
  switch (kind) {
    case "conversations_80":
      return { subject: `${name}: 80 % of this month's conversations used`, body: `You've used 80 % of this month's conversations.${reach}` };
    case "conversations_100":
      return { subject: `${name}: this month's conversations are used up`, body: full };
    case "emails_80":
      return { subject: `${name}: 80 % of this month's emails used`, body: `You've used 80 % of this month's emails.${reach}` };
    case "emails_100":
      return { subject: `${name}: this month's emails are used up`, body: full };
    case "storage_80":
      return {
        subject: `${name}: 80 % of your knowledge-base storage used`,
        body: `Your knowledge base is close to its storage limit; new documents won't fit once it's full.${reach}`,
      };
    case "trial_ending": {
      const days = Math.max(1, Math.ceil(((account.trialEndsAt?.getTime() ?? now.getTime()) - now.getTime()) / DAY));
      return {
        subject: `Your Concierge trial ends in ${days} ${days === 1 ? "day" : "days"}`,
        body: `After that your bot answers with "leave your email" instead of AI replies.${contact ? ` Contact ${contact} to keep it running.` : ""}`,
      };
    }
    case "trial_ended":
      return {
        subject: "Your Concierge trial has ended",
        body: `Your bot now asks visitors to leave their email instead of answering with AI.${contact ? ` Contact ${contact} to continue.` : ""}`,
      };
  }
}

async function dueKinds(account: Account, now: Date): Promise<{ kind: Kind; period: string }[]> {
  const month = monthKey(now);
  const out: { kind: Kind; period: string }[] = [];
  const levels = await usageLevels(account, now);
  if (account.plan !== "complimentary") {
    for (const metric of ["conversations", "emails"] as const) {
      const l = levels[metric].level;
      if (l === "warning" || l === "full") out.push({ kind: `${metric}_80`, period: month });
      if (l === "full") out.push({ kind: `${metric}_100`, period: month });
    }
  }
  if (levels.storage.level !== "ok") out.push({ kind: "storage_80", period: month });
  if (account.plan === "trial" && account.trialEndsAt) {
    const left = account.trialEndsAt.getTime() - now.getTime();
    if (left <= 0) out.push({ kind: "trial_ended", period: "trial" });
    else if (left <= TRIAL_SOON_DAYS * DAY) out.push({ kind: "trial_ending", period: "trial" });
  }
  return out;
}

export async function sendUsageNotices(
  now: Date = new Date(),
  opts: { platformOwners?: string[] } = {},
): Promise<number> {
  const admins = opts.platformOwners ?? env.PLATFORM_OWNER_EMAILS;
  const rows = await db
    .select()
    .from(accounts)
    .where(sql`exists (select 1 from ${memberships} m where m.account_id = ${accounts.id})`)
    .orderBy(asc(accounts.createdAt));
  let sent = 0;
  for (const account of rows) {
    try {
      const due = await dueKinds(account, now);
      if (due.length === 0) continue;
      const owners = await ownerEmails(account.id);
      if (owners.length === 0) continue;
      for (const { kind, period } of due) {
        const inserted = await db
          .insert(accountNotices)
          .values({ accountId: account.id, period, kind })
          .onConflictDoNothing()
          .returning({ id: accountNotices.id });
        if (inserted.length === 0) continue;
        sent++;
        const { subject, body } = message(kind, account, now);
        const text = `${body}\n\nSee your usage: ${appBaseUrl()}/app/usage`;
        for (const to of owners) await sendEmail({ to, subject, text });
        if (ADMIN_COPY.has(kind)) {
          for (const to of admins) await sendEmail({ to, subject: `[Concierge admin] ${subject}`, text: `Account: ${account.name}\n\n${text}` });
        }
      }
    } catch (err) {
      console.error("usage notice failed", { accountId: account.id }, err);
    }
  }
  return sent;
}
