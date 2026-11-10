# Chatbot SaaS — Stage 5a (Sales tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- The shop sees how many sales came from the bot, and how much they were worth: sales after a chat, after a tapped suggestion, or after a click in one of the bot's emails.
- A person's email series stops when they buy.

**Architecture:**
- **Seeing a purchase:** when the widget is on an order-confirmation page, it sends one beacon with the visit id (`sid`), the email ref (`cc_ref`) if any, and, on WooCommerce, the order id and order key from the URL.
- **Recording it:**
  - The server works out the same-visit attribution: a chat with at least one visitor message, or a tapped suggestion.
  - **Connected WooCommerce site:** a job fetches the order through the shop's REST API with the pasted key. It checks the order key and status, reads the amount and the billing email, and adds email attribution.
  - **Any other site:** the sale is stored unverified, without an amount.
  - Only attributed sales are stored, and the billing email is never stored.
- **Shown:** on the dashboard, on conversations and on sent emails.

**Tech Stack:** unchanged: Next.js 16.4, Drizzle, pg-boss, Preact widget, Node `crypto` (AES-256-GCM, HKDF). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-website-chatbot-saas-design.md`. This plan covers:
- §9 (sales tracking): WooCommerce, other platforms, attribution;
- §6 (the series stops when they buy);
- §8.1 (sales from conversations: count and revenue);
- §8.2 (whether a sale followed);
- §8.4 (the WooCommerce connection).

**Not in this plan:**
- **Stage 5b (next plan):** Stripe plans, the trial, the 80 % warnings and the 100 % limits for prompts and emails.
- **Shopify:** its checkout thank-you page doesn't run theme scripts, so the beacon can't work there. It needs order polling with a cart-attribute match, and gets its own plan when a Shopify customer arrives.
- **Later:** refunds after the sale is recorded; a one-click WordPress plugin.

## Global Constraints

- **Anti-goals (spec §2):**
  - Tracking is never visible to the visitor and never slows the order page.
  - Every unclear case means *no sale recorded*, never a guessed one.
- **Attribution (spec §9):** a sale counts as from the bot if any of these holds, and the rest are not stored:
  - **chat:** during the same visit (`sid`), the visitor sent at least 1 message in a conversation created before the order was seen;
  - **prompt:** during the same visit, they tapped a suggestion (`prompt_impressions.outcome = 'tapped'`);
  - **email:** a contact of this site, found by the visit's `cc_ref` or by the order's billing email (WooCommerce only), clicked one of their emails (`email_messages.last_clicked_at`) within **30 days** before the order.
- **Privacy:**
  - **Needs tracking consent:** the beacon is sent only when behaviour tracking is allowed (stage 4 `mayTrack`).
  - **Nothing extra is stored:** unattributed orders aren't stored at all, and the billing email is used for matching and then discarded.
  - **Retention:** sales go at the site's retention age, like conversations.
- **Credentials:**
  - **At rest:** the WooCommerce consumer secret is stored encrypted (AES-256-GCM, key from HKDF over `BETTER_AUTH_SECRET`, info `"store-credentials"`).
  - **Never shown or logged:** it's never sent to the browser or written to logs. The admin sees only the last 4 characters of the key.
  - **Where it can be sent:** only to `https://` store URLs whose host is the site's `baseUrl` host or an `allowedOrigins` host and passes the crawler's private-address check. Redirects are never followed with credentials.
- **WooCommerce order statuses counted:** `processing`, `completed` and `on-hold`.
  - A `pending` order is checked again after 30, 60 and 120 minutes, then dropped.
  - Every other status is dropped.
- **Money:**
  - Amounts are stored as integer minor units (`amount_minor`), with the ISO currency.
  - Decimals come from `Intl.NumberFormat(…, { style: "currency", currency }).resolvedOptions().maximumFractionDigits`.
  - Totals are parsed from the string, never via floats.
  - Revenue is shown per currency.
- **Copy:** admin UI in English.

### Decided values

