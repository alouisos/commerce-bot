# Owner controls, windowed insights, Ask the Concierge, email capture, icon, buyer emails: Design

Date: 2026-11-11
Status: for approval (builder check done 2026-11-11)

Markers:
- **(decided)**: the product owner (Alex) said this in conversation.
- **(my call)**: the designer's default, not yet seen by the owner. Easy to change.
- **(builder)**: left to whoever builds it.

Seven changes, requested together on 2026-11-11 after the admin redesign went live. They share one
codebase but are independent; each section below can ship on its own.

Context the builder needs:
- Next.js 16 (read `node_modules/next/dist/docs/` before writing code), React 19, Drizzle + Postgres,
  pg-boss worker (`src/worker`), Resend email, Anthropic SDK, Preact widget in `widget/`.
- The admin look is documented in `DESIGN.md` and `src/app/globals.css` (scope `.cx`). New screens use it.
- Product principles in `PRODUCT.md`. The anti-goal that outranks conversion: the bot must never be
  annoying or pushy. Several sections below are shaped by it.

---

## 1. Owner access, removing customers, readable plan dropdown

**Why:** Alex is both the platform owner and an admin. Today he can only reach `/owner` by typing the URL,
and he can invite customers but can't remove them.

- **Way in (decided):** when a platform owner (`isPlatformOwner`) is signed in to `/app`, the sign stack shows
  an **Owner** sign that leads to `/owner`. Others never see it. `/owner` already links back to the app.
- **Remove a customer (decided):** a Remove action per account in `/owner`. Removing:
  - deletes every login (user) that belongs to that account, ending their sessions;
  - switches the bot off on all the account's websites: the widget config endpoint answers as if the
    site were inactive, so the widget does not render;
  - **keeps the account's data** (sites, conversations, leads, sales) under the normal retention rules
    **(my call)**. The account is marked removed (with a timestamp) and listed separately in `/owner`
    as "Removed", with a **Restore** action that switches the bot back on; the customer then gets a
    fresh invite to set a new login **(my call)**.
  - It asks for typed confirmation of the account name, like Delete website does.
  - The platform owner can't remove the account they belong to **(my call)**.
- **Plan dropdown (decided):** the options in the plan `<select>` are unreadable in the dark theme. Give
  `option` elements explicit dark background and light text in the `.cx` base layer, so every native
  select in the admin is fixed, not only this one.

## 2. Websites list: add, remove, whole-row click, live status

**Why:** owners manage websites from the list, and today only the name is clickable and nothing says
whether the bot is actually running on the site.

- **Whole row clickable (decided):** the entire row opens the website's Overview (a stretched link; the
  row's own buttons still work and keep focus order).
- **Live status (decided):** each row shows **Live** (lit green lamp) when the bot was seen on the site
  recently, else **Not detected** with a short hint and a link to Install. "Recently" = `lastSeenAt` within
  the last 7 days **(my call)**. Crawl problems keep their existing red/amber lamp and retry link; the live
  status is a separate badge.
- **Add (exists)** stays on the page. **Remove (decided):** each row gets a Remove action with the same
  typed-name confirmation as Settings > Delete website, reusing `deleteSite`.

## 3. Insights: three windows, daily email, Ask the Concierge

**Why:** Alex wants to know, every day, what visitors are saying to the bot, and to ask questions like
"what are people asking about the Hair Therapy Butter?" answered from real conversations.

Today: `dailyInsights` (04:00 UTC) writes one insight per site over the last 30 days (at most 150
conversations), shown on Overview.

- **Three windows (decided):** Overview shows insights for **Last 24 hours**, **Last 7 days** and **Last 30 days**,
  switched with the existing segmented control style. The nightly job writes all three per site, each
  stored with its window. Same sections as today. A window with fewer than 3 conversations shows a plain
  "Not enough conversations in this period" instead of generated text, except the 24-hour window, which
  summarises even 1–2 conversations **(my call)**. The Refresh button
  regenerates the window being viewed.
