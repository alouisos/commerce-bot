import { describe, expect, it } from "vitest";
import { redactEmails } from "@/lib/privacy/redact";

describe("redactEmails", () => {
  it("replaces a plain address", () => {
    expect(redactEmails("Write to bob@x.com now")).toBe("Write to [email] now");
  });
  it("handles plus, dots and subdomains", () => {
    expect(redactEmails("first.last+tag@mail.example.co.uk")).toBe("[email]");
  });
  it("handles addresses inside punctuation", () => {
    expect(redactEmails("(bob@x.com), <a.b@c.org>; \"d@e.io\".")).toBe("([email]), <[email]>; \"[email]\".");
  });
  it("leaves text without addresses unchanged", () => {
    const t = "Ask @support about 5 @ 3pm, see example.com";
    expect(redactEmails(t)).toBe(t);
  });
});
