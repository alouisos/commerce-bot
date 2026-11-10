// The one place that talks to the email provider (Resend). Tests swap it with setProviderForTests.
import { Resend } from "resend";
import { env } from "@/lib/env";

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

export type DnsRecord = { type: string; name: string; value: string; priority?: number; status: string };

export type ProviderDomain = { id: string; status: string; records: DnsRecord[] };

export type Provider = {
  send(msg: OutgoingEmail): Promise<{ id: string | null }>;
  createDomain(name: string): Promise<ProviderDomain>;
  getDomain(id: string): Promise<ProviderDomain>;
  verifyDomain(id: string): Promise<void>;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email isn't set up on this server yet.");
    this.name = "EmailNotConfiguredError";
  }
}

/**
 * No provider configured: say where the email would have gone. The text (reset and invite links, tokens)
 * is printed only outside production, where it's useful for development.
 */
export function logUnsent(msg: { to: string; subject: string; text: string }): void {
  if (process.env.NODE_ENV === "production") {
    console.log(`[email] not sent (no provider): to=*@${msg.to.split("@")[1] ?? "?"} subject="${msg.subject}"`);
    return;
  }
  console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
}

function client(): Resend | null {
  return env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
}

function requireClient(): Resend {
  const c = client();
  if (!c) throw new EmailNotConfiguredError();
  return c;
}

function toRecords(records: { type: string; name: string; value: string; priority?: number; status: string }[]): DnsRecord[] {
  return records.map((r) => ({
    type: r.type,
    name: r.name,
    value: r.value,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    status: r.status,
  }));
}

const resendProvider: Provider = {
  async send(msg) {
    const c = client();
    if (!c) {
      logUnsent(msg);
      return { id: null };
    }
    const { data, error } = await c.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    if (error) throw new Error(`Failed to send email: ${error.message}`);
    return { id: data?.id ?? null };
  },
  async createDomain(name) {
    const { data, error } = await requireClient().domains.create({ name });
    if (error || !data) throw new Error(error?.message ?? "The email provider returned no domain");
    return { id: data.id, status: data.status, records: toRecords(data.records) };
  },
  async getDomain(id) {
    const { data, error } = await requireClient().domains.get(id);
    if (error || !data) throw new Error(error?.message ?? "The email provider returned no domain");
    return { id: data.id, status: data.status, records: toRecords(data.records) };
  },
  async verifyDomain(id) {
    const { error } = await requireClient().domains.verify(id);
    if (error) throw new Error(error.message);
  },
};

let override: Partial<Provider> | null = null;

/** Tests replace some or all provider calls; null restores the real provider. */
export function setProviderForTests(p: Partial<Provider> | null): void {
  override = p;
}

const provider = (): Provider => ({ ...resendProvider, ...(override ?? {}) });

export const sendMail = (msg: OutgoingEmail) => provider().send(msg);
export const createDomain = (name: string) => provider().createDomain(name);
export const getDomain = (id: string) => provider().getDomain(id);
export const verifyDomain = (id: string) => provider().verifyDomain(id);