- **Daily email (decided):** each morning, after the nightly job, every member of the account that owns the
  website (members only; no separate platform-owner subscription) gets an email with that website's **last-24-hours insights from the conversations between the AI
  and visitors**. **(my call):** one email per website per person; skipped only when the site had no
  conversations that day. With 1–2 conversations the email still goes out, with a short summary of those
  conversations instead of patterns (the on-screen 24-hour window does the same); sent from the platform address (`sendEmail`, not the site's own domain); includes
  links to Overview and Ask the Concierge; each person can switch it off in a per-user setting and via a
  one-click link in the email; it is labelled as AI-written, like the on-screen insights.
- **Ask the Concierge (decided):** a button on Overview opens a chat page for that website where the owner
  asks questions about products and topics, **answered from the website's conversation history** (not
  from the shop catalogue). Answers link to the conversations they drew on and are labelled AI-written.
  **(my call):** searches the last 90 days of the site's conversations (or retention, if shorter);
  the thread lives on the page only, nothing is stored; each question counts toward the account's AI
  usage and is rate-limited per user. Retrieval approach **(builder)**, e.g. keyword plus embedding search
  over messages, then Claude answers with citations. It must not reveal visitors' email addresses.

## 4. Conversation transcripts render formatting

**Why:** saved bot replies show raw `**bold**`, `- lists` and `[links](…)`.

- Bot messages on the conversation page render the same markdown subset the widget renders (bold, italics,
  lists, links, paragraphs). Visitor messages stay plain text **(my call)**. No raw HTML is ever rendered;
  links open in a new tab with `rel="noopener noreferrer"` and only `http(s)` targets. Reuse the widget's
  renderer logic (`widget/src/render.ts`) or a small shared module rather than adding a large dependency
  **(builder)**.

## 5. The bot asks for an email after a few messages

**Why (decided):** turn the widget into an email-capture machine: today it only offers the email form when
it can't answer.

- After the visitor's **2nd or 3rd message (decided: 2–3 rounds)**, the widget offers email follow-up once
  in that conversation, using the existing consent card, so marketing permission is still recorded
  exactly as it is today. Exact trigger: after the bot's reply to the visitor's 3rd message
  **(my call)**, or the 2nd if the detected intent is "buying" **(my call)**.
- Asked **once per conversation**; dismissing or ignoring it means it is not shown again in that
  conversation, and not again in the same browser session **(my call, from the anti-goal)**.
- Not shown when the visitor already gave an email or the fallback form is showing. It does **not** wait
  for cookie consent, same as the chat today; the "2nd message if buying" shortcut applies only when intent
  is known **(my call)**.
- **Current state (found in review):** the widget already shows this consent card after the bot's 2nd reply,
  once per visit (`CONSENT_AFTER_REPLIES`, `consentAsked`), but only when `canDraftEmail` is true: verified
  sending domain, active plan, emails and conversations left. Sites without a verified domain only ever see
  the fallback form.
- **Ask even without a verified domain (decided):** the consent card is offered on every active site, not
  only those with a verified sending domain. Without a verified domain:
  - the address and the consent are stored exactly as today (same contacts, same consent record);
  - the double opt-in confirmation email is sent from the Concierge platform address (`EMAIL_FROM`),
    in the shop's name ("Milian Jo via Concierge") **(my call)**;
  - no follow-up emails are drafted until the shop verifies its domain; confirmed contacts then enter the
    normal follow-up flow from that point on (no catch-up burst for old contacts beyond the first email)
    **(my call)**;
  - the consent text must stay truthful: it promises follow-up from the shop, not an immediate email
    **(builder: exact wording, in both el and en)**.
  - Monthly email limits and an active plan still apply; `/api/widget/subscribe` follows the same rule.
- The website owner can turn it off per site in Settings; on by default **(my call)**.

## 6. Concierge icon image

**Why (decided):** the uploaded greeting image should be the bot's icon on the website.

- Settings: "Greeting image" is renamed **Concierge icon image**. The uploaded image becomes the round
  launcher button visitors see on the website, replacing the default chat icon; without an upload, the
  default icon stays. The greeting popup no longer shows the image **(my call)**.
- Storage, upload route and cache-busting stay as they are (`greetingImageKey`, `greetingImageVersion`);
  only the label and where the widget draws it change. Renaming DB columns is not required **(builder)**.
- The image is shown cropped to a circle at launcher size, with the bot's name as its accessible label.

## 7. Buyer follow-up emails, a separate avenue

**Why (decided):** after someone buys, the Concierge keeps in touch like a helpful shop assistant.

**Who (decided):** only people who **bought from the shop**: every buyer of a connected WooCommerce store,
whether or not they chatted. People who only chatted keep the existing chat follow-ups.

**What the emails do (decided):** ask how they like the product; invite questions; ask for feedback about
the product; suggest other products they might like, with links to learn more or buy; link to articles
on the shop's site.

