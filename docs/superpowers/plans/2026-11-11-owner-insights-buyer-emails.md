# Owner controls, insights, email capture, icon and buyer emails: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven changes in the approved design: owner access and customer removal, a better websites list, markdown transcripts, the Concierge icon, windowed insights with a daily email and Ask the Concierge, email capture on every site, and post-purchase buyer emails.

**Architecture:** Each phase is shippable on its own (A → B → C → D). Server logic lives in `src/lib/**` with integration tests against Postgres (`tests/integration`, `npx vitest run`); pages are server components with server actions; background work is pg-boss jobs registered in `src/worker/handlers.ts` and scheduled in `src/worker/index.ts`; schema changes go in `src/db/schema.ts` plus a generated migration (`npm run db:generate`, files in `drizzle/`). Model calls take an injectable `callModel` so tests never hit the API.

**Tech Stack:** Next.js 16.4 (read `node_modules/next/dist/docs/` first), React 19, Drizzle + Postgres 17/pgvector, pg-boss, Resend, `@anthropic-ai/sdk`, Preact widget (`widget/`, tests via `vitest.widget.config.mts`), Tailwind v4 with the `.cx` design layer (`DESIGN.md`).

**Spec:** `docs/superpowers/specs/2026-11-11-owner-insights-buyer-emails-design.md`

## Global Constraints

- All existing tests keep passing; every task adds its own. Run the full suite (`npx vitest run`), `npm run typecheck`, `npx eslint src widget tests` before each commit.
- Admin UI uses existing classes only (`panel`, `panel-head`, `card`, `btn`, `btn-primary`, `btn-danger`, `btn-danger-quiet`, `badge*`, `lamp*`, `notice*`, `seg`, `table-wrap table-stack`); WCAG AA; no new colours outside `globals.css` tokens.
- Every new email: one-click unsubscribe (`List-Unsubscribe` + `List-Unsubscribe-Post` headers, as `renderEmail` does), respects `emailsPerMonth` via `countEmailSent`, never contains another visitor's address.
- Owner-facing AI (insights, Ask, buyer emails) is metered to the **owner budget** (Task 6), never to `aiCostMicros`, and never makes `aiBlocked` true.
- No AI-written text may contain a URL that isn't from the site's own hosts (`siteHosts` / `filterLinks` in `src/lib/email/writer.ts`).
- Rate-limit keys never hold a raw email address; hash it as `src/lib/widget/subscribe.ts` `emailKey` does.
- Commit after each task; messages end with the session's attribution lines.

## Review Focus

1. **A removed customer's widget key** must stop the bot at once (config 404) even while their old session cookie is still in a browser: sessions are deleted with the users. Test in Task 3.
2. **Buyer who unsubscribed from chat follow-ups, then buys:** gets no buyer email (shared suppression). Test in Task 13.
3. **Switching Buyer emails on for a shop with years of orders:** no past order is ever imported or emailed. Test in Task 12.
4. **Ask the Concierge with a question that mentions a visitor's email, or transcripts that contain addresses:** no email address reaches the model input or the answer. Test in Task 9.
5. **Insights page/email for a window with 0, 1, 2 and 3 conversations:** 0 → nothing generated and no email; 1–2 → 24-hour summary only; ≥3 → full insights. Test in Tasks 7 and 8.

---

## Phase A: small fixes (ship together)

### Task 1: Markdown in saved transcripts

**Files:**
- Create: `src/shared/markdown.ts`, `src/components/Markdown.tsx`
- Modify: `src/app/app/sites/[siteId]/conversations/[conversationId]/page.tsx` (bot messages only)
- Test: `tests/unit/markdown.test.ts`, `tests/integration/conversation-detail.test.ts` (add one case)

**Interfaces:**
- Produces: `type Inline = { t: "text"; v: string } | { t: "strong"; c: Inline[] } | { t: "link"; href: string; v: string }`; `type Block = { t: "p"; c: Inline[] } | { t: "ul" | "ol"; items: Inline[][] }`; `parseMarkdown(text: string): Block[]`; `<Markdown text={string} />`.

