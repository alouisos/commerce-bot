# Website Chatbot SaaS — Design

Date: 2026-11-06
Status: draft for approval

Markers used below:
- **(decided)** — the product owner decided this in conversation.
- **(my call)** — the designer's default; the owner accepted the stack choices
  as a group but has not seen every detail. Easy to change.
- **(builder)** — explicitly left to whoever builds it.

---

## 1. What this is and why

A self-serve SaaS product: a text chatbot that any website owner can add to
their site by pasting one snippet — including WordPress sites. It quietly
watches how each visitor browses, works out what they are there to do, and
offers well-timed, relevant help without getting in their way.

The first live customer is **Milian Jo**, a Greek, Greek-first haircare brand
whose new storefront lives in this repository. But the product is not built
for Milian Jo: Milian Jo is an ordinary account on the platform, with no
special-case code. **(decided)**

**The three outcomes it exists for (decided):**
1. **Educate** visitors about the products.
2. **Capture emails** — with marketing permission — for personalised follow-up.
3. **Lead to more sales.**

**What makes it different:** the bot infers intent from behaviour (where people
scroll, where they linger, what they add to cart), not just from what they type,
and it understands each site without anyone tagging pages.

## 2. Goals, non-goals, anti-goals

### Goals
- A visitor gets genuinely useful, context-aware help at the right moment, and
  can ignore or dismiss it with one click. **(decided)**
- Site owners sign up, pay, install, and run everything themselves. **(decided)**
- The site owner (admin) can see every conversation, the core numbers, and
  AI-written insights, and can control the bot's knowledge, greeting, and
  behaviour. **(decided)**

### Non-goals
- **Voice.** Text chat only. **(decided)** The existing voice-only "Ask Jo"
  panel in this repo is replaced, not extended.
- **Integrations with external email/lead tools** (Mailchimp, Klaviyo, CRMs).
  The product sends its own emails and keeps its own leads. **(decided)**
- **Manual page tagging** by customers — for Milian Jo or anyone. **(decided)**
- An official WordPress plugin in the first version. The snippet is pasted via
  any header/footer code plugin or the theme. A WP plugin can come later. **(my call)**
- Sales-platform integrations beyond WooCommerce and Shopify in v1. **(decided)**

### Anti-goals — failure even if everything technically works (decided)
1. **The bot is annoying or pushy.**
2. **The bot misreads intent** and offers the wrong kind of help.

Both outrank conversion. When in doubt, the bot stays quiet: a missed
opportunity is the acceptable failure; an unwanted interruption is not.
Section 5 makes this concrete.

## 3. Who uses it

- **Visitors** on a customer's website. Anonymous. They chat, see prompts,
  maybe give their email.
- **Admins** — people at a customer business. They log into the admin panel to
  manage one or more websites. An account can invite several admins. **(my call)**
- **The platform owner** (you). A small internal view to see accounts, assign
  complimentary plans (e.g. Milian Jo), and help customers. **(my call)**

## 4. How it gets made — stack (my call, accepted by owner)

- **Separate product, separate repository** from the Milian Jo site.
  Product name and repo name: **TBD** (see open questions).
- **App + admin panel + API:** Next.js and TypeScript, matching the Milian Jo
  site. ⚠ The Milian Jo repo uses Next.js 16, which has breaking changes from
  older versions; read `node_modules/next/dist/docs/` before writing code.
- **Widget:** a small standalone JavaScript bundle, framework-free or with a
  tiny runtime, rendered inside a Shadow DOM so the host site's CSS can't break
  it and it can't break the host site. Loaded by a one-line snippet carrying the
  site's public key, e.g.
  `<script src="https://app.<domain>/widget.js" data-site="pk_…" async></script>`.
- **Database:** Postgres. Vector search (e.g. pgvector) for the knowledge base.
- **File storage:** S3-compatible object storage for uploaded documents and images.
- **AI:** Claude, for chatting, generating prompts, analysing images, writing
  emails, and writing insights. Use current models (e.g. a Sonnet-class model
  for chat/emails, a Haiku-class model for cheap high-volume tasks).
  Embedding provider for knowledge-base search: **(builder)**.
- **Email delivery:** a transactional provider that supports sending from a
  customer's own verified domain: **(builder)** picks which.
- **Payments:** Stripe. **(decided)**
- **Hosting:** own subdomain (e.g. `app.<domain>`), possibly on the same server
  that runs Milian Jo behind nginx. Exact deployment: **(builder)**.
- **Team and pace (decided):** one person building (the owner, with AI help),
  and it is wanted **as soon as possible**. So prefer managed services and
  proven libraries over building infrastructure: hosted Postgres, an
  established auth library, a managed email provider, an off-the-shelf crawler
  where one fits. Keep each stage to the smallest version that does its job. **(my call, from the decision)**
