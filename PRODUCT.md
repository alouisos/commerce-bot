# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Admins (primary for this record):** non-technical small-shop owners and their staff (Milian Jo, a Greek haircare brand, is the first live customer). They sign in a few times a week, on a laptop or a phone, to read what visitors asked, see who left an email, check whether the bot is helping sales, and adjust the bot's knowledge, greeting and behaviour. Confirmed by the user, 2026-11-10.
- **Platform owner:** the person running Concierge. Uses the `/owner` console to see accounts, invite customers, assign plans and override limits.
- **Visitors** on customers' websites only ever see the embeddable widget, which is themed per merchant and is out of scope for the admin UI.

## Product Purpose

Concierge is a self-serve, multi-tenant website chatbot. A site owner pastes one snippet; the bot reads the site, infers each visitor's intent from behaviour (scrolling, lingering, cart activity), and offers well-timed help. It exists for three outcomes: educate visitors about the products, capture emails with marketing permission, and lead to more sales. The admin app is where owners see every conversation, the core numbers and AI-written insights, and control the bot.

## Positioning

The bot infers intent from browsing behaviour rather than only from what visitors type, understands each site without manual page tagging, and treats being annoying or pushy as a failure that outranks conversion: when in doubt it stays quiet.

## Operating Context

- Admin routes: websites list, per-site Overview (stats, daily chart, start pages, prompt performance, insights), Conversations (list + transcript), Knowledge (crawled pages, uploads, images), Leads, Emails (drafts, people), Settings (bot details, behaviour, greeting image, email sending, sending domain, WooCommerce connection, delete), Install (snippet), Usage.
- Owner routes: accounts list, account detail, plan select, limit overrides, invites.
- Auth: sign-in, sign-up (invite-only), reset password, invite acceptance.
- Server-rendered Next.js 16 pages with server actions; a few small client components (copy button, poller, dismissible notice, range picker).

## Capabilities and Constraints

- Next.js 16.4 (breaking changes vs. older versions; read `node_modules/next/dist/docs/`), React 19, Tailwind CSS v4.
- Product name: "Concierge" (`src/lib/brand.ts`). No logo asset exists.
- Interface copy is English only.
- Existing vitest (server-rendered markup) and Playwright tests assert on text, roles and labels.

## Brand Commitments

- The user asked for the admin UI to look cyberpunk: "more beautiful, cyberpunk but functional and beautiful", "very functional". Binding aesthetic pin for the admin app, owner console and auth pages.
- The embeddable widget is explicitly excluded from this look.

## Evidence on Hand

No logo, illustrations, screenshots, testimonials or customer quotes exist in the repo. Do not invent customers, metrics or claims.

## Product Principles

1. Clarity beats spectacle: an owner checking in for two minutes must find conversations, leads and sales without learning the interface.
2. Quiet by default, like the bot itself: the interface never nags or alarms without cause; warnings are reserved for real problems (failed crawls, quota limits, failing store connection).
3. Honest numbers: every figure says what it counts and over what period.
4. Self-serve: every setting explains itself in plain language.

## Accessibility & Inclusion

WCAG 2.1 AA contrast for text and controls is a binding requirement from the user (2026-11-10). Honour `prefers-reduced-motion`.
