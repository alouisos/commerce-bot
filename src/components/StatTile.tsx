/** One headline number. Render inside a `<dl>`. */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border p-3">
      <dt className="text-sm">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
      {note && <dd className="text-xs opacity-70">{note}</dd>}
    </div>
  );
}
