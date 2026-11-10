import { isIP } from "node:net";

function v4Blocked(a: number, b: number, c = -1): boolean {
  return (
    a === 0 ||
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 (IETF protocol assignments)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 (benchmarking, sometimes internal)
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Expands an IPv6 literal into eight 16-bit groups, or null if malformed. */
function groups6(ip: string): number[] | null {
  let s = ip.split("%")[0].toLowerCase();
  const m = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (m) {
    const [x, y, z, w] = m.slice(2).map(Number);
    s = `${m[1]}${((x << 8) | y).toString(16)}:${((z << 8) | w).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}

/** True for addresses a crawler must never fetch. Unparseable input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  const bare = ip.replace(/^\[|\]$/g, "");
  if (kind === 4) {
    const [a, b, c] = bare.split(".").map(Number);
    return v4Blocked(a, b, c);
  }
  if (kind === 6) {
    const g = groups6(bare);
    if (!g) return true;
    if (g.every((n) => n === 0)) return true; // ::
    if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
    if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return v4Blocked(g[6] >> 8, g[6] & 255, g[7] >> 8); // ::ffff:a.b.c.d
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64 can reach IPv4 inside)
    if (g.slice(0, 6).every((n) => n === 0)) return true; // deprecated IPv4-compatible
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true;
}