**Order-confirmation detection (widget), `detectOrderConfirmation(doc, win)`:**
- **WooCommerce:** the path matches `/\/order-received\/(\d+)\/?$/` or the body has the class `woocommerce-order-received`.
  - Order id: from the path.
  - Order key: from `?key=` when it matches `/^wc_order_[A-Za-z0-9]{6,40}$/`.
- **Generic:** the path matches `/(order-confirmation|thank-?you|thank_you|checkout\/(onepage\/)?success)(\/|$)/i` **and** an `h1` or `h2` text matches `/order|παραγγελ|commande|bestellung|pedido|ordine/i`.
  - Order id: none.
- **Once per page:** keyed on `origin + pathname` in sessionStorage (`concierge.orders`, up to 20 entries), so a reload doesn't send it again.

**Beacon `POST /api/widget/order`:**
- **Body:** `{ key, sid, url, orderId: string | null, orderKey: string | null, ref: string | null }`.
- **Rate limits:** `order:sid` 5 per 3600 s, `order:ip` 60 per 3600 s.
- **Reply:** always 204 when the request is well formed (attributed or not), and 400 when it isn't.

**Sequence stop:** any sale attributed to a contact (by ref or billing email) calls `stopSequence(contactId)`:
- `sequence_conversation_id = null`;
- unsent drafts and approved emails are `discarded`.

A later chat after an email click still restarts the sequence (stage 4 `restartAfterClick`). "Buys what was recommended" is read as "buys", the conservative reading: fewer emails.

## Review Focus

1. **Forged or replayed purchases:**
   - On a WooCommerce-connected site, a beacon with a made-up order id, a wrong order key, or none never records a sale.
   - Reloading the thank-you page, or replaying the beacon, records one sale.
   - A beacon with another site's key gets nothing.

   *(tests in Tasks 4 and 5)*
2. **Credentials:**
   - The secret is never in a response, a rendered page or an error message.
   - A store URL on another host, on `http:`, or on a private address is refused.
   - A redirecting store URL gets an error naming the final address, and the credentials are never sent there.

   *(tests in Task 2)*
3. **Wrong attribution:**
   - Opening the chat without typing isn't a chat sale.
   - A chat in another visit doesn't count, and neither does a suggestion that was shown but not tapped.
   - An email click 31 days before the order doesn't count.
   - Another site's contact never matches.

   *(tests in Task 4)*
4. **Privacy:**
   - No beacon without tracking consent.
   - An unattributed order leaves no row.
   - The billing email isn't stored anywhere.
   - Deleting a person keeps their sales as anonymous counts.

   *(tests in Tasks 3, 5 and 6)*
5. **Money parsing:**
   - `"34.90"` EUR → 3490, `"1500"` JPY → 1500, and `"0.00"` → 0.
   - A missing or garbled total → the sale is kept with `amount_minor = null`.
   - `refunded`, `failed` and `cancelled` orders are not counted.

   *(tests in Task 5)*

---

### Task 1: Data model and encrypted credentials

**Files:**
- Modify: `src/db/schema.ts`; migration via `npm run db:generate -- --name sales`
- Modify: `tests/helpers/db.ts` (`TABLES` += `sales`, `store_connections`)
- Create: `src/lib/crypto/secrets.ts`
- Test: `tests/unit/secrets.test.ts`, `tests/integration/schema.test.ts` (extend)

**Interfaces:**
- **Produces, schema:**
  - Table `store_connections`:
    - `id` uuid pk; `site_id` → sites, cascade, **unique**;
    - `platform` text `woocommerce`; `store_url` text;
    - `consumer_key` text; `consumer_secret_enc` text;
    - `status` text `connected | failing`, default `connected`; `last_error` text null; `verified_at` timestamp; `created_at`.
  - Table `sales`:
    - `id` uuid pk; `site_id` → sites, cascade;
    - `source` text `woocommerce | page`; `external_id` text null; `verified` bool;
    - `amount_minor` bigint null; `currency` text null; `ordered_at` timestamp;
    - `visitor_session_id` text; `page_url` text;
    - `via_chat`, `via_prompt` and `via_email`, each bool;
    - `conversation_id` → conversations, set null; `prompt_impression_id` → prompt_impressions, set null;
    - `contact_id` → contacts, set null; `email_message_id` → email_messages, set null;
    - `created_at`;
    - unique `(site_id, source, external_id)` where `external_id is not null`;
    - unique `(site_id, visitor_session_id, page_url)` where `external_id is null`;
    - index `(site_id, ordered_at)`.
  - Types: `type Sale`, `type StoreConnection`.
