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
});
