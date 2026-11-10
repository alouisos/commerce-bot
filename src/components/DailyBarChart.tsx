const W = 640;
const H = 160;
const PAD = { top: 12, right: 8, bottom: 22, left: 32 };

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** Round the axis top up to a clean number. */
function niceMax(v: number): number {
  if (v <= 5) return Math.max(1, v);
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

/**
 * Conversations per UTC day as columns. A server-rendered SVG with a native tooltip per day and a
 * visually hidden table of the same numbers for screen readers.
 */
export function DailyBarChart({ data, title }: { data: { day: string; conversations: number }[]; title: string }) {
  const max = niceMax(Math.max(1, ...data.map((d) => d.conversations)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(data.length / 7);
  const total = data.reduce((s, d) => s + d.conversations, 0);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby="daily-chart-title daily-chart-desc"
        className="h-auto w-full max-w-3xl [--bar:#2a78d6] dark:[--bar:#3987e5]"
      >
        <title id="daily-chart-title">{title}</title>
        <desc id="daily-chart-desc">
          {total} conversations over {data.length} days, from {data[0] ? shortDay(data[0].day) : ""} to{" "}
          {data.at(-1) ? shortDay(data.at(-1)!.day) : ""}.
        </desc>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              strokeOpacity={v === 0 ? 0.35 : 0.12}
            />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity={0.7}>
              {Number.isInteger(v) ? v : ""}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const h = Math.max(1, (d.conversations / max) * plotH);
          const top = PAD.top + plotH - h;
          const r = d.conversations > 0 ? Math.min(4, barW / 2, h) : 0;
          // Rounded top corners, square at the baseline.
          const x0 = cx - barW / 2;
          const x1 = cx + barW / 2;
          const base = PAD.top + plotH;
          const path = `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`;
          return (
            <g key={d.day}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent">
                <title>{`${shortDay(d.day)}: ${d.conversations} conversation${d.conversations === 1 ? "" : "s"}`}</title>
              </rect>
              <path d={path} fill={d.conversations > 0 ? "var(--bar)" : "currentColor"} fillOpacity={d.conversations > 0 ? 1 : 0.25} pointerEvents="none" />
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity={0.7}>
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Conversations</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.conversations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