- **Produces, `secrets.ts`:**
  - `encryptSecret(plain: string): string`, in the form `v1.<iv>.<tag>.<ciphertext>`, base64url, with a 12-byte random IV;
  - `decryptSecret(enc: string): string`, which throws `Error("Can't read a stored credential")` on tampering or a wrong key.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:**
    - Round trip.
    - Two encryptions of the same text differ.
    - Flipping one ciphertext character throws.
    - A `v2.` prefix throws.
    - The output doesn't contain the plaintext.
  - **Integration:** a second `store_connections` row for the same site violates the unique index. Two `sales` rows with the same `(site, source, external_id)` conflict, while two with a null `external_id` and different `page_url`s don't.
- [ ] **Step 2:** Run `npx vitest run tests/unit/secrets.test.ts tests/integration/schema.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Check that the generated SQL only adds the two tables and their indexes.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sales): data model and encrypted store credentials`.

### Task 2: WooCommerce client and connection settings

**Files:**
- Create:
  - `src/lib/sales/woocommerce.ts`
  - `src/lib/sales/connections.ts`
  - `src/app/app/sites/[siteId]/settings/store-connection.tsx`
- Modify: `src/app/app/sites/[siteId]/settings/actions.ts` and `page.tsx`
- Test: `tests/integration/store-connection.test.ts`

**Interfaces:**
- **Produces, `woocommerce.ts`:**
  - `type WooOrder = { id: number; orderKey: string; status: string; currency: string; total: string | null; createdGmt: string; billingEmail: string | null }`
  - `type WooCredentials = { storeUrl: string; consumerKey: string; consumerSecret: string }`
  - `wooGet(creds: WooCredentials, path: string): Promise<{ status: number; json: unknown }>`:
    - `GET {storeUrl}/wp-json/wc/v3{path}` with Basic auth, `redirect: "manual"` and a 10 s timeout;
    - the body is capped at 1 MB;
    - it refuses (status 0, no request) unless every address the host resolves to passes the crawler's `isBlockedAddress` check (IP literals are checked directly), or `CRAWL_ALLOW_PRIVATE_HOSTS` is set;
    - on a 401, it retries once with the `consumer_key` and `consumer_secret` query parameters (some hosts strip `Authorization`).
  - `fetchOrder(creds, id: string): Promise<WooOrder | null>`: null on a 404 or an unexpected shape.
  - `testConnection(creds): Promise<{ ok: true } | { ok: false; error: string }>` uses `/orders?per_page=1`. The errors:
    - 401 or 403 → "WooCommerce refused the key. Check it has Read access.";
    - 404 → "There's no WooCommerce REST API at this address.";
    - 3xx → `Your shop redirects to ${origin of Location}. Use that address.`;
    - anything else → "Couldn't reach your shop. Try again in a minute."
  - `setWooTransportForTests(t: { fetch: typeof fetch; lookup: (host: string) => Promise<string[]> } | null): void`. Tests swap both the fetch and the DNS lookup, so they never touch the network; null restores `fetch` and `dns.promises.lookup(host, { all: true })`.
- **Produces, `connections.ts`:**
  - `connectWooCommerce(siteId: string, input: unknown): Promise<void>`:
    - zod: `storeUrl` must be `https:` and have no path beyond `/`. Its host must equal the site's `baseUrl` host or an `allowedOrigins` host; otherwise `ValidationError("Use your website's own address")`.
    - `consumerKey` must match `/^ck_[a-f0-9]{40}$/` and `consumerSecret` `/^cs_[a-f0-9]{40}$/`.
    - It runs `testConnection`. A failure throws `ValidationError(error)` and stores nothing.
    - It upserts with `consumer_secret_enc = encryptSecret(secret)`, `status: connected` and `verified_at: now`.
  - `getStoreCredentials(siteId): Promise<WooCredentials | null>` decrypts, for server use only.
  - `getStoreConnectionSummary(siteId): Promise<{ storeUrl: string; keyLast4: string; status: "connected" | "failing"; lastError: string | null } | null>`, which never includes the secret.
  - `markConnectionFailing(siteId, error: string)` and `disconnectStore(siteId)`.
