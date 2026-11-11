import { describe, expect, it } from "vitest";
import { signItems } from "@/components/sign-stack-items";

describe("signItems", () => {
  it("flags the owner link only for owners", () => {
    expect(signItems("app", "/app", true).ownerLink).toBe(true);
    expect(signItems("app", "/app", false).ownerLink).toBe(false);
  });

  it("lights the current site section", () => {
    const r = signItems("app", "/app/sites/abc/leads", false);
    expect(r.label).toBe("This website");
    expect(r.groups.find((g) => g.current)?.label).toBe("Leads");
    expect(r.groups.filter((g) => g.current)).toHaveLength(1);
    expect(r.back).toEqual({ href: "/app", label: "All websites" });
  });

  it("lights Overview on the bare site path", () => {
    expect(signItems("app", "/app/sites/abc", false).groups.find((g) => g.current)?.label).toBe("Overview");
  });

  it("keeps the account area", () => {
    const r = signItems("app", "/app/usage", false);
    expect(r.label).toBe("Account");
    expect(r.groups.map((g) => [g.label, g.current])).toEqual([["Websites", false], ["Usage", true]]);
    expect(r.back).toBeNull();
  });

  it("keeps the owner area", () => {
    const r = signItems("owner", "/owner", true);
    expect(r.label).toBe("Owner");
    expect(r.groups).toEqual([{ href: "/owner", label: "Accounts", current: true }]);
    expect(r.back).toEqual({ href: "/app", label: "Admin app" });
    expect(r.ownerLink).toBe(false);
  });
});
