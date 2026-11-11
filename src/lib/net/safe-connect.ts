// Outbound requests to addresses tenants control (their website, their shop's API). The address is
// checked at connect time, in the same lookup the socket uses, so DNS rebinding can't swap a public
// answer for an internal one after the check. Only ports 80 and 443 are allowed.
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { isBlockedAddress } from "@/lib/crawl/ssrf";

type Answer = { address: string; family: number };
type Resolve = (host: string) => Promise<Answer[]>;
type LookupCallback = (err: Error | null, address?: string | Answer[], family?: number) => void;

const defaultResolve: Resolve = async (host) => (await dnsLookup(host, { all: true })).map((a) => ({ address: a.address, family: a.family }));

/** A `lookup` for net/tls sockets that resolves the name and refuses if any answer is an internal address. */
export function createSafeLookup(resolve: Resolve = defaultResolve) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    const all = typeof options === "object" && options?.all === true;
    resolve(hostname).then(
      (answers) => {
        if (answers.length === 0) return callback(new Error(`No address for ${hostname}`));
        if (answers.some((a) => isBlockedAddress(a.address))) {
          const err = new Error(`Connecting to ${hostname} is not allowed (internal address)`) as Error & { code?: string };
          err.code = "EADDRNOTALLOWED";
          return callback(err);
        }
        if (all) return callback(null, answers);
        callback(null, answers[0].address, answers[0].family);
      },
      (err: Error) => callback(err),
    );
  };
}

export function allowedPort(url: URL): boolean {
  const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return port === "80" || port === "443";
}

let agent: Agent | null = null;
function safeAgent(): Agent {
  agent ??= new Agent({ connect: { lookup: createSafeLookup() as unknown as LookupFunction } });
  return agent;
}

/** fetch() for tenant-controlled addresses: public addresses only, pinned at connect time, ports 80/443. */
export async function safeFetch(url: string, init: UndiciRequestInit = {}): Promise<Response> {
  if (!allowedPort(new URL(url))) throw new Error("Only ports 80 and 443 are allowed");
  return (await undiciFetch(url, { ...init, dispatcher: safeAgent() })) as unknown as Response;
}
