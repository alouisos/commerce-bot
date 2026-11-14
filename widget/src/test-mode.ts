// The owner's test tab: the install page opens the shop with `#concierge-test=<key>`. The key is kept in
// this tab's sessionStorage for later pages and taken out of the address bar at once.
import { setTestKey } from "./session";

const PARAM = "concierge-test";

/** Stores a test key found in the address fragment and removes it from the URL, keeping the rest of the fragment. */
export function captureTestKey(win: Window, store: Storage): void {
  try {
    const hash = win.location.hash.replace(/^#/, "");
    if (!hash.includes(`${PARAM}=`)) return;
    const parts = hash.split("&");
    const mine = parts.find((p) => p.startsWith(`${PARAM}=`));
    if (!mine) return;
    const key = decodeURIComponent(mine.slice(PARAM.length + 1));
    if (key) setTestKey(store, key);
    const rest = parts.filter((p) => p !== mine).join("&");
    const { pathname, search } = win.location;
    win.history.replaceState(win.history.state, "", `${pathname}${search}${rest ? `#${rest}` : ""}`);
  } catch {
    // no usable location or history: test mode just doesn't start
  }
}