- **Settings UI ("Sales tracking", after "Sending domain"):**
  - **Not connected:** the fields "Store address" (pre-filled with `baseUrl`'s origin), "Consumer key" and "Consumer secret" (`type=password`, `autocomplete=off`), and the button "Connect WooCommerce".
  - **Help:** "In WordPress: WooCommerce → Settings → Advanced → REST API → Add key, with Read permission." and "Not on WooCommerce? Sales are still counted from your order-confirmation page, without amounts."
  - **Connected:** "Connected to {storeUrl} · key ending {last4}" and the button "Remove". When the status is `failing`, it also shows `lastError` and "Reconnect with a new key."

- [ ] **Step 1: Write the failing tests** (with a fake transport via `setWooTransportForTests`; the fake lookup returns `["93.184.216.34"]` unless a test says otherwise).
  - Connecting with a valid key stores a row. The stored `consumer_secret_enc` doesn't contain the secret. `getStoreCredentials` returns it decrypted, and the summary shows `keyLast4` without the secret.
  - The fake sees `Authorization: Basic base64(ck:cs)` on `…/wp-json/wc/v3/orders?per_page=1`.
  - A 401 with Basic auth, then 200 with query parameters → connected.
  - 401 on both → the error "WooCommerce refused the key…", and no row.
  - A 301 to `https://www.milianjo.com/…` → "Your shop redirects to https://www.milianjo.com. Use that address.", and the fake never gets a second request.
  - `storeUrl` values `https://evil.com`, `http://milianjo.com` and `https://milianjo.com/shop` → `ValidationError`, and fetch isn't called.
  - A key `abc` → `ValidationError`.
  - A store host whose lookup returns `["10.0.0.5"]` → "Couldn't reach your shop. Try again in a minute.", and fetch isn't called.
  - The settings page renders the connected summary, and the rendered HTML never contains the secret.
  - `connectStoreAction` on another account's site → the 404 digest.
- [ ] **Step 2:** Run `npx vitest run tests/integration/store-connection.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, then `npx vitest run tests/integration/site-admin.test.ts tests/integration/crawl-site.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sales): WooCommerce connection with encrypted key`.

### Task 3: Order-confirmation detection and the beacon in the widget

**Files:**
- Create: `widget/src/orders.ts`
- Modify:
  - `src/shared/widget-protocol.ts` (`OrderRequest`)
  - `widget/src/api.ts` (`sendOrder`), `widget/src/boot.ts`
- Test: `widget/test/orders.test.ts`

**Interfaces:**
- **Produces:**
  - `OrderRequest = { key: string; sid: string; url: string; orderId: string | null; orderKey: string | null; ref: string | null }`.
  - `detectOrderConfirmation(doc: Document, win: Window): { orderId: string | null; orderKey: string | null } | null`, using the rules in Decided values.
  - `reportOrderOnce(opts: { doc; win; store; apiBase; siteKey }): void`. It sends at most once per page per visit, with `keepalive: true`, ignores failures, and uses `getSession(store).sid` and `getRef(store)`.
  - `sendOrder(apiBase, req): void`: fire and forget.
- **Boot:** call `reportOrderOnce` whenever a tracker is started (that is, tracking is allowed), and never otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `/checkout/order-received/1234/?key=wc_order_AbC123xyz` → `{ orderId: "1234", orderKey: "wc_order_AbC123xyz" }`.
  - The same page with `key=<script>` → `orderKey: null`.
  - `/thank-you/` with `<h1>Thank you for your order</h1>` → `{ orderId: null, orderKey: null }`.
  - `/thank-you/` with `<h1>Thanks for subscribing</h1>` → null.
  - `/product/shampoo/` → null.
  - **Boot, mode `off`:** a beacon POST to `/api/widget/order?key=pk_test` with the body above, and a reload (a second boot on the same storage) sends nothing new.
  - **Boot, mode `auto`, with Complianz refusing:** no `/order` request.
  - With `cc_ref=abc123` stored, the beacon carries `ref: "abc123"`.
- [ ] **Step 2:** Run `npx vitest run --project widget widget/test/orders.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --project widget` and `npm run widget:build`. Expected: PASS; gzip under 40 KB.
- [ ] **Step 5:** Commit `feat(widget): order-confirmation beacon`.

### Task 4: Recording a sighting, with visit and email attribution

**Files:**
- Create:
  - `src/lib/sales/attribution.ts`
  - `src/lib/sales/record.ts`
  - `src/app/api/widget/order/route.ts`
- Modify:
  - `src/lib/jobs.ts` (`JOBS.verifyOrder = "verify-order"`, `JobData["verify-order"]`)
  - `src/lib/email/schedule.ts` (`stopSequence`)
- Test: `tests/integration/sales-attribution.test.ts`

**Interfaces:**
- **Produces, `attribution.ts`:**
  - `visitAttribution(siteId: string, sid: string, before: Date): Promise<{ conversationId: string | null; promptImpressionId: string | null }>`:
    - the latest conversation of that site and sid, created before `before`, with at least 1 visitor message;
    - the latest tapped impression of that site and sid.
  - `emailAttribution(siteId: string, by: { ref: string | null; email: string | null }, orderedAt: Date): Promise<{ contactId: string; emailMessageId: string } | null>`:
    - the site's contact by `ref`, or by the lowercased email;
    - their email message with the latest `last_clicked_at` within the 30 days before `orderedAt`.
  - `contactFor(siteId, by): Promise<string | null>`: the contact id by ref or email, whether or not they clicked (used for the sequence stop).
- **Produces, `record.ts`:**
  - `recordSighting(site: WidgetSite, input: { sid; url; orderId; orderKey; ref }, now?: Date): Promise<void>`:
    - **Connected WooCommerce site:** with an `orderId` and `orderKey`, it enqueues `verify-order` `{ siteId, sid, url, orderId, orderKey, ref, seenAt }` (singletonKey `${siteId}:${orderId}`); without them, it does nothing.
    - **Not connected:** it computes the visit attribution (with `before = now`) and the email attribution (by ref only; `orderedAt = now`).
      - If anything is attributed, it inserts a sale with `source: "page"`, `verified: false`, `amount_minor: null`, `external_id = orderId`, `ordered_at = now`, and `onConflictDoNothing`.
      - It calls `stopSequence(contactFor(...))` when the sale is email-attributed.
  - `saveSale(values): Promise<boolean>`: an insert with `onConflictDoNothing`, returning true when a row was inserted. Task 5 uses it too.
- **Produces, `schedule.ts`:** `stopSequence(contactId: string, now?: Date): Promise<void>` (see Decided values). Task 5 uses it too.
- **Route:** zod with `sid` = `sidSchema`; `url` http(s), at most `LIMITS.urlMaxChars`; `orderId` `/^\d{1,20}$/` or null; `orderKey` `/^wc_order_[A-Za-z0-9]{6,40}$/` or null; `ref` `/^[A-Za-z0-9_-]{1,64}$/` or null. It applies the rate limits and returns 204.

- [ ] **Step 1: Write the failing tests** (not connected unless stated).
  - A visit with a 1-message conversation, then a beacon → one sale with `via_chat` and `conversation_id`, `verified: false` and `amount_minor: null`.
  - A visit that opened the chat but sent nothing (a conversation with 0 visitor messages) → no row.
  - A conversation under another sid → no row.
  - A tapped impression → `via_prompt`. Only shown → no row.
  - A `ref` of a contact who clicked 5 days ago → `via_email` with `email_message_id`, and their draft is discarded (the sequence stopped). Clicked 31 days ago → no row.
  - Another site's ref → no row.
  - The same beacon twice (the same page url and sid, with no order id) → one row.
  - The route: a bad orderKey → 400; the 6th beacon in an hour → 429; an unattributed one → 204 with no row.
  - **Connected site:** the beacon enqueues one `verify-order` job and stores no sale yet. Without an `orderKey`, it enqueues nothing.
- [ ] **Step 2:** Run `npx vitest run tests/integration/sales-attribution.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sales): record purchases attributed to chats, suggestions and emails`.

### Task 5: Verifying WooCommerce orders, and stopping emails on purchase

**Files:**
- Create: `src/lib/sales/verify.ts`, `src/lib/sales/money.ts`
- Modify:
  - `src/worker/handlers.ts`, `src/lib/jobs.ts` (queue options), `src/lib/privacy/retention.ts`
- Test: `tests/integration/sales-verify.test.ts`, `tests/unit/money.test.ts`, `tests/integration/retention.test.ts` (extend)

**Interfaces:**
- **Produces:**
  - `toMinorUnits(total: string | null, currency: string): number | null` in `src/lib/sales/money.ts`. It parses `/^\d+(\.\d+)?$/` exactly to the currency's decimals, rounding half up on extra digits, and returns null otherwise.
  - `verifyOrder(data: JobData["verify-order"], opts?: { now?: Date }): Promise<"recorded" | "unattributed" | "rejected" | "retry">`:
    1. Load the credentials. If there are none → `rejected`.
    2. `fetchOrder`. On a network error or a 5xx, throw (pg-boss retries, `retryLimit: 3`, `retryDelay: 120`, `retryBackoff: true`). On a 401 or 403, call `markConnectionFailing(siteId, "WooCommerce refused the key. Reconnect it in Settings.")` → `rejected`. On a 404 → `rejected`.
    3. `order.orderKey !== data.orderKey` → `rejected`.
    4. A status outside the counted set: for `pending`, while the attempts are under 3, re-enqueue with `startAfter` of 30, 60 or 120 minutes and `attempt + 1` → `retry`. Anything else → `rejected`.
    5. Attribution: visit (`before = seenAt`) and email (ref or billing email, with `orderedAt = createdGmt` read as UTC). If neither → `unattributed`.
    6. `saveSale` with `source: "woocommerce"`, `verified: true`, `external_id = String(order.id)`, `amount_minor = toMinorUnits(order.total, order.currency)`, `currency` and `ordered_at`. Then `stopSequence(contactFor(siteId, { ref, email: billingEmail }))` when a contact is found, whether or not they clicked: buying ends the series.
    7. → `recorded`.
  - `JobData["verify-order"]` gains `attempt?: number`. Queue options: `{ retryLimit: 3, retryDelay: 120, retryBackoff: true, expireInSeconds: 300 }`.
  - **Retention:** `sales` rows whose `ordered_at` is older than the site's retention are deleted (the result gains `sales: number`).

- [ ] **Step 1: Write the failing tests** (with a fake WooCommerce through `setWooTransportForTests`).
  - **Unit, `toMinorUnits`:**
    - `("34.90","EUR")` → 3490; `("34.9","EUR")` → 3490; `("1500","JPY")` → 1500; `("0.00","EUR")` → 0;
    - `("12.345","EUR")` → 1235;
    - `("abc","EUR")`, `(null,"EUR")` and `("-5","EUR")` → null.
  - **Integration:**
    - A processing order with the matching key and a chatting visit → `recorded`, with one sale `verified`, `amount_minor` 3490 and `currency` EUR.
    - Running it twice → one row.
    - A wrong order key → `rejected`, no row.
    - A 404 → `rejected`.
    - A 401 → `rejected`, and the connection is `failing` with its error.
    - `refunded`, `failed` and `cancelled` → `rejected`.
    - `pending` → `retry`, and one job is enqueued with `attempt: 1` and a `startAfter`. At `attempt: 3` → `rejected`.
    - Email attribution:
      - a billing email `Maria@Example.com` matching a contact who clicked 3 days ago → `via_email`;
      - the contact's sequence is stopped and their approved email `discarded`;
      - no table holds `maria@example.com` except `contacts`.
    - A purchase by a subscribed contact who never clicked, with no chat → `unattributed`, but their sequence is still stopped.
    - An unattributed order with no contact → no row, and nothing else changes.
    - A garbled total → a sale with `amount_minor: null`.
    - **Retention:** a 25-month-old sale on a 24-month site is deleted, and a 23-month-old one is kept.
    - **`deletePerson`:** the sale stays, with `contact_id` null.
- [ ] **Step 2:** Run `npx vitest run tests/unit/money.test.ts tests/integration/sales-verify.test.ts tests/integration/retention.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, then `npx vitest run tests/integration/sales-attribution.test.ts tests/integration/jobs.test.ts tests/integration/email-admin.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sales): verify WooCommerce orders; stop emails on purchase`.

