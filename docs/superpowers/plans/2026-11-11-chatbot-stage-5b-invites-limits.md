# Chatbot SaaS — Stage 5b (Invite-only accounts and admin-set limits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the platform owner adds customers.
- **Inviting:** from `/owner`, the platform owner invites someone by email, with an account name and a plan. The invitee sets a password through a single-use link. Public sign-up is closed.
- **Limits:** the platform owner can override any account's limits.
- **Enforcing:** at 80 % the owners are warned; at 100 % the bot keeps answering but stops new suggestions and new emails.

**Architecture:**
- **Invites:**
  - An invite creates the account straight away, so its plan and limits can be set before anyone joins.
  - It stores a hash of a random token and emails the link.
  - Accepting calls Better Auth's `signUpEmail` from a server action inside an `AsyncLocalStorage` "invite context". A `user.create.before` hook allows a new user only inside that context, so public sign-up requests are refused at the API, not just hidden in the UI.
- **Limits:** a per-account `limit_overrides` JSON merged over the plan's limits in `planStatus`, so every existing limit check honours it.
- **Usage:** one `usageLevels` function drives the banner, the 100 % gating and a daily notice job.

**Tech Stack:** unchanged: Next.js 16.4, Better Auth 1.7, Drizzle, pg-boss, Resend through `sendEmail`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-website-chatbot-saas-design.md`. This plan covers:
- §10, limits: warn at 80 %; at 100 % keep answering but stop new prompts and new emails;
- §10: "the platform owner can assign complimentary plans";
- §11: "accounts can only be created by the platform owner".

**Instead of Stripe:** the owner decided on 2026-11-11 to defer self-serve billing. `docs/superpowers/plans/2026-11-10-chatbot-stage-5b-billing.md` stays for later. Plans are now set by the platform owner, and billing happens outside the app.

**Not in this plan:**
- **Team members:** customers inviting their own admins (5c).
- **Stripe billing:** the deferred plan above.
- **Shopify sales.**

## Global Constraints

- **Sign-up is closed:**
  - `/sign-up` shows exactly: "Concierge is invite-only for now. Contact {CONTACT_EMAIL}." with a link to `/sign-in`.
  - `POST /api/auth/sign-up/email` without an invite context fails, and no user, account or session is created.
- **Who may invite:** only platform owners (`isPlatformOwner`), on `/owner`.
- **Invites:**
  - The token is 32 random bytes in base64url. Only its SHA-256 is stored, and it's valid for **7 days**. It's single use: accepted invites can't be used again.
  - The invitee's email comes from the invite, never from the form.
  - Inviting an email that already has a user → `ValidationError("This person already has an account.")`.
  - A second pending invite for the same email → `ValidationError("There's already a pending invite for this email. Resend it instead.")`.
- **Plans offered when inviting:**
  - Trial (14 days, as today), Starter, Growth, Pro and Complimentary.
  - `inactive` doesn't exist in this plan, because the billing plan is deferred.
- **Limit overrides:**
  - `{ websites?, conversationsPerMonth?, emailsPerMonth?, storageBytes?, aiCostCeilingMicros?, autoSendEmails?, removeBadge? }`.
  - Unset means the plan's value.
  - Numbers are integers ≥ 0, with these maxima: websites 100, conversations 1,000,000, emails 1,000,000, storage 50 GB, and AI ceiling 10,000 USD.
  - `planStatus` takes `{ plan, trialEndsAt, limitOverrides }`. `limitOverrides` is **required** in the parameter type, so the type checker finds every caller that selects only some account columns.
- **Limits at 100 %:** the same rules as for Stripe plans:
  - **The bot keeps answering**.
  - **No new suggestions:** the widget config says `proactivity: "off"`, and `offerPrompt` returns null.
  - **No new email offers or drafts:** the consent card is hidden and drafting is skipped.
  - Emails already approved still send, up to the email cap.
  - The 150 % conversation ceiling (fallback) is unchanged.
- **Warnings at 80 %:** conversations, emails and knowledge-base storage.
- **`CONTACT_EMAIL`:**
  - An optional env variable; by default the first of `PLATFORM_OWNER_EMAILS`, else omitted from the copy.
  - Used on `/sign-up`, in the banner and in the notices. Production sets `CONTACT_EMAIL=alex@manxmachina.com`.
- **Copy:** in English.

### Decided values

**Invite email** (`sendEmail`, from `EMAIL_FROM`):
- **Subject:** "You're invited to Concierge"
- **Body:** "You've been invited to set up {accountName} on Concierge. Create your password here (the link works for 7 days):\n\n{APP_URL}/invite/{token}"

**Invite page `/invite/[token]`:**
- **Valid:**
  - The heading "Set up your Concierge account" and the line "for {email}".
  - The fields "Your name" (1–80 characters) and "Password (at least 10 characters)".
  - The button "Create account". Afterwards the invitee is signed in and lands on `/app`.
- **Invalid, expired or used:** "This invite link has expired or was already used. Ask {CONTACT_EMAIL} for a new one."

**Owner UI:**
- **`/owner` gains an "Invite a customer" form:** Email, Account name, and Plan (a select of the five), with the button "Send invite".
- **A "Pending invites" table:** Email · Account · Plan · Sent · Expires, with "Resend" (a new token, the expiry reset to 7 days, the email sent again) and "Cancel". Cancel deletes the invite, and deletes its account if it has no members and no sites.
- **`/owner/accounts/[accountId]` gains a "Limits" form:**
  - **Numbers:** one input per number, empty for "plan default". The plan's value is the placeholder, for example "500 (plan)".
  - **Units:** storage in MB; the AI ceiling in USD per month.
  - **Switches:** "Automatic email sending" and "Remove Powered-by badge" as selects (Plan default / On / Off).
  - **Trial:** "Trial ends on" (a date input) when the plan is `trial`.
  - **The button:** "Save limits".

**Banner** (`QuotaBanner`). The texts are added in this order, after the existing fallback and ceiling texts:
- **At 100 %:** "You've reached this month's {conversations|emails}. Your bot keeps answering, but makes no new suggestions or emails until next month." Then " Contact {CONTACT_EMAIL} to raise your limit." when it's set.
- **At 80 %:**
  - "You've used {n} % of this month's {conversations|emails}."
  - "You've used {n} % of your knowledge-base storage."

**Notices** (table `account_notices`, unique `(account_id, period, kind)`, sent by the daily job `usage-notices` at 09:00 UTC):
- **Kinds:**
  - `conversations_80`, `conversations_100`, `emails_80`, `emails_100` and `storage_80`, with the period `YYYY-MM`;
  - `trial_ending` (3 days or fewer left) and `trial_ended`, with the period `trial`.
- **Recipients:**
  - Every owner of the account.
  - `conversations_100`, `emails_100` and `trial_ended` also go to every address in `PLATFORM_OWNER_EMAILS`, prefixed "[Concierge admin] ", so you can raise the limit.
- **Complimentary accounts:** only `storage_80`.
- **Subjects:**
  - `conversations_80`: "{account}: 80 % of this month's conversations used"
  - `conversations_100`: "{account}: this month's conversations are used up"
  - `emails_80`: "{account}: 80 % of this month's emails used"
  - `emails_100`: "{account}: this month's emails are used up"
  - `storage_80`: "{account}: 80 % of your knowledge-base storage used"
  - `trial_ending`: "Your Concierge trial ends in {n} days"
  - `trial_ended`: "Your Concierge trial has ended"
- **Bodies:** each is 1–2 sentences on what changes. At 100 %: "Your bot keeps answering visitors, but it won't make new suggestions or write new emails until next month." Then the contact line and `{APP_URL}/app/usage`.

## Review Focus

1. **Getting in without an invite:**
   - A direct `POST /api/auth/sign-up/email` is refused, and leaves no user, account or session.
   - A token for invite A can't create a user for B's email, or join B's account.
   - Replaying an accepted, expired or cancelled token does nothing.
   - The form can't change the email.

   *(tests in Task 3)*
2. **Who can invite or change limits:**
   - A customer (non-platform-owner), including an owner of an account, gets the 404 digest from every invite and limit action.
   - A platform owner whose email isn't verified is refused (the existing `isPlatformOwner` rule).

   *(tests in Tasks 1 and 2)*
3. **Overrides honoured everywhere:**
   - An override is seen by every limit check: adding a website, storage on upload, the conversation quota and ceiling, the AI ceiling, `emailsPerMonth` in `canSendEmail`, `autoSendEmails` in `effectiveEmailMode` and `updateEmailSettings`, and `removeBadge` in the widget config.
   - Clearing a field goes back to the plan value.

   *(tests in Task 1)*
4. **100 % behaviour:**
   - At 100 % of conversations: the chat still answers, there are no suggestions, no consent card and no new drafts, and approved emails still send.
   - At 100 % of emails: no drafts and no sends.
   - Below 100 % nothing changes.

   *(tests in Task 4)*
5. **Notice spam:**
   - Each threshold emails once per month per account, however often the job runs. The next month it can fire again.
   - A failing send for one account doesn't stop the others.

   *(tests in Task 5)*

---

### Task 1: Per-account limit overrides

**Files:**
- Modify:
  - `src/db/schema.ts` (`accounts.limitOverrides` jsonb, nullable; migration via `npm run db:generate -- --name limit_overrides`)
  - `src/lib/plans.ts`
  - every `planStatus` caller the type checker flags, which must select `limitOverrides` or pass the whole account row: `src/lib/site-settings.ts`, `src/lib/sites.ts`, `src/lib/kb/sources.ts`, `src/lib/usage/meter.ts`, `src/lib/widget/config.ts`, `src/lib/email/domain.ts`, and the settings and emails pages
  - `src/app/owner/actions.ts`, `src/app/owner/accounts/[accountId]/page.tsx`
- Create: `src/app/owner/accounts/[accountId]/limits-form.tsx`, `src/lib/limits.ts`
- Test: `tests/unit/plans.test.ts` (extend), `tests/integration/limit-overrides.test.ts`

**Interfaces:**
- **Produces:**
  - `type LimitOverrides = Partial<Pick<PlanLimits, "websites" | "conversationsPerMonth" | "emailsPerMonth" | "storageBytes" | "aiCostCeilingMicros" | "autoSendEmails" | "removeBadge">>`
  - `planStatus(account: { plan: PlanId; trialEndsAt: Date | null; limitOverrides: LimitOverrides | null }, now: Date)`: the limits are `{ ...PLAN_LIMITS[plan], ...overrides }`, ignoring keys that are undefined.
  - **In `src/lib/limits.ts`:**
    - `limitOverridesSchema` (zod, with the maxima from Global Constraints; storage is given in MB and stored in bytes; the AI ceiling is given in USD and stored in micros);
    - `parseLimitsForm(formData: FormData): LimitOverrides`, where empty means unset and the selects map "default" to unset, "on" to true and "off" to false; it throws `ValidationError` with the field's message;
    - `setAccountLimits(accountId: string, overrides: LimitOverrides): Promise<void>`;
    - `setTrialEnd(accountId: string, date: Date): Promise<void>`, only for `plan = 'trial'`, else `ValidationError`.
  - **Owner action:** `saveLimitsAction(accountId, _prev, formData): Promise<{ error?: string; saved?: boolean }>`, platform owner only (else `notFound()`).

- [ ] **Step 1: Write the failing tests.**
  - **Unit:**
    - `planStatus({ plan: "starter", trialEndsAt: null, limitOverrides: { conversationsPerMonth: 2000 } }, now).limits.conversationsPerMonth` → 2000, with other limits as Starter.
    - `null` → Starter's limits.
    - `{ autoSendEmails: true }` → true.
  - **Integration:**
    - A starter account with `{ websites: 2 }` can create a second site; without the override it gets `PlanLimitError`.
    - `{ conversationsPerMonth: 1000 }` → `getQuota().limit` is 1000, so 750 used is `ok`, not the starter `ceiling`.
    - `{ emailsPerMonth: 10 }` → `canSendEmail` is false at 10 sent.
    - `{ autoSendEmails: true }` on starter → `updateEmailSettings` accepts `automatic`, and `effectiveEmailMode` is `automatic`.
    - `{ removeBadge: true }` → the widget config has `showBadge: false`.
    - `{ storageBytes: 1 MB }` → an upload over 1 MB gets `PlanLimitError`.
    - `saveLimitsAction` from a platform owner stores 2000 conversations and 250 MB. Empty fields → `limitOverrides` becomes `{}`, and the plan values apply again.
    - `saveLimitsAction` from an account owner who isn't a platform owner → the 404 digest.
    - A negative number → `{ error }`.
    - The account page renders the form with "500 (plan)" as the conversations placeholder.
- [ ] **Step 2:** Run `npx vitest run tests/unit/plans.test.ts tests/integration/limit-overrides.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `npm run typecheck`, and fix every caller it flags by selecting `limitOverrides`.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(owner): per-account limit overrides`.

### Task 2: Invites from the owner console

**Files:**
- Create: `src/lib/invites.ts`, `src/app/owner/invite-form.tsx`
- Modify:
  - `src/db/schema.ts` (`account_invites`; migration `npm run db:generate -- --name account_invites`), `tests/helpers/db.ts`
  - `src/app/owner/actions.ts`, `src/app/owner/page.tsx`
  - `src/lib/env.ts` (`CONTACT_EMAIL`, optional), `src/lib/brand.ts` (`contactEmail(): string | null` = `env.CONTACT_EMAIL ?? env.PLATFORM_OWNER_EMAILS[0] ?? null`)
  - `tests/test-env.ts` (`CONTACT_EMAIL: "help@example.com"`)
- Test: `tests/integration/invites.test.ts`

**Interfaces:**
- **Produces, schema:** table `account_invites`:
  - `id` uuid pk; `account_id` → accounts, cascade; `email` text (lowercased);
  - `token_hash` text, unique; `expires_at` timestamp; `accepted_at` null; `accepted_user_id` text null; `created_at`.
- **Produces, `invites.ts`:**
  - `createInvite(input: { email: string; accountName: string; plan: "trial" | "starter" | "growth" | "pro" | "complimentary" }, now?: Date): Promise<{ inviteId: string; accountId: string }>`:
    - validates (email ≤ 320 characters, name 1–80 characters) and applies the duplicate rules;
    - creates the account, with `trialEndsAt` = now + 14 days for a trial, else null;
    - stores the token hash and emails the link.
  - `resendInvite(inviteId: string, now?): Promise<void>`: only for an unaccepted invite.
  - `cancelInvite(inviteId: string): Promise<void>`.
  - `listPendingInvites(): Promise<{ id; email; accountName; plan; createdAt; expiresAt }[]>`.
  - `findUsableInvite(token: string, now?): Promise<{ id: string; accountId: string; email: string } | null>`: matched by `sha256(token)`, unaccepted, and before `expires_at`.
  - `hashToken(token: string): string`.
- **Produces, owner actions** (platform owner only, else `notFound()`): `inviteAction(_prev, formData)`, `resendInviteAction(id)` and `cancelInviteAction(id)`.

- [ ] **Step 1: Write the failing tests** (with `sendEmail` mocked).
  - **Creating:** `createInvite({ email: " Eleni@Shop.gr ", accountName: "Eleni's shop", plan: "growth" })`:
    - creates an account on `growth` with `trialEndsAt` null, and an invite for `eleni@shop.gr` expiring in 7 days;
    - sends one email to `eleni@shop.gr` with the subject "You're invited to Concierge" and the `/invite/` link;
    - the stored `token_hash` is not the link's token, and `findUsableInvite(<token from the email>)` finds it.
  - **A trial invite** → `trialEndsAt` is 14 days out.
  - **Duplicates:** an email that has a user → the "already has an account" error. A second invite for the same pending email → the "pending invite" error.
  - **Resend:** gives a new token (the old one no longer found) and pushes the expiry back to 7 days.
  - **Cancel:** deletes the invite and its memberless, siteless account.
  - **Finding:** at 8 days → `findUsableInvite` is null.
  - **The actions:**
    - an account owner who isn't a platform owner → the 404 digest;
    - a platform owner → it works;
    - `/owner` lists the pending invite.
- [ ] **Step 2:** Run `npx vitest run tests/integration/invites.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, then `npx vitest run tests/integration/owner.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(owner): invite customers by email`.

