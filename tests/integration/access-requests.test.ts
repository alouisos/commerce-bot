import { describe, expect, it, vi } from "vitest";
import { requestAccess, type SendFn } from "@/lib/access-requests";

const at = new Date("2026-11-11T09:00:00Z");

function recorder() {
  const send = vi.fn<SendFn>(async () => {});
  return send;
}

describe("invite requests from the sign-up page", () => {
  it("emails the request to alex@manxmachina.com", async () => {
    const send = recorder();
    const res = await requestAccess({ email: "  Eleni@Shop.GR ", ip: "1.1.1.1" }, send, at);
    expect(res).toEqual({ ok: true, email: "eleni@shop.gr" });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0];
    expect(msg.to).toBe("alex@manxmachina.com");
    expect(msg.subject).toBe("Concierge invite request: eleni@shop.gr");
    expect(msg.text).toContain("eleni@shop.gr asked for a Concierge account on 2026-11-11 09:00 UTC.");
    expect(msg.text).toContain("/owner");
  });

  it("rejects an invalid address without sending", async () => {
    const send = recorder();
    expect(await requestAccess({ email: "not-an-email", ip: "1.1.1.2" }, send, at)).toEqual({
      ok: false,
      error: "Enter a valid email address.",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("drops bots that fill the hidden field, while looking successful", async () => {
    const send = recorder();
    const res = await requestAccess({ email: "bot@spam.example", website: "http://spam", ip: "1.1.1.3" }, send, at);
    expect(res.ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("limits each IP to 5 requests an hour", async () => {
    const send = recorder();
    for (let i = 0; i < 5; i++) {
      expect((await requestAccess({ email: `p${i}@example.com`, ip: "2.2.2.2" }, send, at)).ok).toBe(true);
    }
    expect(await requestAccess({ email: "p5@example.com", ip: "2.2.2.2" }, send, at)).toEqual({
      ok: false,
      error: "Too many requests. Please try again later.",
    });
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("tells the visitor when the email couldn't be sent", async () => {
    const send = vi.fn<SendFn>(async () => {
      throw new Error("provider down");
    });
    const res = await requestAccess({ email: "maria@example.com", ip: "3.3.3.3" }, send, at);
    expect(res).toEqual({ ok: false, error: "We couldn't send your request just now. Please try again in a few minutes." });
  });
});