### Task 6: Sales in the admin

**Files:**
- Create: `src/lib/stats/sales.ts`
- Modify:
  - `src/app/app/sites/[siteId]/overview/page.tsx`
  - `src/lib/conversations/list.ts`, `src/lib/conversations/detail.ts`
  - `src/app/app/sites/[siteId]/conversations/page.tsx`, `src/app/app/sites/[siteId]/conversations/[conversationId]/page.tsx`
  - `src/lib/email/admin.ts` (`listSent` adds `sales: number`), `src/app/app/sites/[siteId]/emails/page.tsx`
  - `src/lib/format.ts` (`money(minor: number, currency: string): string` via `Intl.NumberFormat("en", { style: "currency", currency })`)
- Test: `tests/integration/sales-admin.test.ts`

**Interfaces:**
- **Produces:**
  - `getSalesTotals(siteIds: string[], range: StatsRange): Promise<{ count: number; viaChat: number; viaPrompt: number; viaEmail: number; revenue: { currency: string; minor: number }[]; withoutAmount: number }>`. It counts by `ordered_at`, and lists revenue per currency, largest first.
  - `ConversationFilter` += `"sale"` (label "Sale followed"). `ConversationRow.hasSale: boolean`.
  - `getConversation(...)` adds `sales: Sale[]`.
