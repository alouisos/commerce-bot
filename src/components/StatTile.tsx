import Link from "next/link";

/** One headline number. Render inside a `<dl className="stat-strip …">`. `alert` lights it red; `action` links to the fix. */
export function StatTile({
  label,
  value,
  note,
  alert = false,
  action,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
  action?: { href: string; label: string };
}) {
  return (
    <div className={alert ? "stat stat-alert" : "stat"}>
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
      {note && <dd className="stat-note">{note}</dd>}
      {action && (
        <dd className="stat-action">
          <Link href={action.href}>{action.label}</Link>
        </dd>
      )}
    </div>
  );
}