- [ ] **Step 1: Write failing tests** in `tests/unit/markdown.test.ts`: `parseMarkdown("**Hi** there")` → `[{t:"p",c:[{t:"strong",c:[{t:"text",v:"Hi"}]},{t:"text",v:" there"}]}]`; `"- a\n- b"` → one `ul` with 2 items; `"1. a\n2. b"` → `ol`; `"[shop](https://x.gr/p)"` → link; `"[x](javascript:alert(1))"` → text `"x"` only; `"<img src=x onerror=1>"` stays a text node; blank line splits paragraphs. Mirror the rules in `widget/src/render.ts` (same INLINE/UL/OL regexes, bold not nested).
- [ ] **Step 2: Run** `npx vitest run tests/unit/markdown.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `parseMarkdown` (pure, no DOM) and `Markdown` (React; links `target="_blank" rel="noopener noreferrer"`; class `prose-chat` with spacing for p/ul/ol added to `globals.css` components layer). In the transcript page render `m.role === "bot" ? <Markdown text={m.content}/> : <div className="whitespace-pre-wrap">{m.content}</div>`.
- [ ] **Step 4: Add integration assertion**: a bot message `"**Yes**"` renders `<strong>Yes</strong>`; the existing `&lt;img src=x onerror=alert(1)&gt;` assertion still passes.
- [ ] **Step 5: Run full checks, commit** `feat(conversations): render bot replies' formatting`.

### Task 2: Owner sign and readable selects

**Files:**
- Modify: `src/components/SignStack.tsx`, `src/app/app/layout.tsx`, `src/app/globals.css`
- Create: `src/components/sign-stack-items.ts`
- Test: `tests/unit/sign-stack-items.test.ts`

**Interfaces:**
- Produces: `signItems(area: "app"|"owner", path: string, isOwner: boolean): { label: string; groups: {href:string; label:string; current:boolean}[]; back: {href:string;label:string}|null; ownerLink: boolean }` (moves the item logic out of `SignStack` so it is testable); `SignStack` gains prop `isOwner?: boolean`.

- [ ] **Step 1: Failing tests:** `signItems("app","/app",true).ownerLink === true`; `signItems("app","/app",false).ownerLink === false`; `signItems("app","/app/sites/abc/leads",false).groups` has `Leads` current; owner area unchanged.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: extract logic; `SignStack` renders an extra `sign` "Owner" → `/owner` in the foot when `ownerLink`. `AppLayout` passes `isOwner={isPlatformOwner(user)}`. In `globals.css` base layer add `:where(.cx) option { background-color: var(--g1); color: var(--ink); }`.
- [ ] **Step 4: Verify** tests pass; screenshot `/owner` plan select open state is out of scope for automation; check `option` rule exists.
- [ ] **Step 5: Commit** `feat(owner): Owner sign for platform owners; readable select options`.

### Task 3: Remove and restore a customer

**Files:**
- Modify: `src/db/schema.ts` (`accounts.removedAt: timestamp("removed_at")`), `src/lib/sites.ts` (`getSiteByPublicKey`), `src/app/owner/page.tsx`, `src/app/owner/actions.ts`, `src/lib/invites.ts`
- Create: `src/lib/owner/accounts.ts`, `src/app/owner/remove-account-form.tsx`, migration via `npm run db:generate`
- Test: `tests/integration/owner-remove.test.ts`

**Interfaces:**
- Produces: `removeAccount(accountId: string, actingUserId: string, now?: Date): Promise<void>` (throws `ValidationError` when the acting user is a member of it); `restoreAccount(accountId: string, email: string, now?: Date): Promise<{ inviteId: string }>`; `createInviteForAccount(input: { accountId: string; email: string }, now?: Date): Promise<{ inviteId: string }>` in `src/lib/invites.ts` (same token/email flow as `createInvite`, existing account).

