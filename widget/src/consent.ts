// The host page's cookie-consent tool, if any: Complianz, Cookiebot or CookieYes.
// Preference (or marketing) consent allows behaviour tracking; the chat itself never waits for it.

export type ConsentTool = "complianz" | "cookiebot" | "cookieyes";

type ConsentWin = Window & {
  cmplz_has_consent?: (category: string) => boolean;
  Cookiebot?: { consent?: { preferences?: boolean; marketing?: boolean } };
  getCkyConsent?: () => { categories?: { functional?: boolean; advertisement?: boolean } };
};

function safe(fn: () => boolean): boolean {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}

export function detectConsent(win: Window): { tool: ConsentTool | null; granted: boolean } {
  const w = win as ConsentWin;
  const doc = win.document;
  if (typeof w.cmplz_has_consent === "function") {
    const has = w.cmplz_has_consent;
    return { tool: "complianz", granted: safe(() => has("preferences")) || safe(() => has("marketing")) };
  }
  // Complianz marks the body before its script defines cmplz_has_consent; its cookies hold the choice.
  if (doc?.body?.hasAttribute("data-cmplz")) {
    const granted = safe(() => /(?:^|;\s*)cmplz_(?:preferences|marketing)=allow(?:;|$)/.test(doc.cookie));
    return { tool: "complianz", granted };
  }
  if (w.Cookiebot?.consent) {
    const c = w.Cookiebot.consent;
    return { tool: "cookiebot", granted: c.preferences === true || c.marketing === true };
  }
  if (typeof w.getCkyConsent === "function") {
    const get = w.getCkyConsent;
    return {
      tool: "cookieyes",
      granted: safe(() => get().categories?.functional === true) || safe(() => get().categories?.advertisement === true),
    };
  }
  return { tool: null, granted: false };
}

/** Calls `cb` whenever a consent tool reports a change. Returns a function that stops listening. */
export function onConsentChange(win: Window, cb: () => void): () => void {
  const doc = win.document;
  doc.addEventListener("cmplz_status_change", cb);
  doc.addEventListener("cmplz_enable_category", cb);
  win.addEventListener("CookiebotOnAccept", cb);
  win.addEventListener("CookiebotOnDecline", cb);
  doc.addEventListener("cookieyes_consent_update", cb);
  return () => {
    doc.removeEventListener("cmplz_status_change", cb);
    doc.removeEventListener("cmplz_enable_category", cb);
    win.removeEventListener("CookiebotOnAccept", cb);
    win.removeEventListener("CookiebotOnDecline", cb);
    doc.removeEventListener("cookieyes_consent_update", cb);
  };
}