How it works:
- **Seeing every buyer:** today an order is only checked when the widget sees an order-confirmation page
  with tracking allowed, and unattributed orders are dropped. Add a worker job that regularly fetches new
  orders from each connected WooCommerce store (orders created since the last fetch; every 30 minutes
  **(my call)**), reading the billing email, first name and line items (product name, product URL). Only
  orders in a paid/processing/completed status count **(my call)**. Existing sale attribution is unchanged.
- **Which orders (my call):** only orders created after Buyer emails is switched on for the site. The
  poller records nothing while the switch is off, and there is no history backfill, so switching it on never
  emails past customers.
- **Shared opt-outs with chat contacts (my call, from the anti-goal):** a buyer whose address unsubscribed
  from chat follow-ups, or was erased with "Delete all data", never gets buyer emails, and the reverse holds
  too: one suppression check covers both tracks. A purchase still stops the chat follow-ups (as today) and
  starts the buyer track. The "at most one email per 7 days" cap counts emails from both tracks.
- **Buyers list:** a new per-site list of buyers (email, name, orders, products bought, unsubscribed),
  separate from chat contacts. One-click unsubscribe in every email stops this track only.
- **Sequence (my call):** two emails per order: (1) about 5 days after the order: how to get the most from
  the product (usage advice from the shop's own pages), any questions, related articles; (2) about 14 days
  after: how do you like it, leave feedback, other products that go with it. A buyer gets at most one
  buyer email per 7 days across orders; a new order replaces a pending sequence.
- **Writing:** Claude writes each email from the product(s) bought, the shop's knowledge base and its
  pages, in the language of the shop's default language **(my call)**. Product and article links must be
  real URLs from the site's crawled pages; never invented. Tracking links and unsubscribe work as in the
  existing follow-up emails.
- **Feedback:** "leave feedback" links to a simple hosted page per email where the buyer rates the product
  (1–5) and writes a comment; the website owner sees feedback in a new Buyers tab **(my call)**. Replies to
  the email go to the shop's own reply-to address **(my call)**.
- **Controls:** a separate **Buyer emails** section in Settings: off by default; on requires a verified
  sending domain and a WooCommerce connection; approval queue or automatic, like chat follow-ups
  (automatic only on plans that allow it). A **Buyers** tab lists buyers, the sequence status, sent emails
  and feedback.
- **Consent (my note, decided default off):** emailing buyers about related products is marketing; it is
  normally lawful for a shop's own customers (soft opt-in) when every email has an unsubscribe and an
  opt-out was offered at checkout. The shop is responsible for that; the Settings switch says so.
- Counts toward the account's monthly email limit.

---

## AI cost (decided: separate owner budget)
Owner-facing AI work (the nightly insight windows, Ask the Concierge, buyer-email writing) is metered
under its own usage kind with its own monthly cap per plan, shown on the Usage page. It **never** counts
toward the ceiling that puts the visitors' bot into fallback mode. When the owner cap is reached, those
features pause with a clear message until next month. Cap values per plan **(builder, from current
pricing in `src/lib/ai/pricing.ts` and `src/lib/plans.ts`)**. To keep cost down, the 7-day and 30-day
windows are regenerated only when the site had new conversations since their last run **(my call)**.

## Goals
- Alex can manage customers end to end from `/owner`.
- Owners understand every day what visitors are asking, and can dig into a product on demand.
- More emails captured, with consent, without making the bot pushy.
- Buyers get genuinely useful follow-up that brings them back to the shop.

## Non-goals
- Shopify or other stores for buyer emails (WooCommerce only for now).
- Owners chatting with Ask the Concierge about anything other than this site's conversations.
- Editing or exporting insights.

## Anti-goals (failure even if it works)
- The bot or the emails feel pushy or spammy (too many asks, irrelevant suggestions).
- Any email address or personal detail leaks into insights, Ask the Concierge answers or other accounts.
- Invented product links, prices or claims in any AI-written email.

## Constraints
- All existing tests keep passing; each part adds its own.
- WCAG AA in the admin; the widget keeps its per-merchant theme.
- Every new email has one-click unsubscribe and respects the account's email limits.

## Left to the builder
Retrieval method for Ask the Concierge; data model details (tables, columns) for windows, buyers,
buyer emails and feedback; job names and schedules within the stated cadences; the shared markdown module.

## Suggested order
4 (markdown), 1 (owner), 2 (websites), 6 (icon), 3 (insights + email + Ask), 5 (email capture),
7 (buyer emails). Small, independent fixes first; the two bot-behaviour and email features last.