- [ ] **Step 1: Failing tests:** after `removeAccount`, the account's `user` rows (and their `session` rows, via cascade) are gone, `accounts.removedAt` is set, conversations/sites still exist, and `getSiteByPublicKey(site.publicKey)` returns `null`; removing the acting owner's own account throws "You can't remove your own account."; `restoreAccount` clears `removedAt`, `getSiteByPublicKey` works again, and an invite row exists for the given email with `accountId` of the restored account.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: column + migration; `getSiteByPublicKey` adds `isNull(accounts.removedAt)`; `removeAccount` deletes users found via `memberships` in one transaction (memberships cascade); `/owner` lists active accounts as today and a second panel "Removed" (name, removed date, Restore form with email field). Remove uses a `card-danger` inline form requiring the typed account name (`confirmName` must equal `account.name`), action `removeAccountAction(accountId, prev, formData)`.
- [ ] **Step 4: Run** tests + `tests/integration/owner*.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(owner): remove a customer (logins deleted, bot off) and restore`.

### Task 4: Websites list: whole row, Live status, Remove

**Files:**
- Modify: `src/app/app/page.tsx`, `src/app/app/actions.ts`, `src/app/globals.css`
- Create: `src/app/app/remove-site-form.tsx`, `src/lib/sites-status.ts`
- Test: `tests/unit/sites-status.test.ts`, `tests/integration/sites.test.ts` (add)

**Interfaces:**
- Produces: `LIVE_WINDOW_MS = 7 * 86_400_000`; `isLive(lastSeenAt: Date | null, now: Date): boolean`; `removeSiteAction(siteId: string, prev: {error?:string}, formData: FormData)` (requires `requireSiteAccess`, typed `confirmName` === site name, then `deleteSite`, `revalidatePath("/app")`).

- [ ] **Step 1: Failing tests:** `isLive(null, now) === false`; 6 days ago → true; 8 days ago → false. Integration: `removeSiteAction` with the wrong name returns `{ error: "Type the website's name exactly to delete it." }` and keeps the site; correct name deletes it; another account's site → 404.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: row = `.site-row` with a stretched `::after` on the name link (`.site-row{position:relative}` `.site-name::after{content:"";position:absolute;inset:0}`; buttons/forms inside get `position:relative; z-index:1`). Badge: `badge badge-ok` "Live" with `lamp lamp-ok`, or `badge` "Not detected" plus link "Install" → `/app/sites/{id}/install`. Remove: `btn-danger-quiet btn-sm` opens the inline typed-name form (same pattern as `DeletePersonForm`).
- [ ] **Step 4: Run** → PASS; existing `overview-page.test.ts` line `Last 30 days: 3 conversations · 1 email captured` still passes.
- [ ] **Step 5: Commit** `feat(websites): whole-row link, Live status, remove from the list`.

### Task 5: Concierge icon image

**Files:**
- Modify: `src/shared/widget-protocol.ts` (`WidgetConfig.iconUrl: string | null`), `src/lib/widget/config.ts`, `widget/src/ui/Launcher.tsx`, `widget/src/ui/App.tsx`, `widget/src/ui/Teaser.tsx` (call site passes `imageUrl={null}`), `widget/src/styles.css`, `src/app/app/sites/[siteId]/settings/greeting-image-form.tsx`
- Test: `widget/test/launcher.test.tsx` (new), `tests/integration/widget-routes.test.ts` (add)

**Interfaces:**
- Produces: `buildWidgetConfig` returns `iconUrl` = the current greeting image URL (same `greetingImageVersion` cache-busting) and `greeting.imageUrl: null`. `Launcher` prop `iconUrl: string | null`.

