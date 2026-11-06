// Visitor identity is per visit only: ids live in sessionStorage, never cookies.
// If storage is unavailable (blocked, private mode) values live in memory for the page's life.

const SID = "concierge.sid";
const CID = "concierge.cid";
const TEASED = "concierge.teased";

const memory: { sid: string | null; cid: string | null; teased: boolean } = { sid: null, cid: null, teased: false };

/** undefined means storage threw (use memory); null means storage works and has no value. */
function read(store: Storage, key: string): string | null | undefined {
  try {
    return store.getItem(key);
  } catch {
    return undefined;
  }
}

function write(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    // fall back to memory only
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
