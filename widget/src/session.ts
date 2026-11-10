// Visitor identity is per visit only: ids live in sessionStorage, never cookies.
// If storage is unavailable (blocked, private mode) values live in memory for the page's life.

const SID = "concierge.sid";
const CID = "concierge.cid";
const TEASED = "concierge.teased";

const memory: { sid: string | null; cid: string | null; teased: boolean } = { sid: null, cid: null, teased: false };

/** undefined means storage threw (use memory); null means storage works and has no value. */
function read(store: Storage, key: string): string | null | undefined {
  if (memoryOnly) return undefined;
  try {
    return store.getItem(key);
  } catch {
    return undefined;
  }
}

// Once a write fails (quota, private mode, blocked site data) memory is the source of truth for the
// page's life, so the sid, cid and suggestion state stay stable. A store that accepts a write but
// doesn't keep it (the fallback used when sessionStorage itself is blocked) counts as failing.
let memoryOnly = false;

function write(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
    if (store.getItem(key) !== value) memoryOnly = true;
  } catch {
    memoryOnly = true;
  }
}

export function getSession(store: Storage): { sid: string; cid: string | null } {
  const stored = read(store, SID);
  let sid = stored === undefined ? memory.sid : stored;
  if (!sid) {
    sid = crypto.randomUUID();
    write(store, SID, sid);
  }
  memory.sid = sid;
  const cid = read(store, CID);
  return { sid, cid: cid === undefined ? memory.cid : cid };
}

export function setConversationId(store: Storage, cid: string): void {
  memory.cid = cid;
  write(store, CID, cid);
}

export function hasTeased(store: Storage): boolean {
  const v = read(store, TEASED);
  return v === undefined ? memory.teased : v === "1";
}

export function markTeased(store: Storage): void {
  memory.teased = true;
  write(store, TEASED, "1");
}

// Suggestion state for the visit: survives page loads so the cap and the silence hold.
const PROMPTS = "concierge.prompts";

export type PromptState = { shown: number; lastShownAt: number | null; silenced: boolean; requestedPages: string[] };

const EMPTY: PromptState = { shown: 0, lastShownAt: null, silenced: false, requestedPages: [] };
let promptMemory: PromptState = { ...EMPTY };

export function getPromptState(store: Storage): PromptState {
  const raw = read(store, PROMPTS);
  if (raw === undefined) return { ...promptMemory, requestedPages: [...promptMemory.requestedPages] };
  if (raw === null) return { ...EMPTY, requestedPages: [] };
  try {
    const v = JSON.parse(raw) as Partial<PromptState>;
    const state: PromptState = {
      shown: typeof v.shown === "number" ? v.shown : 0,
      lastShownAt: typeof v.lastShownAt === "number" ? v.lastShownAt : null,
      silenced: v.silenced === true,
      requestedPages: Array.isArray(v.requestedPages) ? v.requestedPages.filter((p) => typeof p === "string") : [],
    };
    // Kept in memory too, so a later failing write can't forget a dismissal read from storage.
    promptMemory = state;
    return { ...state, requestedPages: [...state.requestedPages] };
  } catch {
    return { ...EMPTY };
  }
}

export function updatePromptState(store: Storage, patch: Partial<PromptState>): PromptState {
  const next = { ...getPromptState(store), ...patch };
  next.requestedPages = next.requestedPages.slice(-50);
  promptMemory = next;
  write(store, PROMPTS, JSON.stringify(next));
  return next;
}
