// Visitor identity is per visit only: ids live in sessionStorage, never cookies.
// If storage is unavailable (blocked, private mode) values live in memory for the page's life.

const SID = "concierge.sid";
const CID = "concierge.cid";
const TEASED = "concierge.teased";
const CONSENT_ASKED = "concierge.consentAsked";
const REF = "concierge.ref";
const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const memory: { sid: string | null; cid: string | null; teased: boolean; consentAsked: boolean; ref: string | null } = {
  sid: null,
  cid: null,
  teased: false,
  consentAsked: false,
  ref: null,
};

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

/** The email offer is made at most once per visit, whatever the answer. */
export function consentAsked(store: Storage): boolean {
  const v = read(store, CONSENT_ASKED);
  return v === undefined ? memory.consentAsked : v === "1";
}

export function markConsentAsked(store: Storage): void {
  memory.consentAsked = true;
  write(store, CONSENT_ASKED, "1");
}

/** The email attribution reference (cc_ref) this visit arrived with, if any. */
export function getRef(store: Storage): string | null {
  const v = read(store, REF);
  const ref = v === undefined ? memory.ref : v;
  return ref && REF_PATTERN.test(ref) ? ref : null;
}

/** Stores a well-formed ref for the visit; anything else is ignored. */
export function setRef(store: Storage, ref: string | null): void {
  if (!ref || !REF_PATTERN.test(ref)) return;
  memory.ref = ref;
  write(store, REF, ref);
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