- **Data location (decided):** data and AI processing do **not** have to stay in
  the EU. Standard GDPR compliance, using the usual safeguards for transfers
  outside the EU (e.g. providers' standard contractual clauses / DPAs), is enough.

## 5. The visitor experience

### 5.1 The widget
- A launcher in a corner of the page. Opening it shows a text chat.
- On landing, a small **greeting popup** unfolds beside the launcher once per
  session, with a **greeting message and image the admin sets**. **(decided)**
  It never takes focus and dismisses on the first scroll, click, or keypress.
  (This is the behaviour of the existing Ask Jo teaser in this repo,
  `src/components/ui/AskJoLauncher.tsx`; carry it over.)
- The admin can also set the bot's **name, accent colour, and corner**. **(my call)**
  On Milian Jo it is named "Ask Jo" with Milian Jo branding.
- Every chat starts with a short notice that the visitor is talking to an AI
  (EU AI Act transparency obligation). **(my call — legally required)**
- The bot replies in the language the visitor writes in. **(my call)**
- **Text the admin sets, on multilingual sites (my call):** the admin writes the
  greeting (and, if they want to change it, the email-consent wording) once per
  language their site uses. The widget picks the version matching the page's
  language. The product ships reviewed Greek and English defaults for the AI
  notice and consent wording. Proactive prompts are generated by the AI in the
  page's language. Any language with no admin version falls back to an AI
  translation, except consent wording, which always uses a reviewed version.
- Accessible: keyboard-operable, screen-reader labelled, works at phone width.
  The existing Ask Jo components show the bar this site expects.

### 5.2 Understanding where the visitor is — no tagging (decided)
- When an admin adds a website, the product **crawls it** to learn its pages
  and products, and keeps that up to date (periodic re-crawl, plus a
  "re-crawl now" button). **(decided: crawling; my call: refresh mechanics)**
- The crawl also seeds the knowledge base before the admin uploads anything.
- In the browser, the widget reads the current page as the visitor sees it —
  URL, headings, product name/price if present, the section currently on
  screen — and matches it to what the crawl learned.
- Works on any site structure. Milian Jo gets no special handling.

### 5.3 Reading intent from behaviour (decided)
The widget tracks, per visit: pages viewed, the section on screen and for how
long, scroll depth and speed, returning to the same content, add-to-cart and
cart/checkout pages, and what the visitor types if they chat.

From that it keeps a running estimate of one of three intents:
- **Learning** — educating themselves (ingredients, how-to, the brand's story).
- **Exploring products** — learning about specific products.
- **Ready to buy** — needs help picking or completing a purchase.

The exact signals, weights, and thresholds: **(builder)**, but must honour the
rules in 5.5. Each estimate carries a confidence; low confidence means no prompt.

### 5.4 Proactive prompts (decided)
When intent is clear enough, a small prompt appears beside the launcher, tied
to what is on screen:
- **Information-seeking** → a relevant question the visitor can tap, e.g.
  "Want to know what this does for colour-treated hair?"
- **Buying** → a pairing suggestion, e.g. "This is often used with the leave-in
  conditioner — want to know why?"

Tapping opens the chat with that context already loaded, so the bot continues
the thought rather than starting cold. Ignoring or closing it makes it go away.

Pairings come from the knowledge base. The bot infers them from product
information; admins can also state pairings explicitly. **(my call)**

### 5.5 Not being annoying — hard rules (my call, from the anti-goals)
- No prompt in the first several seconds after landing, and none while the
  visitor is actively scrolling.
- A cap of prompts per visit (default 2).
- Only an explicit no silences prompts for the rest of the visit: × on a
  prompt, × on the greeting, or "No" to the email ask. Opening the chat does
  not. After a chat, at most one more prompt may come: on another page, 30 s
  after the chat closed or the page opened, when the visitor is close to
  buying, and built on the conversation. (Product owner, 2026-11-14.)
- No prompt when intent confidence is low.
- **Proactivity dial per site:** Off (bot only answers when opened) /
  Gentle (default) / Active.
- The system tracks shown / tapped / dismissed for every prompt type and
  **automatically backs off** prompt types that keep getting dismissed on a
  site. The admin is told when this happens.

### 5.6 Email capture (decided)
- Asked only **after the visitor has engaged in a conversation**, never cold.
- Framed as a favour tied to what they discussed: "Want me to send you
  personalised recommendations about what we just talked about?"
- Saying yes is explicit **marketing consent**. Store the timestamp, the exact
  wording shown, the site, and the language. **(my call — GDPR)**
- The email becomes a **lead** in the admin panel, linked to their
  conversation(s), behaviour, and intent.

### 5.7 Privacy (my call — builder must make it compliant)
Customers sell in the EU, so tracking falls under GDPR and ePrivacy rules.
- Behaviour within a single visit is used to help that visit.
- Recognising the same visitor across visits (a persistent identifier), and
  linking behaviour to an email, needs a lawful basis. At minimum it is tied to
  the visitor's consent. The widget should respect the host site's cookie
  consent where it can detect it, and offer a config option for sites that
  require explicit consent before the widget does anything.
- Exact mechanism: **(builder)**, but it must not require tagging and must be
  safe by default for EU sites.
- Each site has a data-retention setting for conversations and behaviour data,
  defaulting to 24 months. Visitors can be deleted on request from the admin. **(my call)**

## 6. Personalised marketing emails (decided)
- The product **writes and sends its own emails** — no external tools.
- Each email is written individually for that person by the AI, using their
  conversation, their browsing (what they lingered on, added to cart, left
  behind), and the site's knowledge base, including images where useful.
- **Sending mode per site (decided):** *automatic* or *admin review and
  approval*. In approval mode, drafts wait in a queue where the admin can edit,
  approve, or discard. Default for new sites: approval. **(my call)**
- **Frequency set by the admin (decided):** how often, and at most how many per
  person, e.g. "every 4 days, at most 3". Defaults are conservative. **(my call)**
- A person's sequence stops early when they unsubscribe or buy what was
  recommended. If they come back and chat again, it restarts from the new
  conversation. **(my call)**
- Every email has one-click unsubscribe.
- Emails come **from the customer's own domain** (e.g. `hello@milianjo.com`),
  which needs a domain-verification step during setup. **(my call)**
- Emails are written in the language the visitor used. **(my call)**
- Links in emails are tracked so visits and sales can be attributed.

## 7. Knowledge base (decided)
- Admins upload **documents and images** for each website.
- **Documents** are processed into searchable knowledge. Supported types in v1:
  PDF, Word, plain text/Markdown, and pasted text. **(my call)**
- **Images are used both ways (decided):** the bot reads them to learn (labels,
  ingredient lists, how-to diagrams), *and* can show them to visitors in chat
  and in emails when relevant.
- Admins may add a caption or link an image to a product; nothing depends on it.
- Crawled site content appears in the knowledge base too, marked as crawled,
  and the admin can exclude pages from it.
- The bot answers from the knowledge base and the crawled site. When it doesn't
  know, it says so rather than inventing. These misses feed the insights (§8).
- **Guardrails:** admins can add rules such as "never give medical advice;
  suggest a dermatologist." **(my call)**

## 8. Admin panel (decided)

### 8.1 Dashboard — the four headline numbers (decided)
For a chosen date range and site:
1. **Number of conversations.**
2. **Sales from conversations** (count and, where known, revenue).
3. **Emails captured.**
4. **Insights from all conversations.**

Plus prompt performance: shown / tapped / dismissed by prompt type, with high
dismissal rates flagged. **(my call)**

### 8.2 Conversations (decided)
Every conversation is saved and viewable: the transcript, the pages and
behaviour around it, the inferred intent, any prompt that started it, whether
an email was captured, and whether a sale followed. Searchable and filterable.

### 8.3 Insights (decided; content is my call)
AI-written, plain-language findings across all conversations, refreshed
regularly (e.g. daily), such as:
- what people ask most;
- questions the bot couldn't answer well — gaps to fill in the knowledge base;
- worries and objections that come up before buying;
- products people are curious about but don't buy;
- prompts visitors keep dismissing.

### 8.4 Settings
- Greeting message and image for the popup. **(decided)**
- Bot name, accent colour, corner. **(my call)**
- Proactivity dial. **(my call)**
- Email sending mode and frequency. **(decided)**
- Sending domain verification.
- Guardrails.
- Shopify / WooCommerce connection.
- Embed snippet with copy button and install instructions, including WordPress.
- Team members.
- Billing (links to Stripe's customer portal).

## 9. Sales tracking (decided)
- **Connections for WooCommerce and Shopify** that report real orders and
  amounts. In v1 these are "paste a key", not app-store installs **(my call)**:
  - WooCommerce: the admin pastes a WooCommerce REST API key (order webhooks /
    polling). A small WP plugin that does this in one click can come later.
  - Shopify: the admin creates a custom app in their Shopify admin and pastes
    its access token. Not a public Shopify App Store app, because App Store
    apps generally must bill through Shopify instead of Stripe. Revisit later.
  - WooCommerce comes first, since that's what Milian Jo runs.
- **Any other platform:** the widget recognises the order-confirmation page by
  itself (using the crawl and what's on the page) and counts the sale, without
  the amount when it can't be read.
- **Attribution:** a sale counts as "from the chat" if the visitor chatted with
  the bot or tapped a prompt during the visit before buying, or bought after
  clicking a link in one of the bot's emails. Attribution window length:
  **(builder)**, suggest 30 days for email clicks.

Note: Milian Jo's **live** shop runs on WooCommerce. The new storefront in this
repo has no checkout yet; its cart is local to the browser
(`src/lib/shop/store.ts`).

## 10. Sign-up, plans, and billing (decided: self-serve + Stripe; plans are my call, accepted)
- Anyone can sign up, add a website, pay through Stripe, and paste the snippet.
- **14-day free trial**, no card required, with Growth features.
- Plans (prices live in Stripe so they can change without code changes):

| | Starter | Growth | Pro |
|---|---|---|---|
| Price | €29/mo | €79/mo | €199/mo |
| Websites | 1 | 3 | 10 |
| Conversations / month | 500 | 2,000 | 10,000 |
| Marketing emails / month | 1,000 | 5,000 | 25,000 |
| Knowledge base storage | 100 MB | 1 GB | 5 GB |
| Admins | 2 | 5 | unlimited |
| Shopify / WooCommerce sales tracking | ✓ | ✓ | ✓ |
| Automatic email sending (no approval) | – | ✓ | ✓ |
| Remove "Powered by" badge | – | ✓ | ✓ |

- Yearly billing gives two months free.
- **Limits:** warn at 80%. At 100%, the bot **keeps answering** visitors who
  open the chat, but stops new proactive prompts and new emails until upgrade
  or the monthly reset. Visitors never see a broken bot.
- AI usage must be metered per account so no customer can run up unbounded cost.
  This is built in from **stage 1**, not stage 5. **(my call)**
- **What counts as a conversation:** a visit in which the visitor sends at least
  one message. Opening the widget without typing doesn't count. **(my call)**
- **Hard ceiling (my call):** past **150%** of the monthly conversation quota,
  the chat stops using AI and switches to a polite fallback: "leave your email
  and we'll get back to you", which creates a lead and notifies the admin. The
  bot is never just broken. No overage billing in v1.
- **Abuse protection (my call):** the public site key only works on the site's
  registered domains (origin check). Rate limits apply per visitor and per IP,
  and per-message length limits apply. Bot-like traffic doesn't count toward
  the quota where it can be detected.
- The platform owner can assign complimentary plans (Milian Jo).

## 11. Build order (decided)
Each stage is usable on its own, with Milian Jo as the first live site.

1. **Foundation** — sign-up/login, accounts and websites, the embed snippet and
   widget, site crawling, knowledge base (documents and images), the text chat,
   greeting message/image settings.
2. **Admin panel** — saved conversations, core stats, AI insights.
3. **Behaviour and prompts** — intent detection, context prompts, pairing
   suggestions, proactivity dial and the anti-annoyance rules.
4. **Email** — consent capture, personalised emails, frequency, approval queue,
   domain verification.
5. **Money** — Stripe plans, trial, and limits; Shopify/WooCommerce sales tracking.

Billing comes last, so before stage 5 accounts can only be created by the
platform owner or by sign-up with no payment. **(my call)**

## 12. Milian Jo integration
- **First live site: the current Milian Jo website — the live WooCommerce shop
  (decided).** Not the new storefront in this repo, which has no checkout yet.
  So the first install is a WordPress/WooCommerce install: the snippet is
  pasted into the live site, and sales tracking uses the WooCommerce connection.
  That makes the live Milian Jo shop the proving ground for every stage, and
  the WordPress install path gets tested first.
- Milian Jo installs the same snippet as any customer.
- **Later, when the new storefront in this repo goes live:** the voice-only Ask Jo panel and launcher
  (`src/components/ui/AskJo.tsx`, `AskJoLauncher.tsx`, and the
  `<AskJoProvider>` wrappers on every page) are replaced by the widget,
  configured with the "Ask Jo" name, Milian Jo branding, Greek-first greeting,
  and the safety guardrail about medical questions that the current panel
  carries. **(my call)**
- The existing "Ask Jo" button inside `RitualFinder` should open the widget via
  a small public JS API on the widget (e.g. `window.<Widget>.open()`). **(my call)**

## 13. Left to the builder
- Product and repo naming, if not settled before planning.
- Intent signals, scoring, and thresholds (within §5.5).
- Embedding provider, email provider, exact hosting/deployment.
- Crawl scheduling, page-change detection, and how page matching works.
- Data model and API design.
- Consent mechanics (within §5.7).
- Attribution windows.
- Admin panel visual design (clean, usable at phone width).

## 14. Open questions
- **Product name and repo name.** Not yet chosen. The builder may use a working
  name and rename later; it doesn't block planning.