- **UI:**
  - **Overview "Sales" tile:**
    - value `{count}`;
    - note `{money(revenue[0])}{ + more currencies}` and `· {viaChat} after a chat · {viaPrompt} from a suggestion · {viaEmail} from an email`;
    - when `withoutAmount > 0`, also `· {withoutAmount} without an amount`;
    - with no connection and no sales, the note is "Connect WooCommerce in Settings to see amounts."
  - **Conversations:** a "Sale followed" filter, and a "Sale" marker on a row.
  - **Conversation detail:** "Sale followed: {money} · order #{external_id}". Without an amount it reads "Sale followed (amount unknown)".
  - **Emails → Sent:** a "Sales" column.

- [ ] **Step 1: Write the failing tests.**
  - `getSalesTotals` with three sales (EUR 3490 via chat; EUR 1000 via email and prompt; unverified with no amount via chat) → `{ count: 3, viaChat: 2, viaPrompt: 1, viaEmail: 1, revenue: [{ currency: "EUR", minor: 4490 }], withoutAmount: 1 }`. A sale outside the range isn't counted.
  - The overview renders `€44.90` and "1 without an amount".
  - The conversations list with `filter=sale` shows only the conversation with a sale. The detail page renders "Sale followed: €34.90 · order #1234".
  - Sent shows the email's sales count.
  - Another site's sales never appear.
- [ ] **Step 2:** Run `npx vitest run tests/integration/sales-admin.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full gate: `npm run lint && npm run typecheck && npm test && npm run widget:build`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(admin): sales from chats, suggestions and emails`.

### Hand-off: connect Milian Jo and deploy

- [ ] Run `./deploy/deploy.sh`: the migration, the worker job and the widget.
- [ ] **In WordPress (milianjo.com):** WooCommerce → Settings → Advanced → REST API → Add key, with Read permission. Then in Concierge, Settings → Sales tracking → store address `https://milianjo.com` → paste the key and secret → Connect.
- [ ] **Smoke test:** chat on the shop, place a test order (for example by bank transfer, which is `on-hold`), and see it under Overview → Sales and on that conversation.
