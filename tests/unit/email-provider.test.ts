import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTestEnv } from "../test-env";

applyTestEnv();
delete process.env.RESEND_API_KEY;

import { EmailNotConfiguredError, createDomain, sendMail } from "@/lib/email/provider";

afterEach(() => vi.restoreAllMocks());

describe("email provider without a key", () => {
  it("sendMail logs and returns a null id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await sendMail({ from: "a@b.com", to: "c@d.com", subject: "Hi", text: "Body" })).toEqual({ id: null });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("to=c@d.com"));
  });

  it("domain calls throw EmailNotConfiguredError", async () => {
    await expect(createDomain("milianjo.com")).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it("in production, logs only where an unsent email would have gone, never its text", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await sendMail({ from: "a@b.com", to: "maria@example.com", subject: "Reset", text: "https://x/reset?token=SECRET" });
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("example.com");
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("maria@");
  });
});
