import { describe, expect, it } from "vitest";
import { toMinorUnits } from "@/lib/sales/money";

describe("toMinorUnits", () => {
  it.each([
    ["34.90", "EUR", 3490],
    ["34.9", "EUR", 3490],
    ["34", "EUR", 3400],
    ["1500", "JPY", 1500],
    ["0.00", "EUR", 0],
    ["12.345", "EUR", 1235],
    ["12.344", "EUR", 1234],
    ["0.999", "EUR", 100],
  ])("%s %s → %d", (total, currency, minor) => {
    expect(toMinorUnits(total, currency)).toBe(minor);
  });

  it.each([["abc", "EUR"], [null, "EUR"], ["-5", "EUR"], ["1e3", "EUR"], ["", "EUR"], ["10", "NOPE"]])(
    "%s %s → null",
    (total, currency) => {
      expect(toMinorUnits(total as string | null, currency)).toBeNull();
    },
  );
});