### Task 3: Accepting an invite, and closing public sign-up

**Files:**
- Create:
  - `src/lib/invites-context.ts` (the AsyncLocalStorage), `src/lib/accept-invite.ts`
  - `src/app/invite/[token]/page.tsx`, `src/app/invite/[token]/actions.ts`, `src/app/invite/[token]/accept-form.tsx`
- Modify:
  - `src/lib/auth.ts` (the `user.create.before` and `after` hooks)
  - `src/app/(auth)/sign-up/page.tsx` (the invite-only message), `src/app/(auth)/sign-in/page.tsx` (drop the "Sign up" link)
  - `tests/integration/accounts.test.ts` (sign-up now needs an invite)
- Test: `tests/integration/accept-invite.test.ts`

**Interfaces:**
- **Produces, `invites-context.ts`:** `runWithInvite<T>(invite: { id: string; accountId: string; email: string }, fn: () => Promise<T>): Promise<T>` and `currentInvite(): { id; accountId; email } | null`.
- **Hooks in `auth.ts`:**
  - **`user.create.before(user, ctx)`:**
    - allow when `currentInvite()?.email === user.email.toLowerCase()`;
    - allow when `ctx === null` (server-side scripts with no request);
    - otherwise `return false`.
  - **`user.create.after(user)`:**
    - with a current invite: in one transaction, insert the owner membership for `invite.accountId` and set the invite's `accepted_at` and `accepted_user_id` (`where accepted_at is null`; if no row is updated, throw, so a race can't use one invite twice);
    - without one: the existing `createAccountForUser`.
