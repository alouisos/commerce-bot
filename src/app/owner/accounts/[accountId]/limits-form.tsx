"use client";

import { useActionState } from "react";
import type { LimitOverrides, PlanLimits } from "@/lib/plans";
import { saveLimitsAction, type OwnerFormState } from "../../actions";

const MB = 1024 * 1024;

type Props = {
  accountId: string;
  plan: PlanLimits;
  overrides: LimitOverrides;
  trialEndsOn: string | null;
};

function NumberField(props: { name: string; label: string; value: number | undefined; plan: number }) {
  return (
    <label className="flex flex-col gap-1">
      {props.label}
      <input
        name={props.name}
        inputMode="numeric"
        defaultValue={props.value === undefined ? "" : String(props.value)}
        placeholder={`${props.plan} (plan)`}
        className="w-40"
      />
    </label>
  );
}

function Toggle(props: { name: string; label: string; value: boolean | undefined; plan: boolean }) {
  const current = props.value === undefined ? "default" : props.value ? "on" : "off";
  return (
    <label className="flex flex-col gap-1">
      {props.label}
      <select name={props.name} defaultValue={current} className="w-48">
        <option value="default">Plan default ({props.plan ? "on" : "off"})</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  );
}

export function LimitsForm({ accountId, plan, overrides, trialEndsOn }: Props) {
  const [state, action, pending] = useActionState<OwnerFormState, FormData>(saveLimitsAction.bind(null, accountId), {});
  const mb = (b: number | undefined) => (b === undefined ? undefined : Math.round(b / MB));
  const usd = (m: number | undefined) => (m === undefined ? undefined : m / 1_000_000);
  return (
    <form action={action} className="card">
      <h2>Limits</h2>
      <p className="text-sm text-ink-muted font-normal">Leave a field empty to use the plan&apos;s value.</p>
      <div className="flex flex-wrap gap-4">
        <NumberField name="websites" label="Websites" value={overrides.websites} plan={plan.websites} />
        <NumberField
          name="conversationsPerMonth"
          label="Conversations per month"
          value={overrides.conversationsPerMonth}
          plan={plan.conversationsPerMonth}
        />
        <NumberField name="emailsPerMonth" label="Emails per month" value={overrides.emailsPerMonth} plan={plan.emailsPerMonth} />
        <NumberField name="storageMb" label="Storage (MB)" value={mb(overrides.storageBytes)} plan={Math.round(plan.storageBytes / MB)} />
        <NumberField
          name="aiCeilingUsd"
          label="AI spend ceiling (USD per month)"
          value={usd(overrides.aiCostCeilingMicros)}
          plan={plan.aiCostCeilingMicros / 1_000_000}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <Toggle name="autoSendEmails" label="Automatic email sending" value={overrides.autoSendEmails} plan={plan.autoSendEmails} />
        <Toggle name="removeBadge" label="Remove Powered-by badge" value={overrides.removeBadge} plan={plan.removeBadge} />
      </div>
      {trialEndsOn !== null && (
        <label className="flex flex-col gap-1">
          Trial ends on
          <input type="date" name="trialEndsOn" defaultValue={trialEndsOn} className="w-48" />
        </label>
      )}
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">Limits saved.</p>}
      <button type="submit" disabled={pending} className="btn-primary self-start">
        Save limits
      </button>
    </form>
  );
}
