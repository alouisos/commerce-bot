import { expect, test } from "@playwright/test";
import { E2E_GREETING_EL } from "./seed";

const QUESTION = "Ποιο προϊόν για βαμμένα μαλλιά;";

test("widget: Greek greeting, panel, chat, restore", async ({ page }) => {
  await page.goto("/index.html");
  const root = page.locator("#concierge-root");
  await expect(root).toBeAttached();

  // Teaser shows the Greek greeting (document lang is el-GR) and dismisses on scroll.
  const teaser = page.locator("#concierge-root .teaser");
  await expect(teaser).toContainText(E2E_GREETING_EL, { timeout: 10_000 });
  await page.mouse.wheel(0, 600);
  await expect(teaser).toHaveCount(0);

  // The AI note isn't shown until the bot has answered.
  await page.locator("#concierge-root .launcher").click();
  const panel = page.locator("#concierge-root .panel");
  await expect(panel.locator(".disclosure")).toHaveCount(0);

  // Send a message and get the fake model's reply.
  const input = panel.getByLabel("Γράψτε την ερώτησή σας…");
  await input.fill(QUESTION);
  await input.press("Enter");
  await expect(panel.locator(".msg.bot").filter({ hasText: "Test reply about:" })).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator(".msg.visitor")).toContainText(QUESTION);
  // After the first reply, the Greek AI note sits under the message box.
  await expect(panel.locator(".disclosure")).toContainText("Η τεχνητή νοημοσύνη μπορεί να κάνει λάθη");

  // Reload: the conversation is restored.
  await page.reload();
  await page.locator("#concierge-root .launcher").click();
  const again = page.locator("#concierge-root .panel");
  await expect(again.locator(".msg.visitor")).toContainText(QUESTION);
  await expect(again.locator(".msg.bot").filter({ hasText: "Test reply about:" })).toBeVisible();
});

test("widget: host page CSS cannot change panel text size", async ({ page }) => {
  await page.goto("/hostile.html");
  await page.locator("#concierge-root .launcher").click({ timeout: 15_000 });
  const input = page.locator("#concierge-root .panel .composer textarea");
  await expect(input).toBeVisible();
  const size = await input.evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("16px");
});
