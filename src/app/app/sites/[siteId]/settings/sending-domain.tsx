"use client";

import { useActionState } from "react";
import type { DnsRecord } from "@/lib/email/provider";
import {
  addSendingDomainAction,
  refreshSendingDomainAction,
  removeSendingDomainAction,
  type SettingsState,
} from "./actions";

type Props = {
  siteId: string;
  domain: string | null;
  status: "none" | "pending" | "verified" | "failed";
  suggested: string;
  fromLocal: string;
  records: DnsRecord[];
};

function Message({ state }: { state: SettingsState }) {
  return state.error ? (
    <p role="alert" className="text-danger">
      {state.error}
    </p>
  ) : null;
}

export function SendingDomain({ siteId, domain, status, suggested, fromLocal, records }: Props) {
  const [addState, add, adding] = useActionState<SettingsState, FormData>(addSendingDomainAction.bind(null, siteId), {});
  const [checkState, check, checking] = useActionState<SettingsState>(refreshSendingDomainAction.bind(null, siteId), {});
  const remove = removeSendingDomainAction.bind(null, siteId);

  if (!domain || status === "none") {
    return (
      <section className="card">
        <h2>Sending domain</h2>
        <p className="text-sm text-ink-muted font-normal">Follow-up emails are sent from your own domain once it&apos;s verified.</p>
        <form action={add} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            Sending domain
            <input name="domain" defaultValue={suggested} required />
          </label>
          <Message state={addState} />
          <button type="submit" disabled={adding} className="btn-primary self-start">
            Set up
          </button>
        </form>
      </section>
    );
  }

  if (status === "verified") {
    return (
      <section className="card">
        <h2>Sending domain</h2>
        <p>
          Emails are sent from {fromLocal}@{domain}.
        </p>
        <form action={remove}>
          <button type="submit" className="self-start">
            Remove
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Sending domain: {domain}</h2>
      {status === "failed" && <p className="text-danger">The last check failed. Check the records below.</p>}
      {records.length > 0 && (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="text-left">Type</th>
              <th className="text-left">Name</th>
              <th className="text-left">Value</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={`${r.type}-${r.name}-${r.value}`}>
                <td>{r.type}</td>
                <td className="font-mono">{r.name}</td>
                <td className="font-mono break-all">
                  {r.priority !== undefined ? `${r.priority} ` : ""}
                  {r.value}
                </td>
                <td><span className={r.status === "verified" ? "badge badge-ok" : r.status === "failed" ? "badge badge-crit" : "badge badge-warn"}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <p className="text-sm">Add these records at your domain provider, then check. It can take up to a few hours.</p>
      <Message state={checkState} />
      <div className="flex gap-2">
        <form action={check}>
          <button type="submit" disabled={checking} className="btn-primary">
            Check now
          </button>
        </form>
        <form action={remove}>
          <button type="submit">
            Remove
          </button>
        </form>
      </div>
    </section>
  );
}
