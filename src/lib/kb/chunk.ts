export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

interface Atom {
  s: number;
  e: number;
  /** Piece of a word longer than maxChars: no overlap across these. */
  hard: boolean;
}

function matches(text: string, re: RegExp, from: number, to: number): Array<[number, number]> {
  const slice = text.slice(from, to);
  const out: Array<[number, number]> = [];
  for (const m of slice.matchAll(re)) out.push([from + m.index, from + m.index + m[0].length]);
  return out;
}

function splitAtoms(text: string, s: number, e: number, max: number, level: 0 | 1 | 2): Atom[] {
  if (e - s <= max) return [{ s, e, hard: false }];
  if (level === 0) {
    // sentences
    const parts = matches(text, /\S[^.!?…]*(?:[.!?…]+["')\]]*|$)/g, s, e);
    if (parts.length > 1) return parts.flatMap(([a, b]) => splitAtoms(text, a, b, max, 1));
    return splitAtoms(text, s, e, max, 1);
  }
  if (level === 1) {
    const words = matches(text, /\S+/g, s, e);
    return words.flatMap(([a, b]) => splitAtoms(text, a, b, max, 2));
  }
  // single oversized word: hard split, never in the middle of a surrogate pair
  const out: Atom[] = [];
  let p = s;
  while (p < e) {
    let q = Math.min(p + max, e);
    if (q < e) {
      const c = text.charCodeAt(q - 1);
      if (c >= 0xd800 && c <= 0xdbff && q - 1 > p) q -= 1;
    }
    out.push({ s: p, e: q, hard: true });
    p = q;
  }
  return out;
}

/**
 * Splits text into chunks of at most `maxChars`. Splits on blank lines first,
 * then sentences, then words; a word is only split when it alone exceeds
 * `maxChars` (hard split, no overlap). Overlap between normal chunks starts
 * about `overlapChars` before the previous chunk's end, snapped forward to a
 * sentence/word boundary so no chunk starts mid-word.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const max = Math.max(1, opts.maxChars ?? 3200);
  const overlap = Math.max(0, Math.min(opts.overlapChars ?? 200, max - 1));

  const atoms: Atom[] = [];
  for (const [a, b] of matches(text, /\S(?:[\s\S]*?\S)?(?=\s*\n\s*\n|\s*$)/g, 0, text.length)) {
    atoms.push(...splitAtoms(text, a, b, max, 0));
  }

  const chunks: string[] = [];
  let i = 0;
  while (i < atoms.length) {
    const start = atoms[i].s;
    let j = i;
    while (j + 1 < atoms.length && atoms[j + 1].e - start <= max) j++;
    chunks.push(text.slice(start, atoms[j].e));
    if (j === atoms.length - 1) break;
    if (atoms[j].hard || atoms[j + 1].hard) {
      i = j + 1;
      continue;
    }
    const target = atoms[j].e - overlap;
    let k = i + 1;
    while (k <= j && atoms[k].s < target) k++;
    i = k;
  }
  return chunks.map((c) => c.trim()).filter(Boolean);
}