- **Produces, `accept-invite.ts`:** `acceptInvite(token: string, input: { name: string; password: string }, headers?: Headers): Promise<{ ok: true } | { ok: false; error: string }>`:
  - `findUsableInvite`; if there's none → the invalid-link error;
  - validates the name (1–80 characters) and the password (≥ 10 characters);
  - `runWithInvite(invite, () => auth.api.signUpEmail({ body: { email: invite.email, password, name }, headers }))`.
- **The page action** calls `acceptInvite(token, …, await headers())`. On success it redirects to `/app`; `nextCookies` sets the session.

- [ ] **Step 1: Write the failing tests.**
  - **Public sign-up:** `auth.api.signUpEmail({ body: { email: "x@example.com", password: "long-enough-pass", name: "x" } })` with no invite context → rejects, and no `user`, `accounts` or `session` rows. The same holds through `POST /api/auth/sign-up/email` (the Next handler).
  - **Accepting:** `acceptInvite(token, { name: "Eleni", password: "password-12345" })`:
    - creates the user `eleni@shop.gr`, with one membership `owner` in the **invited** account and no new account;
    - the invite is marked accepted;
    - `getAccountForUser` returns the invited account with its plan.
  - **Replays:** the same token again → `{ ok: false }`, the invalid-link error. An expired token → the same.
  - **Tokens can't be mixed:** invites for A and B, and A's token used while the form also posts `email: "b@…"` → creates only A's user, in A's account (the email comes from the invite).
  - **Concurrent accepts:** two accepts of one token at once → one user, one membership.
  - **Pages:** `/sign-up` renders "Concierge is invite-only for now. Contact help@example.com." (the test env's `CONTACT_EMAIL`). `/invite/<bad>` renders the invalid text. `/invite/<good>` renders "for eleni@shop.gr".
  - **Update `accounts.test.ts`:** the sign-up hook test now accepts an invite, and the plain sign-up test expects refusal.
- [ ] **Step 2:** Run `npx vitest run tests/integration/accept-invite.test.ts tests/integration/accounts.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Read `node_modules/better-auth` docs or types for `databaseHooks.user.create.before` returning `false` and for `nextCookies` with `auth.api` calls in server actions.
- [ ] **Step 4:** Run it, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(auth): invite-only sign-up`.

### Task 4: Limits at 80 % and 100 %

**Files:**
- Create: `src/lib/usage/levels.ts`
- Modify:
  - `src/lib/widget/config.ts` (at full: `proactivity: "off"` and `emailCapture: false`)
  - `src/lib/prompts/offer.ts`
  - `src/lib/email/domain.ts` (`canDraftEmail`), `src/lib/email/schedule.ts` (drafting uses `canDraftEmail`), `src/lib/widget/subscribe.ts` (uses `canDraftEmail`)
  - `src/components/QuotaBanner.tsx`, `src/app/app/usage/page.tsx` (rows for emails and storage)
- Test: `tests/integration/limits.test.ts`

**Interfaces:**
- **Produces, `levels.ts`:**
  - `type Level = { used: number; limit: number; ratio: number; level: "ok" | "warning" | "full" }`, where `warning` is ≥ 0.8 and `full` is ≥ 1. A limit of 0 is `full`.
  - `usageLevels(account: Account, now?: Date): Promise<{ conversations: Level; emails: Level; storage: Level }>`, from `getMonthUsage` and the summed `kb_sources.bytes` of the account's sites, against `planStatus(account).limits`.
  - `atMonthlyLimit(account, now?): Promise<boolean>`: conversations or emails are `full`.
- **Produces, `domain.ts`:** `canDraftEmail(site, account, now?)` = `canSendEmail(...) && !(await atMonthlyLimit(account, now))`. Sending keeps using `canSendEmail`.
- **Banner and usage page:** the copy from Decided values, linking to `/app/usage`.

- [ ] **Step 1: Write the failing tests.**
  - **At 500 of 500 conversations** (starter, verified domain):
    - the widget config has `proactivity: "off"`, `emailCapture: false` and `mode: "ai"`;
    - `offerPrompt` → null with no model call;
    - `/api/widget/subscribe` → 403;
    - `emailTick` drafts nothing (`callModel` not called) but sends an already approved email.
  - **With the override `{ conversationsPerMonth: 1000 }`** at 500 → nothing is gated.
  - **At 1000 of 1000 emails:** no drafts and no sends.
  - **At 499 conversations:** unchanged.
  - **`usageLevels`:** 400 of 500 → `warning`; 500 → `full`; 85 MB of 100 MB of storage → `warning`.
  - **The banner** shows the 80 % storage text, and the 100 % conversations text with "Contact help@example.com to raise your limit."
- [ ] **Step 2:** Run `npx vitest run tests/integration/limits.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, then `npx vitest run tests/integration/widget-routes.test.ts tests/integration/prompt-routes.test.ts tests/integration/email-schedule.test.ts tests/integration/subscribe.test.ts tests/integration/usage-ui.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(limits): warn at 80 %; no new suggestions or emails at 100 %`.

### Task 5: Usage notices by email

**Files:**
- Create: `src/lib/usage/notices.ts`
- Modify:
  - `src/db/schema.ts` (`account_notices`; migration `npm run db:generate -- --name account_notices`), `tests/helpers/db.ts`
  - `src/lib/leads.ts` (export `ownerEmails`)
  - `src/lib/jobs.ts` (`JOBS.usageNotices = "usage-notices"`), `src/worker/handlers.ts`, `src/worker/index.ts` (schedule `0 9 * * *`)
- Test: `tests/integration/notices.test.ts`

**Interfaces:**
- **Produces:** `sendUsageNotices(now?: Date, opts?: { platformOwners?: string[] }): Promise<number>`, which returns the number of notices recorded. `platformOwners` defaults to `env.PLATFORM_OWNER_EMAILS`, and tests pass `["admin@example.com"]`.
- **For each account with at least one member:**
  - **Notices due:** the usage kinds from `usageLevels` (`warning` → `_80`; `full` → `_80` and `_100`), plus the trial kinds for `plan: "trial"`.
  - **Record, then send:** insert into `account_notices` with `onConflictDoNothing`, and email only when the row was inserted. Recording first means a crash loses a notice rather than repeating it.
  - **Errors:** a send error is logged and doesn't stop the rest.

- [ ] **Step 1: Write the failing tests** (with `sendEmail` mocked).
  - **The 80 % notice:** a starter account at 410 conversations → one `conversations_80` email per owner, with the subject from Decided values and a body containing `/app/usage`. A second run sends nothing.
  - **The 100 % notice:** at 500 → `conversations_100` to the owners **and** a "[Concierge admin] …" copy to `admin@example.com`. The 80 % notice isn't resent.
  - **Next month:** at 410 again → the 80 % notice is sent again.
  - **Overrides:** with `{ conversationsPerMonth: 1000 }` at 500 → nothing.
  - **Trial reminders:** a trial ending in 2 days → `trial_ending`, "ends in 2 days". Once ended → `trial_ended`, exactly once over three runs, with an admin copy.
  - **Complimentary:** at 9,000 conversations → nothing.
  - **Send failures:** a failing `sendEmail` for account A doesn't stop B's notice.
- [ ] **Step 2:** Run `npx vitest run tests/integration/notices.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full gate: `npm run lint && npm run typecheck && npm test && npm run widget:build`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(limits): usage and trial notices by email`.

### Hand-off: deploy

- [ ] Add `CONTACT_EMAIL=alex@manxmachina.com` to `/etc/concierge.env`, then run `./deploy/deploy.sh` (the migrations, and the new worker job).
- [ ] **Smoke test:**
  - `/sign-up` shows the invite-only message.
  - From `/owner`, invite a test address on Starter. Open the link, set a password, and land in the new account.
  - On that account's owner page, set the conversations to 1,000 and check that Usage shows 1,000.
  - Milian Jo is unchanged (complimentary).
