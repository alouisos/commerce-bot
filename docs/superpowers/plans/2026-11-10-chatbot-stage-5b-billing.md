# Chatbot SaaS — Stage 5b (Billing, trial and limits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can sign up, use the 14-day trial and pay through Stripe for Starter, Growth or Pro, monthly or yearly. Plan changes and cancellations come back through Stripe webhooks. Limits behave as the spec says: a warning at 80 %, and at 100 % no new suggestions and no new emails, while the bot keeps answering. The owners are told by email.

**Architecture:**
- **Prices:** they live in Stripe under fixed lookup keys (for example `concierge_growth_yearly`). The app never hard-codes an amount.
- **Paying:**
  - Owners pay through Stripe Checkout and manage their plan in Stripe's Customer Portal.
  - A signed webhook writes the account's plan and subscription state, once per event.
- **Limits:**
  - One `usageLevels(account)` function computes 80 % and 100 % per metric for the banner, the gating and the notices.
  - A daily job emails owners once per month per threshold, plus the trial reminders.

**Tech Stack:**
- Next.js 16.4, Drizzle, pg-boss.
- `stripe` **23.1.0**, the only new dependency (exact version, `npm i stripe@23.1.0`). Use the SDK's pinned API version.

**Spec:** `docs/superpowers/specs/2026-11-06-website-chatbot-saas-design.md`. This plan covers:
- §10 (plans, trial, yearly billing, limits and the 80 % / 100 % behaviour, complimentary plans);
- §8.4 (billing links to Stripe's customer portal);
- §11 stage 5 (Stripe plans, trial and limits).

**Not in this plan:**
- **Team members** (§8.4) and the per-plan admin limit: they get their own plan (5c). Until then every account has one owner.
- **Later:** Stripe Tax and VAT setup is the platform owner's Stripe configuration (the plan only turns on `tax_id_collection`); usage-based overage (spec: "No overage billing in v1"); Shopify sales.

## Global Constraints

- **Plans (spec §10):**

  | | Starter | Growth | Pro |
  |---|---|---|---|
  | Price | €29/mo | €79/mo | €199/mo |
  | Yearly | 2 months free (the yearly price is 10 × monthly, set in Stripe) | | |

  The limits stay exactly as in `src/lib/plans.ts`.
- **Lookup keys:** `concierge_{starter|growth|pro}_{monthly|yearly}`. Six prices, each with `lookup_key` set in Stripe.
- **Trial:** 14 days, no card, Growth features. That's the existing `accounts.ts`; this plan changes nothing about how a trial starts.
- **Limits at 100 % of the month's conversations or emails:**
  - The bot **keeps answering**.
  - **No new suggestions:** the widget config says `proactivity: "off"`, and `offerPrompt` returns null.
  - **No new email offers or drafts:** the consent card is hidden and drafting is skipped. Emails already approved still send, up to the email cap.
  - The 150 % conversation ceiling (fallback mode) is unchanged.
- **Warnings at 80 %:** conversations, emails and knowledge-base storage, in the app banner and by email to the owners.
- **Who pays:** only the account's owners (`memberships.role = 'owner'`) can start Checkout or open the Portal.
- **Complimentary:**
  - Accounts on `complimentary` never see Checkout, and webhooks never change their plan.
  - The platform owner's existing plan select stays as it is.
- **No Stripe key configured** (`STRIPE_SECRET_KEY` unset): the Billing page shows "Billing isn't set up on this server yet." and paid plans can't be bought. Everything else works.
- **Webhook:**
  - It verifies the signature (`STRIPE_WEBHOOK_SECRET`) on the raw body, and answers 400 on a bad signature.
  - Each event id is applied at most once (table `stripe_events`).
  - It answers 200 for event types it ignores.
- **Copy:** admin UI and the owner emails in English.

### Decided values

**New plan id `inactive`:** a paid subscription that ended (canceled, unpaid or incomplete_expired).
- `planStatus` treats it as `expired: true`, so the bot falls back as for a finished trial. Its limits are Starter's.
- The banner says "Your subscription has ended. Your bot is in fallback mode. Choose a plan in Billing."

**Subscription status → account:**
- `active` or `trialing` → `plan` from the price's lookup key, and `subscriptionStatus` stored.
- `past_due` → the plan is kept. The banner says "Your last payment failed. Update your card in Billing to keep your plan."
- `canceled`, `unpaid` or `incomplete_expired` → `plan: "inactive"`.
- `incomplete` → no change.
- An unknown lookup key → no plan change, with `console.error` (never guess a plan).

**Notices** (table `account_notices`, unique `(account_id, period, kind)`):
- **Kinds:**
  - `conversations_80`, `conversations_100`, `emails_80`, `emails_100` and `storage_80`, with the period `YYYY-MM` (storage uses the month too);
  - `trial_ending` (3 days or fewer left) and `trial_ended`, with the period `trial`.
- Sent by the daily `usage-notices` job (09:00 UTC) to every owner through `sendEmail`. The subjects:
  - `conversations_80`: "{account}: 80 % of this month's conversations used"
  - `conversations_100`: "{account}: this month's conversations are used up"
  - `emails_80`: "{account}: 80 % of this month's emails used"
  - `emails_100`: "{account}: this month's emails are used up"
  - `storage_80`: "{account}: 80 % of your knowledge-base storage used"
  - `trial_ending`: "Your Concierge trial ends in {n} days"
  - `trial_ended`: "Your Concierge trial has ended"
- Each body is one or two sentences explaining what changes (for example, at 100 %: "Your bot keeps answering visitors, but it won't make new suggestions or write new emails until next month or until you upgrade.") and the link `{APP_URL}/app/billing`.
- Complimentary accounts get only storage notices.

## Review Focus

1. **Webhook forgery and replays:**
   - An unsigned or wrongly signed POST changes nothing.
   - Replaying one event twice applies once.
   - An event for a subscription whose `metadata.accountId` doesn't match the stored customer's account changes nothing.
   - Events arriving out of order (an `updated` after `deleted`) never resurrect a canceled plan; use the subscription's own `status`, not the event order.

   *(tests in Task 3)*
2. **Who can spend money:**
   - A non-owner admin, a non-member, or a complimentary account can't start Checkout or open the Portal (404 or a message).
   - The success return URL alone never upgrades anyone; only the webhook does.

   *(tests in Tasks 2 and 3)*
3. **Lapsed accounts:**
   - Cancel → `inactive` → widget fallback, the banner, and Checkout available again.
   - A trial that ended gets exactly one `trial_ended` email.
   - A re-subscription with the same customer works and doesn't create a second customer.

   *(tests in Tasks 3 and 6)*
4. **100 % behaviour:**
   - At 100 % of conversations: the chat still answers, there are no suggestions, no consent card and no new drafts, and approved emails still send.
   - At 100 % of emails: no drafts and no sends.
   - Below 100 % nothing changes.

   *(tests in Task 5)*
5. **Notice spam:**
   - Each threshold emails once per month per account, even if the job runs many times or the account hovers around it.
   - The next month it can fire again.
   - Accounts with no owner email are skipped without failing the job.

   *(tests in Task 6)*

---

### Task 1: Stripe module, billing data model and the `inactive` plan

**Files:**
- Modify:
  - `package.json` (`stripe@23.1.0`)
  - `src/lib/env.ts` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional)
  - `src/db/schema.ts`; migration via `npm run db:generate -- --name billing`
  - `tests/helpers/db.ts`, `src/lib/plans.ts`
  - `src/app/owner/plan-select.tsx` (hide `inactive` from the owner's choices)

  The banner texts for `inactive` and `past_due` belong to Task 5. Until then an inactive account shows the existing "trial ended" banner.
- Create: `src/lib/billing/stripe.ts`
- Test: `tests/unit/plans.test.ts` (extend), `tests/unit/billing-keys.test.ts`

**Interfaces:**
- **Produces, schema:**
  - `accounts` gains:
    - `stripeCustomerId` text, unique and nullable;
    - `stripeSubscriptionId` text, nullable;
    - `subscriptionStatus` text, nullable;
    - `billingInterval` text `monthly | yearly`, nullable;
    - `currentPeriodEnd` timestamp, nullable;
    - `cancelAtPeriodEnd` bool, default false.
  - `accounts.plan` enum += `"inactive"`.
  - Table `stripe_events`: `id` text pk (the Stripe event id), `type` text, `created_at`.
  - Table `account_notices`: `id` uuid pk; `account_id` → accounts, cascade; `period` text; `kind` text; `created_at`; unique `(account_id, period, kind)`.
- **Produces, `plans.ts`:**
  - `PlanId` += `"inactive"`; `PLAN_LIMITS.inactive = { ...starter }`.
  - `planStatus` returns `expired: true` for `inactive`.
  - `PAID_PLANS = ["starter", "growth", "pro"] as const`; `type PaidPlan`; `type BillingInterval = "monthly" | "yearly"`.
- **Produces, `stripe.ts`:**
  - `lookupKey(plan: PaidPlan, interval: BillingInterval): string`, which returns `concierge_${plan}_${interval}`.
  - `planForLookupKey(key: string | null | undefined): { plan: PaidPlan; interval: BillingInterval } | null`.
  - `getStripe(): Stripe` throws `BillingNotConfiguredError("Billing isn't set up on this server yet.")` without a key.
  - `billingConfigured(): boolean`: true with a key, or while a test Stripe is set.
  - `setStripeForTests(s: Partial<StripeLike> | null)`, where `StripeLike` is the subset used: `customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create`, `prices.list` and `subscriptions.retrieve`. `webhooks.constructEvent` always uses the real SDK (it's local and needs no network).

- [ ] **Step 1: Write the failing tests.**
  - `planStatus({ plan: "inactive", trialEndsAt: null }, now)` → `expired: true`, with Starter's limits.
  - `lookupKey("growth","yearly")` → `"concierge_growth_yearly"`.
  - `planForLookupKey` round-trips all six keys. `"concierge_gold_monthly"`, `""` and `null` → null.
  - `billingConfigured()` is false in the test env, and `getStripe()` throws `BillingNotConfiguredError`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/plans.test.ts tests/unit/billing-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Check that the migration only adds the columns, the two tables and the new enum value. A text enum doesn't change SQL, so verify by hand.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): Stripe module, billing fields and the inactive plan`.

### Task 2: Prices, Checkout and the Customer Portal

**Files:**
- Create: `src/lib/billing/prices.ts`, `src/lib/billing/checkout.ts`
- Test: `tests/integration/billing-checkout.test.ts`

**Interfaces:**
- **Produces, `prices.ts`:**
  - `type PlanPrice = { plan: PaidPlan; interval: BillingInterval; priceId: string; amountMinor: number; currency: string }`
  - `listPlanPrices(): Promise<PlanPrice[]>`:
    - `prices.list({ lookup_keys: <all six>, active: true, limit: 10 })`;
    - cached in memory for 10 minutes;
    - prices without a known lookup key are ignored.
  - `clearPriceCache(): void` (for tests).
- **Produces, `checkout.ts`:**
  - `startCheckout(input: { accountId: string; userId: string; plan: PaidPlan; interval: BillingInterval }): Promise<{ url: string }>`:
    - throws `NotFoundError` unless the user is an owner of the account;
    - throws `ValidationError("Your account is on a complimentary plan.")` for complimentary;
    - throws `ValidationError("You already have a subscription. Change it in Manage billing.")` when `subscriptionStatus` is `active`, `trialing` or `past_due`;
    - creates the Stripe customer once (`email` = the owner's email, `metadata.accountId`) and stores `stripeCustomerId`; later calls reuse it;
    - the session: `mode: "subscription"`, `customer`, `line_items: [{ price: <the priceId for the lookup key>, quantity: 1 }]`, `client_reference_id: accountId`, `subscription_data: { metadata: { accountId } }`, `tax_id_collection: { enabled: true }`, `success_url: {APP_URL}/app/billing?checkout=success`, `cancel_url: {APP_URL}/app/billing`.
  - `openPortal(input: { accountId; userId }): Promise<{ url: string }>`: owner only, needs a `stripeCustomerId` (else `ValidationError("There's no billing account yet.")`), and uses `return_url: {APP_URL}/app/billing`.

- [ ] **Step 1: Write the failing tests** (with a fake Stripe via `setStripeForTests` that records calls).
  - **Prices:** `listPlanPrices` maps the six fake prices, drops an unknown lookup key, and calls Stripe once within 10 minutes.
  - **Checkout:**
    - An owner of a trial account → the customer is created with `metadata.accountId` and stored.
    - The session's `line_items[0].price` is the growth/yearly price id, with `subscription_data.metadata.accountId`, `client_reference_id` and the `success_url` above. It returns the session url.
    - A second `startCheckout` reuses the customer, so `customers.create` is called once.
  - **Refusals:**
    - An admin (not owner) → `NotFoundError`.
    - A complimentary account → the message, and no Stripe call.
    - An `active` subscription → the "already" message.
  - **Portal:** for the owner → the portal url with `return_url`. Without a customer → the message.
- [ ] **Step 2:** Run `npx vitest run tests/integration/billing-checkout.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): Stripe Checkout and Customer Portal`.

### Task 3: The Stripe webhook

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`, `src/lib/billing/webhook.ts`
- Test: `tests/integration/billing-webhook.test.ts`

**Interfaces:**
- **Produces:**
  - `applyStripeEvent(event: Stripe.Event): Promise<"applied" | "duplicate" | "ignored">`:
    - inserts `stripe_events` with `onConflictDoNothing`; a conflict → `duplicate`;
    - handles `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`; anything else → `ignored`.
  - **For subscription events:**
    - Find the account by `stripeCustomerId = sub.customer`.
    - Require that `sub.metadata.accountId`, when present, equals that account. Otherwise `console.error` and change nothing.
    - Skip complimentary accounts.
    - Then apply the status map in Decided values, setting `stripeSubscriptionId`, `subscriptionStatus`, `billingInterval`, `currentPeriodEnd` (from `sub.items.data[0].current_period_end ?? sub.current_period_end`, in seconds → Date), `cancelAtPeriodEnd` and `trialEndsAt: null` once paid.
  - **Out of order:** for `checkout.session.completed` and every subscription event, re-read the subscription with `subscriptions.retrieve(id)` and apply **that** state, so late or reordered events converge on Stripe's current truth.
  - **Route `POST /api/stripe/webhook`:**
    - The raw body comes from `await req.text()`; it uses `stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)`.
    - A bad or missing signature, or no secret configured → 400 `{ error: "Invalid signature" }`.
    - Otherwise it applies the event and answers 200 `{ received: true }`.
    - The route is public: the middleware matcher (`/app`, `/owner`) already excludes it, so check it isn't caught.

- [ ] **Step 1: Write the failing tests.** Events are built as JSON and signed with the real `Stripe.webhooks.generateTestHeaderString({ payload, secret })`. The fake `subscriptions.retrieve` returns the test's "current" subscription.
  - **Signatures:** no signature or a wrong secret → 400, and the account is unchanged.
  - **Checkout completed:** for the account's customer, with a retrieved `active` subscription on `concierge_growth_yearly` → `plan: "growth"`, `billingInterval: "yearly"`, `subscriptionStatus: "active"`, `trialEndsAt: null` and `currentPeriodEnd` set.
  - **Replays:** the same event id twice → the second is `duplicate`, and an update applied in between isn't overwritten.
  - **Plan changes:** an `updated` event to `concierge_pro_monthly` → `pro`. `past_due` → the plan is kept and the status stored.
  - **Cancellation:** `deleted` (retrieved `canceled`) → `inactive`. A later stale `updated` event whose retrieved subscription is still `canceled` → it stays `inactive`.
  - **Mismatches:** `metadata.accountId` of another account → no change. A complimentary account → no change.
  - **Unknowns:** a lookup key `concierge_gold_monthly` → no plan change. An event type `invoice.paid` → 200 and `ignored`.
- [ ] **Step 2:** Run `npx vitest run tests/integration/billing-webhook.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): Stripe webhook keeps the plan in sync`.

### Task 4: The Billing page

**Files:**
- Create:
  - `src/app/app/billing/page.tsx`, `src/app/app/billing/actions.ts`, `src/app/app/billing/plan-picker.tsx`
  - `src/lib/billing/usage-levels.ts`
- Modify: `src/app/app/layout.tsx` (nav: "Billing" after "Usage")
- Test: `tests/integration/billing-page.test.ts`

**Interfaces:**
- **Produces, `usage-levels.ts`:**
  - `type Level = { used: number; limit: number; ratio: number; level: "ok" | "warning" | "full" }`, where `warning` is ≥ 0.8 and `full` is ≥ 1.
  - `usageLevels(account: Account, now?: Date): Promise<{ conversations: Level; emails: Level; storage: Level; websites: { used: number; limit: number } }>`:
    - conversations and emails come from `getMonthUsage`;
    - storage is the account's summed `kb_sources.bytes`;
    - websites is the site count.
- **Produces, `actions.ts`:**
  - `checkoutAction(plan: PaidPlan, interval: BillingInterval): Promise<{ error?: string }>` calls `startCheckout` and then `redirect(url)`. It returns `{ error }` for `ValidationError` and `BillingNotConfiguredError`.
  - `portalAction(): Promise<{ error?: string }>`, the same with `openPortal`.
- **Page:**
  - **Header:** "Plan: {Growth (trial)|Starter|Growth|Pro|Complimentary|Ended}".
    - On a trial: "{n} days left in your trial" or "Your trial has ended".
    - On a paid plan: "Renews on {date}" or "Ends on {date}" when `cancelAtPeriodEnd`.
    - On `past_due`: the payment-failed text.
  - **Usage:** one row each for Conversations, Emails, Storage and Websites: "{used} of {limit}", with "(80 %+)" or "(limit reached)".
  - **Plan picker:** shown to owners when there's no active subscription and the plan isn't complimentary.
    - A Monthly / Yearly switch (the yearly price, plus "2 months free").
    - Three cards with the price from `listPlanPrices` (`money()`), the key limits from `PLAN_LIMITS`, and a "Choose {Plan}" button.
  - **"Manage billing"** (the portal): for owners with a `stripeCustomerId`.
  - **Not configured:** "Billing isn't set up on this server yet." in place of the picker.
  - **Return from Checkout:** `?checkout=success` shows "Thanks! Your plan updates in a moment." It never upgrades by itself.
  - **Complimentary:** "You're on a complimentary plan." and no buttons.
  - **Admins (non-owners):** read-only, with "Ask an account owner to change the plan."

- [ ] **Step 1: Write the failing tests** (with a fake Stripe and the prices from Task 2).
  - `usageLevels`: 400 of 500 conversations → `warning`; 500 → `full`; storage sums the bytes across the account's sites.
  - **Trial owner:** the picker shows €79.00 / month, and with yearly €790.00 / year and "2 months free".
  - `?checkout=success` on a trial account → the thanks text, and the plan is still `trial` in the DB.
  - A `cancelAtPeriodEnd` growth account → "Ends on". A complimentary account → its text and no "Choose" button. No Stripe key → the not-set-up text.
  - `checkoutAction` by a non-owner → the 404 digest.
- [ ] **Step 2:** Run `npx vitest run tests/integration/billing-page.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, then `npx vitest run tests/integration/usage-ui.test.ts tests/integration/owner.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): billing page with plans, usage and the portal`.

### Task 5: Limits at 80 % and 100 %

**Files:**
- Modify:
  - `src/lib/widget/config.ts` (`proactivity: "off"` and `emailCapture: false` at full)
  - `src/lib/prompts/offer.ts`
  - `src/lib/email/domain.ts` (`canDraftEmail`), `src/lib/email/schedule.ts` (drafting uses `canDraftEmail`)
  - `src/lib/widget/subscribe.ts` (uses `canDraftEmail`)
  - `src/components/QuotaBanner.tsx`
- Test: `tests/integration/limits.test.ts`

**Interfaces:**
- **Consumes:** `usageLevels` (Task 4).
- **Produces:**
  - `atMonthlyLimit(account: Account, now?: Date): Promise<boolean>`, which is true when conversations or emails are `full`. It lives in `src/lib/billing/usage-levels.ts`.
  - `canDraftEmail(site, account, now?): Promise<boolean>` = `canSendEmail(...) && !(await atMonthlyLimit(account, now))`. Sending keeps `canSendEmail`, so approved emails still go out until the email cap.
  - **The banner,** in this order, adding to the existing texts:
    - `inactive`: "Your subscription has ended. Your bot is in fallback mode. Choose a plan in Billing.";
    - `past_due`: "Your last payment failed. Update your card in Billing to keep your plan.";
    - at full: "You've reached this month's {conversations|emails}. Your bot keeps answering, but makes no new suggestions or emails until next month or until you upgrade.";
    - at 80 %: "You've used {n} % of this month's {conversations|emails}." and "You've used {n} % of your knowledge-base storage."
    - Every one of these links to `/app/billing`.

- [ ] **Step 1: Write the failing tests.**
  - **At 500 of 500 conversations** (starter, verified domain):
    - the widget config has `proactivity: "off"`, `emailCapture: false` and `mode: "ai"`;
    - `offerPrompt` → null with no model call;
    - `/api/widget/subscribe` → 403;
    - `emailTick` drafts nothing (`callModel` not called) but sends an already approved email.
  - **At 1000 of 1000 emails:** no drafts and no sends.
  - **At 499 conversations:** unchanged (`proactivity` as set, `emailCapture: true`).
  - **The banner:**
    - shows the 80 % storage text at 85 MB of 100 MB;
    - shows the `inactive` text for an inactive account;
    - shows the `past_due` text for `subscriptionStatus: "past_due"`;
    - each with a link to `/app/billing`.
- [ ] **Step 2:** Run `npx vitest run tests/integration/limits.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, then `npx vitest run tests/integration/widget-routes.test.ts tests/integration/prompt-routes.test.ts tests/integration/email-schedule.test.ts tests/integration/subscribe.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): limits at 80 % and 100 %`.

### Task 6: Owner notices and trial reminders

**Files:**
- Create: `src/lib/billing/notices.ts`
- Modify: `src/lib/jobs.ts` (`JOBS.usageNotices = "usage-notices"`), `src/worker/handlers.ts`, `src/worker/index.ts` (schedule `0 9 * * *`)
- Test: `tests/integration/notices.test.ts`

**Interfaces:**
- **Consumes:** `usageLevels`, `sendEmail`, and the owner emails (export the existing `ownerEmails(accountId)` from `src/lib/leads.ts` and reuse it).
- **Produces:**
  - `sendUsageNotices(now?: Date): Promise<number>`, which returns the number of notices sent.
  - **For each account:**
    - **Notices due:** the usage kinds from `usageLevels` (`warning` → `_80`, `full` → `_80` and `_100`), plus the trial kinds for `plan: "trial"`.
    - **Record, then send:** insert into `account_notices` with `onConflictDoNothing`, and email the owners only when the row was inserted. Recording first means a crash between insert and send loses a notice instead of repeating it.
    - **Who gets which:** complimentary and inactive accounts get only `storage_80`.
    - **Errors:** a send failure is logged and doesn't stop the other accounts.

- [ ] **Step 1: Write the failing tests** (with `sendEmail` mocked as in `leads.test.ts`).
  - **The 80 % notice:** a starter account at 410 conversations → one `conversations_80` email to each owner, with the subject from Decided values and a body containing `/app/billing`. A second run sends nothing.
  - **The 100 % notice:** at 500 → `conversations_100` too (the 80 % notice isn't resent).
  - **Next month:** at 410 again → the 80 % notice is sent again.
  - **Trial reminders:** a trial ending in 2 days → `trial_ending`, "ends in 2 days"; once ended → `trial_ended`, exactly once over three runs.
  - **Complimentary:** at 9,000 conversations → nothing.
  - **Send failures:** a failing `sendEmail` for account A doesn't stop B's notice.
- [ ] **Step 2:** Run `npx vitest run tests/integration/notices.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full gate: `npm run lint && npm run typecheck && npm test && npm run widget:build`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(billing): usage and trial notices for owners`.

### Hand-off: set up Stripe and deploy

- [ ] **In Stripe** (test mode first):
  - Create three products (Starter, Growth, Pro), each with a monthly and a yearly EUR price: 29 / 290, 79 / 790 and 199 / 1990. Set the lookup keys `concierge_{plan}_{monthly|yearly}`.
  - Customer Portal: allow switching between these prices, cancelling at period end, and updating the card.
- [ ] **Webhook endpoint:**
  - `https://bot.manxmachina.com/api/stripe/webhook` with the events `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`.
  - Copy its signing secret.
- [ ] **Server:** add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `/etc/concierge.env`, then run `./deploy/deploy.sh`.
- [ ] **Smoke test (test mode):** sign up a fresh account → Billing → Choose Growth (yearly) → pay with test card 4242… → the plan reads Growth after the webhook → Manage billing → cancel → at period end the plan is Ended. Milian Jo stays complimentary throughout.