- [ ] **Step 1: Failing tests:** widget: `Launcher` with `iconUrl` renders `<img src=iconUrl alt="">` inside the button and no svg; without it renders the svg; button keeps `aria-label`. Route: config for a site with `greetingImageKey` has `iconUrl` ending `?v=<version>` and `greeting.imageUrl === null`.
- [ ] **Step 2: Run** `npx vitest run -c vitest.widget.config.mts` and the route test → FAIL.
- [ ] **Step 3: Implement**; CSS `.launcher img{width:100%;height:100%;border-radius:50%;object-fit:cover}`. Settings card heading "Concierge icon image", help text "Shown as the round chat button on your website. Square images work best." Rebuild widget (`npm run widget:build`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(widget): the uploaded image is the Concierge icon`.

## Phase B: insights, owner budget, daily email, Ask the Concierge

### Task 6: Owner AI budget

**Files:**
- Modify: `src/db/schema.ts` (`monthlyUsage.ownerAiCostMicros bigint default 0`; `usageEvents.kind` enum adds `"ask"`, `"buyer_email"`), `src/lib/usage/meter.ts`, `src/lib/plans.ts`, `src/app/app/usage/page.tsx`; migration
- Test: `tests/integration/meter.test.ts` (add), `tests/unit/plans.test.ts` (add)

**Interfaces:**
- Produces: `OWNER_KINDS = ["insights", "ask", "buyer_email"] as const`; `recordModelUsage` adds owner kinds' cost to `ownerAiCostMicros` instead of `aiCostMicros`; `PlanLimits.ownerAiCeilingMicros` (trial 2, starter 5, growth 15, pro 40 USD; complimentary = pro; overridable later, not in this plan); `ownerAiBlocked(account: Account, now?: Date): Promise<boolean>`; `getMonthUsage` also returns `ownerAiCostMicros`.

- [ ] **Step 1: Failing tests:** recording kind `"insights"` raises `ownerAiCostMicros` and leaves `aiCostMicros` 0, so `aiBlocked(getQuota(...))` stays false even past the visitor ceiling; kind `"chat"` still raises `aiCostMicros`; `ownerAiBlocked` true at `>= ownerAiCeilingMicros`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `generateSiteInsights` replaces its `aiBlocked` check with `ownerAiBlocked`. Usage page adds a line "Owner AI (insights, Ask the Concierge, buyer emails): $x of $y".
- [ ] **Step 4: Run** all tests → PASS (update `insights-generate.test.ts` expectations that relied on `aiBlocked`).
- [ ] **Step 5: Commit** `feat(usage): separate owner AI budget`.

### Task 7: Insights in three windows

**Files:**
- Modify: `src/db/schema.ts` (`siteInsights.window text enum ["24h","7d","30d"] notNull default "30d"`), `src/lib/insights/generate.ts`, `src/lib/insights/schedule.ts`, `src/lib/insights/prompt.ts`, `src/lib/jobs.ts` (`"generate-insights": { siteId: string; window: InsightWindow }`), `src/worker/handlers.ts`, `src/app/app/sites/[siteId]/overview/insights-section.tsx`, `.../overview/page.tsx`, `.../overview/refresh-button.tsx`, `.../overview/actions.ts`; migration
- Test: `tests/integration/insights-generate.test.ts`, `tests/integration/insights-jobs.test.ts`, `tests/integration/overview-page.test.ts`

**Interfaces:**
- Produces: `type InsightWindow = "24h" | "7d" | "30d"`; `WINDOW_MS: Record<InsightWindow, number>`; `MIN_CONVERSATIONS: Record<InsightWindow, number> = { "24h": 1, "7d": 3, "30d": 3 }`; `generateSiteInsights(siteId, { window, now?, callModel? })`; `latestInsight(siteId: string, window: InsightWindow)`; `dailyInsights` enqueues all three windows per active site; Overview reads `?insights=24h|7d|30d` (default `24h`).

- [ ] **Step 1: Failing tests:** with 2 conversations in the last day: `24h` → created with `window:"24h"`; `7d` → `{status:"skipped", reason:"too-few"}`; 0 conversations → `no-conversations`; `7d`/`30d` "up-to-date" check is per window; `24h` with fewer than 3 uses the short-summary instruction (assert the system prompt passed to `callModel` contains `"Summarise these few conversations"`); Overview with `?insights=7d` renders the 7d insight and the `seg` control with `aria-current` on "7 days"; window with no insight shows "Not enough conversations in this period".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (job singletonKey becomes `${siteId}:${window}`). Refresh regenerates the viewed window.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(insights): last 24 hours, 7 days and 30 days`.

### Task 8: Daily insights email

**Files:**
- Modify: `src/db/schema.ts` (`memberships.insightsEmail boolean notNull default true`, `memberships.insightsToken text unique` filled on create), `src/lib/jobs.ts` (`dailyInsightsEmail: "daily-insights-email"`), `src/worker/index.ts` (schedule `"0 6 * * *"`), `src/worker/handlers.ts`, `src/app/app/sites/[siteId]/overview/insights-section.tsx` (toggle); migration with backfill of tokens
- Create: `src/lib/insights/email.ts`, `src/app/e/i/[token]/route.ts` (one-click off) and `page.tsx`
- Test: `tests/integration/insights-email.test.ts`

**Interfaces:**
- Consumes: `latestInsight(siteId, "24h")` (Task 7), `sendEmail` (`src/lib/email.ts`), `escapeHtml`.
- Produces: `sendDailyInsightEmails(now?: Date, send?: (m:{to:string;subject:string;text:string}) => Promise<void>): Promise<number>`; `setInsightsEmail(userId: string, accountId: string, on: boolean): Promise<void>`.

- [ ] **Step 1: Failing tests:** site with a `24h` insight created in the last 24 h and two members (one opted out) → exactly 1 email, to the opted-in member, subject `"Milian Jo: what visitors asked in the last 24 hours"`, text contains the summary, each section, `"/app/sites/<id>/overview?insights=24h"`, `"/app/sites/<id>/ask"`, `"Written by AI from your conversations"` and the `/e/i/<token>` link; no insight in the last 24 h → 0 emails; removed account (`removedAt`) → 0; GET `/e/i/<token>` sets `insightsEmail=false`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; toggle on Overview's Insights panel: "Daily email: On/Off" button bound to `setInsightsEmailAction`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(insights): daily insights email to the shop's team`.

### Task 9: Ask the Concierge

**Files:**
- Create: `src/lib/ask/search.ts`, `src/lib/ask/answer.ts`, `src/app/app/sites/[siteId]/ask/page.tsx`, `.../ask/ask-chat.tsx` (client), `.../ask/actions.ts`
- Modify: `src/components/sign-stack-items.ts` (site section "Ask"), `.../overview/page.tsx` (button "Ask the Concierge" in the Insights panel head)
- Test: `tests/unit/ask-redact.test.ts`, `tests/integration/ask.test.ts`

**Interfaces:**
- Produces: `redactEmails(text: string): string` (replaces addresses with `[email]`); `findRelevantConversations(siteId: string, question: string, opts?: { now?: Date; limit?: number }): Promise<{ id: string; startedAt: Date; transcript: string }[]>` (last 90 days or retention if shorter; Postgres full-text `to_tsvector('simple', content) @@ plainto_tsquery('simple', q)` on messages ranked by `ts_rank`, falling back to the newest 40 conversations when nothing matches; default limit 40; transcripts redacted); `answerQuestion(input: { siteId: string; userId: string; question: string; history: {role:"user"|"assistant";content:string}[] }, opts?: { callModel?: AskCallModel; now?: Date }): Promise<{ answer: string; sources: { id: string; startedAt: Date }[] } | { error: string }>`; `askAction(siteId: string, prev: AskState, formData: FormData)`.

- [ ] **Step 1: Failing tests:** `redactEmails("mail eleni@shop.gr now")` → `"mail [email] now"`; search for "butter" returns the conversation mentioning "Hair Therapy Butter" first and excludes other sites' conversations and conversations older than 90 days; the model input never contains `@` addresses from transcripts or the question; the answer is redacted too; citations like `[c2]` in the model output map to `sources` with real conversation ids (unknown labels dropped); `ownerAiBlocked` → `{ error: "Ask the Concierge is paused until next month: this month's owner AI budget is used up." }`; 21st question in an hour by the same user → `{ error: "Too many questions. Try again in a few minutes." }`; usage recorded with kind `"ask"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: model = `env.CHAT_MODEL` via `getAnthropic()`; system prompt: answer only from the transcripts, say when they don't contain the answer, cite as `[c<n>]`, never reveal personal data; page shows the thread (client state only), answers rendered with `<Markdown>` (Task 1), sources as links to `/app/sites/<id>/conversations/<cid>`, "Written by AI from your conversations; check before acting on it."
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(ask): Ask the Concierge about your conversations`.

## Phase C: email capture on every site

### Task 10: Offer email capture without a verified domain

> **Superseded in part (decided 2026-11-11, replaces the earlier choice):** the bot asks for emails only after the shop verifies its own sending domain. Task 10 kept the per-site `emailAsk` switch and the hashed access-request rate-limit key; Task 10b removed the platform-address confirmation (`confirmationFrom`) and the verification-time `startWaitingSequences`, and `canOfferEmail` = `emailAsk` AND `canDraftEmail`.

**Files:**
- Modify: `src/lib/email/domain.ts`, `src/lib/widget/config.ts`, `src/lib/widget/subscribe.ts`, `src/lib/email/contacts.ts` (`sendConfirmation`), `src/lib/email/domain.ts` (`refreshSendingDomain` on transition to verified), `src/db/schema.ts` (`sites.emailAsk boolean notNull default true`), `src/app/app/sites/[siteId]/settings/email-settings-form.tsx` + `actions.ts`, `src/lib/access-requests.ts` (hash email in rate-limit key); migration
- Test: `tests/integration/subscribe.test.ts`, `tests/integration/sending-domain.test.ts`, `tests/integration/widget-routes.test.ts`

**Interfaces:**
- Produces: `canOfferEmail(site: Pick<Site,"emailAsk">, account: Account, now?: Date): Promise<boolean>` (plan active, emails and conversations left; no domain requirement; false when `site.emailAsk` is false); `confirmationFrom(site): string` = `fromAddress(site)` when verified, else `"${site.name} via Concierge" <address part of env.EMAIL_FROM>`.

- [ ] **Step 1: Failing tests:** unverified site: config `emailCapture === true`; `/api/widget/subscribe` accepts and the confirmation is sent `from` `"Milian Jo via Concierge" <…EMAIL_FROM address…>`; no follow-up is drafted by `emailTick` while unverified; when `refreshSendingDomain` flips to verified, subscribed contacts with no sent email get `sequenceStartedAt = now` (so only step 1 becomes due); `emailAsk=false` → `emailCapture === false` and subscribe 403; access-request rate-limit key contains no `@`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `canDraftEmail` (drafting) unchanged. Settings email card gets checkbox "Ask visitors for their email during a chat" (`emailAsk`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(email): ask for emails on every site, confirm from Concierge until the domain is verified`.

### Task 11: When the widget asks

**Files:**
- Modify: `widget/src/ui/App.tsx` (trigger), `widget/src/visit.ts` consumer if needed
- Test: `widget/test/app.test.tsx` (add cases)

**Interfaces:**
- Produces: `consentReplies(intent: "learning"|"exploring"|"buying"|null): number` = 2 when `"buying"`, else 3, exported from `widget/src/ui/App.tsx` or a small `widget/src/consent-timing.ts`.

- [ ] **Step 1: Failing tests:** card not shown after 2 bot replies with intent exploring; shown after 3; shown after 2 with intent buying; never shown again after dismiss in the same session; not shown when a fallback form is visible.
- [ ] **Step 2: Run** widget tests → FAIL. **Step 3: Implement** (intent from the visit tracker summary when tracking is allowed, else `null`). **Step 4: Run** → PASS; `npm run widget:build`. **Step 5: Commit** `feat(widget): offer email follow-up after the 3rd reply (2nd when buying)`.

## Phase D: buyer emails

### Task 12: Buyers data, order poller

**Files:**
- Modify: `src/db/schema.ts`, `src/lib/sales/woocommerce.ts`, `src/lib/jobs.ts` (`pollOrders: "poll-orders"`), `src/worker/index.ts` (`"*/30 * * * *"`), `src/worker/handlers.ts`; migration
- Create: `src/lib/buyers/poll.ts`
- Test: `tests/integration/buyers-poll.test.ts`, `tests/unit/woocommerce-orders.test.ts`

**Interfaces:**
- Schema: `sites.buyerEmails text enum ["off","approval","automatic"] default "off"`, `sites.buyerEmailsSince timestamp` (set when switched on), `sites.ordersPolledAt timestamp`; `buyers(id, siteId, email lowercased, firstName, status enum ["subscribed","unsubscribed"], token unique, ref unique, createdAt; unique(siteId,email))`; `buyerOrders(id, siteId, buyerId, externalId, orderedAt, items jsonb {productId:number;name:string;url:string|null}[], unique(siteId, externalId))`.
- Produces: `WooOrder` gains `firstName: string | null` and `items: { productId: number; name: string }[]`; `listOrdersSince(creds: WooCredentials, after: Date): Promise<WooOrder[]>` (`/orders?after=<iso>&status=processing,completed&per_page=50`, paged up to 10 pages); `productUrls(creds, ids: number[]): Promise<Map<number,string>>` (`/products?include=…`, `permalink`); `pollOrders(now?: Date, opts?: { list?: typeof listOrdersSince; urls?: typeof productUrls }): Promise<number>`.

- [ ] **Step 1: Failing tests:** `asOrder` parses `billing.first_name` and `line_items`; site with `buyerEmails:"off"` is never polled; switching on sets `buyerEmailsSince` and the first poll asks for orders after `buyerEmailsSince` (not earlier), so a shop's older orders are never imported; a repeated order id is not duplicated; `ordersPolledAt` advances; a failing store marks the connection failing (reuse `markConnectionFailing`) and polls again next time.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(buyers): collect buyers from new WooCommerce orders`.

### Task 13: Buyer email sequence and sending

**Files:**
- Modify: `src/db/schema.ts` (`buyerEmails` table: like `emailMessages` but `buyerId`, `orderId`, `step 1|2`, `feedbackToken unique`; one-open-per-buyer unique index), `src/lib/email/schedule.ts` (`emailTick` also runs buyer drafting/sending), `src/lib/email/admin.ts` (`deletePerson` also deletes the buyer), `src/lib/sales/verify.ts` (no change in attribution); migration
- Create: `src/lib/buyers/sequence.ts`, `src/lib/buyers/writer.ts`, `src/lib/buyers/suppression.ts`
- Test: `tests/integration/buyers-sequence.test.ts`, `tests/integration/buyers-writer.test.ts`

**Interfaces:**
- Produces: `STEP_DELAY_DAYS = { 1: 5, 2: 14 }`; `MIN_GAP_DAYS = 7`; `isSuppressed(siteId: string, email: string): Promise<boolean>` (buyer unsubscribed OR chat contact unsubscribed); `scheduleForOrder(orderId: string, now?: Date)` (called by `pollOrders` for each new order; replaces the buyer's open sequence); `draftDueBuyerEmails(now, callModel?)`, `sendApprovedBuyerEmails(now, intervalMs)`; `writeBuyerEmail(input: { site; buyer; order; step: 1|2 }, opts?: { callModel?: CallModel; now?: Date }): Promise<{ subject: string; body: string; links: string[] } | null>`.

- [ ] **Step 1: Failing tests:** order on day 0 → step 1 due day 5, step 2 day 14; suppressed buyer (chat contact unsubscribed) → nothing drafted; a chat email sent to the same address 3 days ago pushes the buyer email to day 7 after it (shared 7-day gap, both directions); `approval` mode → drafts wait in `draft`; `automatic` (only when `planStatus(...).limits.autoSendEmails`) → approved; unverified domain or no Woo connection → nothing drafted; writer links outside the site hosts are dropped; usage kind `"buyer_email"`; every sent email has the buyer unsubscribe header and a feedback link `/e/f/<feedbackToken>`; `deletePerson` removes the buyer and its orders/emails.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: writer system prompt per step: step 1 = how to get the most from the product (from KB via `searchKnowledge` on the product name), any questions, up to 2 related articles; step 2 = how do you like it, leave feedback (link), up to 2 related products from the site's crawled product pages. Language = site default language. Reuse `filterLinks`, `renderEmail`, `countEmailSent`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(buyers): two follow-up emails per order`.

### Task 14: Buyer unsubscribe and feedback pages

**Files:**
- Create: `src/db/schema.ts` table `buyerFeedback(id, siteId, buyerEmailId, rating int 1–5, comment text ≤2000, createdAt)`, `src/app/e/b/[token]/page.tsx` + `one-click/route.ts` (unsubscribe), `src/app/e/f/[token]/page.tsx` + `actions.ts` (feedback form), `src/lib/buyers/feedback.ts`; migration
- Test: `tests/integration/buyers-feedback.test.ts`

**Interfaces:**
- Produces: `unsubscribeBuyer(token: string, now?: Date)`; `submitFeedback(token: string, input: { rating: number; comment: string }): Promise<{ ok: true } | { error: string }>`.

- [ ] **Step 1: Failing tests:** one-click POST unsubscribes and cancels open buyer emails; feedback rating outside 1–5 → error "Choose a rating from 1 to 5."; second submission for the same email updates rather than duplicates; unknown token → 404 page.
- [ ] **Step 2–5:** run → FAIL, implement (neutral visitor-facing styling like the existing `/e/*` pages, not `.cx`), run → PASS, commit `feat(buyers): unsubscribe and product feedback pages`.

### Task 15: Buyer emails settings and Buyers tab

**Files:**
- Create: `src/app/app/sites/[siteId]/buyers/page.tsx`, `src/app/app/sites/[siteId]/settings/buyer-emails-form.tsx`, `src/lib/buyers/admin.ts`
- Modify: `src/app/app/sites/[siteId]/settings/page.tsx` + `actions.ts`, `src/components/sign-stack-items.ts` (section "Buyers" after "Emails")
- Test: `tests/integration/buyers-admin.test.ts`

**Interfaces:**
- Produces: `setBuyerEmails(siteId: string, mode: "off"|"approval"|"automatic", now?: Date)` (requires verified domain and a Woo connection for non-off; `automatic` needs `autoSendEmails`; sets `buyerEmailsSince` only when turning on from off); `listBuyers(siteId)`, `listBuyerQueue(siteId)`, `listFeedback(siteId)`; approve/discard reuse the `DraftEditor` pattern.

- [ ] **Step 1: Failing tests:** turning on without a verified domain → error "Verify your sending domain first."; without Woo → "Connect WooCommerce first."; on→off→on resets `buyerEmailsSince` to the latest switch-on; Buyers page lists buyers with order count, products, sequence status, feedback with rating; another account → 404.
- [ ] **Step 2–5:** run → FAIL, implement (Settings card copy includes: "Emails every customer who buys, about the products they bought. It's your responsibility that customers were offered an opt-out at checkout; every email includes one-click unsubscribe."), run → PASS, commit `feat(buyers): settings and Buyers tab`.

### Task 16: Whole-branch verification

- [ ] **Step 1:** `npx vitest run` (all pass), `npx vitest run -c vitest.widget.config.mts`, `npm run typecheck`, `npx eslint src widget tests`, `npm run build`.
- [ ] **Step 2:** seed `concierge_ui` (`DATABASE_URL=…/concierge_ui npx drizzle-kit migrate`) and capture `/app`, overview (3 windows), ask, conversation, settings, buyers, `/owner` at 1440 and 390; zero horizontal overflow.
- [ ] **Step 3:** Commit; push `ui/cyberpunk`. Deployment is a separate decision for the user, per phase.
