type Rule = { allow: boolean; pattern: string; re: RegExp };

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * Rules for our crawler: the `User-agent: ConciergeBot` group if there is one
 * (case-insensitive), otherwise the `User-agent: *` group. Longest matching
 * pattern wins; Allow wins ties.
 */
export function parseRobots(txt: string): (path: string) => boolean {
  const star: Rule[] = [];
  const bot: Rule[] = [];
  let hasBot = false;
  let inStar = false;
  let inBot = false;
  let prevWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      const isStar = value === "*";
      const isBot = value.toLowerCase() === "conciergebot";
      inStar = prevWasAgent ? inStar || isStar : isStar;
      inBot = prevWasAgent ? inBot || isBot : isBot;
      if (isBot) hasBot = true;
      prevWasAgent = true;
      continue;
    }
    prevWasAgent = false;
    if ((!inStar && !inBot) || (key !== "allow" && key !== "disallow")) continue;
    if (!value) continue; // empty Disallow allows all; empty Allow is a no-op
    const rule = { allow: key === "allow", pattern: value, re: toRegExp(value) };
    if (inStar) star.push(rule);
    if (inBot) bot.push(rule);
  }
  const rules = hasBot ? bot : star;
  return (path) => {
    let best: Rule | null = null;
    for (const r of rules) {
      if (!r.re.test(path)) continue;
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
    }
    return best ? best.allow : true;
  };
}

export function sitemapsFromRobots(txt: string): string[] {
  const out: string[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(raw);
    if (m) out.push(m[1]);
  }
  return out;
}
