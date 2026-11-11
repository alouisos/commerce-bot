// Shared by every owner-facing AI text: addresses of visitors are removed in code, not left to a prompt.
const EMAIL = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}/g;

/** Replaces every email address in the text with "[email]". */
export function redactEmails(text: string): string {
  return text.replace(EMAIL, "[email]");
}
