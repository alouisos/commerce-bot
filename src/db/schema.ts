import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { InsightsContent } from "@/lib/insights/prompt";
import type { LimitOverrides } from "@/lib/plans";
import type { VisitSummary } from "@/shared/widget-protocol";
import { user } from "./auth-schema";

export * from "./auth-schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at").defaultNow().notNull();

export const accounts = pgTable("accounts", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["trial", "starter", "growth", "pro", "complimentary"] })
    .notNull()
    .default("trial"),
  trialEndsAt: timestamp("trial_ends_at"),
  /** Set by the platform owner; unset keys use the plan's limits. */
  limitOverrides: jsonb("limit_overrides").$type<LimitOverrides>(),
  /** Set when the platform owner removes the customer: logins are deleted and the bot is off; data is kept. */
  removedAt: timestamp("removed_at"),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin"] }).notNull(),
    /** Whether this member gets the daily insights email. */
    insightsEmail: boolean("insights_email").notNull().default(true),
    /** Secret in the email's one-click "turn off" link. */
    insightsToken: text("insights_token").unique().$defaultFn(() => randomBytes(24).toString("base64url")),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_account_user_idx").on(t.accountId, t.userId)],
);

export const sites = pgTable("sites", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
  publicKey: text("public_key").notNull().unique(),
  defaultLanguage: text("default_language").notNull().default("en"),
  botName: text("bot_name").notNull().default("Assistant"),
  accentColor: text("accent_color").notNull().default("#1f2937"),
  corner: text("corner", { enum: ["bottom-right", "bottom-left"] })
    .notNull()
    .default("bottom-right"),
  greetingImageKey: text("greeting_image_key"),
  guardrails: text("guardrails").notNull().default(""),
  crawlStatus: text("crawl_status", { enum: ["idle", "crawling", "done", "failed"] })
    .notNull()
    .default("idle"),
  /** Set when a crawl starts; a "crawling" status older than the crawl job's lifetime is stale. */
  crawlStartedAt: timestamp("crawl_started_at"),
  lastCrawledAt: timestamp("last_crawled_at"),
  lastSeenAt: timestamp("last_seen_at"),
  proactivity: text("proactivity", { enum: ["off", "gentle", "active"] })
    .notNull()
    .default("gentle"),
  /** "automatic" takes effect only on plans with autoSendEmails (see effectiveEmailMode). */
  emailMode: text("email_mode", { enum: ["approval", "automatic"] })
    .notNull()
    .default("approval"),
  emailIntervalDays: integer("email_interval_days").notNull().default(4),
  emailMaxPerPerson: integer("email_max_per_person").notNull().default(3),
  emailFromName: text("email_from_name"),
  emailFromLocal: text("email_from_local").notNull().default("hello"),
  sendingDomain: text("sending_domain"),
  sendingDomainId: text("sending_domain_id"),
  sendingDomainStatus: text("sending_domain_status", { enum: ["none", "pending", "verified", "failed"] })
    .notNull()
    .default("none"),
  retentionMonths: integer("retention_months").notNull().default(24),
  /** Whether the widget offers visitors the email consent card. */
  emailAsk: boolean("email_ask").notNull().default(true),
  consentMode: text("consent_mode", { enum: ["auto", "required", "off"] })
    .notNull()
    .default("auto"),
  /** Follow-up emails to people who bought. Orders from before it was switched on are never imported. */
  buyerEmails: text("buyer_emails", { enum: ["off", "approval", "automatic"] })
    .notNull()
    .default("off"),
  /** Set when buyerEmails is switched on. */
  buyerEmailsSince: timestamp("buyer_emails_since"),
  /** The last time the shop's orders were read for buyers. */
  ordersPolledAt: timestamp("orders_polled_at"),
  createdAt: createdAt(),
});

export const siteGreetings = pgTable(
  "site_greetings",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("site_greetings_site_language_idx").on(t.siteId, t.language)],
);

export const kbSources = pgTable(
  "kb_sources",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["document", "image", "text", "page"] }).notNull(),
    title: text("title").notNull(),
    url: text("url"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    bytes: integer("bytes").notNull().default(0),
    caption: text("caption"),
    contentHash: text("content_hash"),
    status: text("status", { enum: ["pending", "processing", "ready", "failed"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    excluded: boolean("excluded").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("kb_sources_site_page_url_idx")
      .on(t.siteId, t.url)
      .where(sql`${t.kind} = 'page'`),
  ],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => kbSources.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("kb_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("kb_chunks_site_idx").on(t.siteId),
    index("kb_chunks_source_idx").on(t.sourceId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    visitorSessionId: text("visitor_session_id").notNull(),
    language: text("language").notNull(),
    firstPageUrl: text("first_page_url"),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    intent: text("intent", { enum: ["learning", "exploring", "buying"] }),
    intentConfidence: real("intent_confidence"),
    visit: jsonb("visit").$type<VisitSummary>(),
    promptImpressionId: uuid("prompt_impression_id").references(() => promptImpressions.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    /** Started from the owner's test tab: listed (marked Test) but left out of every number. */
    isTest: boolean("is_test").default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("conversations_site_idx").on(t.siteId, t.lastMessageAt)],
);

/** One suggestion offered to a visitor. `shownAt` is set when the widget actually displayed it. */
export const promptImpressions = pgTable(
  "prompt_impressions",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    visitorSessionId: text("visitor_session_id").notNull(),
    kind: text("kind", { enum: ["question", "pairing"] }).notNull(),
    intent: text("intent", { enum: ["learning", "exploring", "buying"] }).notNull(),
    confidence: real("confidence").notNull(),
    language: text("language").notNull(),
    pageUrl: text("page_url").notNull(),
    text: text("text").notNull(),
    question: text("question").notNull(),
    shownAt: timestamp("shown_at"),
    outcome: text("outcome", { enum: ["tapped", "dismissed"] }),
    outcomeAt: timestamp("outcome_at"),
    /** Offered in the owner's test tab: left out of back-off and suggestion stats. */
    isTest: boolean("is_test").default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("prompt_impressions_site_shown_idx").on(t.siteId, t.shownAt)],
);

/** Written suggestions per page, reused for a week. A null text means "nothing useful to suggest here". */
export const promptCache = pgTable(
  "prompt_cache",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    urlKey: text("url_key").notNull(),
    kind: text("kind", { enum: ["question", "pairing"] }).notNull(),
    language: text("language").notNull(),
    text: text("text"),
    question: text("question"),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("prompt_cache_key_idx").on(t.siteId, t.urlKey, t.kind, t.language)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["visitor", "bot"] }).notNull(),
    content: text("content").notNull(),
    imageIds: uuid("image_ids").array().notNull().default(sql`'{}'::uuid[]`),
    kind: text("kind", { enum: ["chat", "fallback"] })
      .notNull()
      .default("chat"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const usageEvents = pgTable("usage_events", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["chat", "image_description", "insights", "prompt", "email", "ask", "buyer_email"] }).notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
});

export const monthlyUsage = pgTable(
  "monthly_usage",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    conversations: integer("conversations").notNull().default(0),
    aiCostMicros: bigint("ai_cost_micros", { mode: "number" }).notNull().default(0),
    emails: integer("emails").notNull().default(0),
    /** Owner-facing AI spend (insights, Ask the Concierge, buyer emails): separate from the visitor bot's budget. */
    ownerAiCostMicros: bigint("owner_ai_cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.month] })],
);

export const leads = pgTable("leads", {
  id: id(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  message: text("message").notNull(),
  source: text("source", { enum: ["fallback", "consent"] })
    .notNull()
    .default("fallback"),
  createdAt: createdAt(),
});

export const siteInsights = pgTable(
  "site_insights",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    window: text("window", { enum: ["24h", "7d", "30d"] }).notNull().default("30d"),
    periodFrom: timestamp("period_from").notNull(),
    periodTo: timestamp("period_to").notNull(),
    conversationCount: integer("conversation_count").notNull(),
    content: jsonb("content").$type<InsightsContent>().notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("site_insights_site_window_created_idx").on(t.siteId, t.window, t.createdAt)],
);

/** A person who agreed to emails from one site. Consent is stored as shown, from the server's copy. */
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    language: text("language").notNull(),
    status: text("status", { enum: ["pending", "subscribed", "unsubscribed"] }).notNull(),
    consentText: text("consent_text").notNull(),
    consentLanguage: text("consent_language").notNull(),
    consentedAt: timestamp("consented_at").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    unsubscribedAt: timestamp("unsubscribed_at"),
    /** Confirms and unsubscribes; never leaves the emails we send this person. */
    token: text("token").notNull().unique(),
    /** The attribution reference added to links (cc_ref). */
    ref: text("ref").notNull().unique(),
    sequenceConversationId: uuid("sequence_conversation_id").references((): AnyPgColumn => conversations.id, {
      onDelete: "set null",
    }),
    sequenceStartedAt: timestamp("sequence_started_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_site_email_idx").on(t.siteId, t.email)],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    step: integer("step").notNull(),
    status: text("status", {
      enum: ["draft", "approved", "sending", "sent", "discarded", "failed", "skipped"],
    }).notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    language: text("language").notNull(),
    links: jsonb("links").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    scheduledFor: timestamp("scheduled_for").notNull(),
    sentAt: timestamp("sent_at"),
    providerId: text("provider_id"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    clickedAt: timestamp("clicked_at"),
    lastClickedAt: timestamp("last_clicked_at"),
    clicks: integer("clicks").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("email_messages_status_scheduled_idx").on(t.status, t.scheduledFor),
    index("email_messages_contact_idx").on(t.contactId, t.createdAt),
    // At most one unsent email per person: overlapping ticks can't write or send a second one.
    uniqueIndex("email_messages_one_open_idx")
      .on(t.contactId)
      .where(sql`${t.status} in ('draft', 'approved', 'sending')`),
  ],
);

/** A shop's order system (WooCommerce), used to check purchases and read their amounts. */
export const storeConnections = pgTable("store_connections", {
  id: id(),
  siteId: uuid("site_id")
    .notNull()
    .unique()
    .references(() => sites.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["woocommerce"] }).notNull(),
  storeUrl: text("store_url").notNull(),
  consumerKey: text("consumer_key").notNull(),
  /** encryptSecret(); never sent to a browser. */
  consumerSecretEnc: text("consumer_secret_enc").notNull(),
  status: text("status", { enum: ["connected", "failing"] })
    .notNull()
    .default("connected"),
  lastError: text("last_error"),
  verifiedAt: timestamp("verified_at").notNull(),
  createdAt: createdAt(),
});

/** A person who bought from the shop. Separate from contacts: they never agreed to chat emails. */
export const buyers = pgTable(
  "buyers",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    firstName: text("first_name"),
    status: text("status", { enum: ["subscribed", "unsubscribed"] }).notNull(),
    /** Unsubscribes; never leaves the emails we send this person. */
    token: text("token").notNull().unique(),
    /** The attribution reference added to links (cc_ref). */
    ref: text("ref").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("buyers_site_email_idx").on(t.siteId, t.email)],
);

/** One order of a buyer, with what was in it. */
export const buyerOrders = pgTable(
  "buyer_orders",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => buyers.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    orderedAt: timestamp("ordered_at").notNull(),
    items: jsonb("items")
      .$type<{ productId: number; name: string; url: string | null }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("buyer_orders_site_external_idx").on(t.siteId, t.externalId),
    index("buyer_orders_buyer_idx").on(t.buyerId, t.orderedAt),
  ],
);

/**
 * The two follow-up emails of one order. A row starts "scheduled" (not yet written) and becomes a draft or
 * an approved email when it is due, like email_messages.
 */
export const buyerEmails = pgTable(
  "buyer_emails",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => buyers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => buyerOrders.id, { onDelete: "cascade" }),
    /** 1: about 5 days after the order (using it); 2: about 14 days after (feedback, related products). */
    step: integer("step").notNull(),
    status: text("status", {
      enum: ["scheduled", "draft", "approved", "sending", "sent", "discarded", "failed", "skipped"],
    }).notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    language: text("language").notNull(),
    links: jsonb("links").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    scheduledFor: timestamp("scheduled_for").notNull(),
    sentAt: timestamp("sent_at"),
    providerId: text("provider_id"),
    /** Failed writes while scheduled, then failed sends once written. */
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    clickedAt: timestamp("clicked_at"),
    lastClickedAt: timestamp("last_clicked_at"),
    clicks: integer("clicks").notNull().default(0),
    /** Secret in the email's "leave feedback" link. */
    feedbackToken: text("feedback_token")
      .notNull()
      .unique()
      .$defaultFn(() => randomBytes(24).toString("base64url")),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("buyer_emails_status_scheduled_idx").on(t.status, t.scheduledFor),
    index("buyer_emails_buyer_idx").on(t.buyerId, t.createdAt),
    index("buyer_emails_order_idx").on(t.orderId),
    // At most one written, unsent email per buyer: overlapping ticks can't write or send a second one.
    uniqueIndex("buyer_emails_one_open_idx")
      .on(t.buyerId)
      .where(sql`${t.status} in ('draft', 'approved', 'sending')`),
  ],
);

/** A buyer's rating and comment on the products of one buyer email. A second submission updates the row. */
export const buyerFeedback = pgTable(
  "buyer_feedback",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    buyerEmailId: uuid("buyer_email_id")
      .notNull()
      .references(() => buyerEmails.id, { onDelete: "cascade" }),
    /** 1 to 5. */
    rating: integer("rating").notNull(),
    /** Visitor-written text: never rendered as HTML. At most 2000 characters. */
    comment: text("comment").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("buyer_feedback_email_idx").on(t.buyerEmailId),
    index("buyer_feedback_site_idx").on(t.siteId, t.createdAt),
    check("buyer_feedback_rating_check", sql`${t.rating} between 1 and 5`),
    check("buyer_feedback_comment_check", sql`char_length(${t.comment}) <= 2000`),
  ],
);

/**
 * Addresses that must never be emailed again by a site, whichever track: kept after "Delete all data"
 * and when an unsubscribed buyer is pruned. Holds a hash of the address, never the address.
 */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** sha256 of the lowercased address, base64url. */
    emailHash: text("email_hash").notNull(),
    reason: text("reason", { enum: ["erased", "unsubscribed"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_suppressions_site_hash_idx").on(t.siteId, t.emailHash)],
);

/** A purchase attributed to the bot. Unattributed orders are never stored. */
export const sales = pgTable(
  "sales",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["woocommerce", "page"] }).notNull(),
    externalId: text("external_id"),
    verified: boolean("verified").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: text("currency"),
    orderedAt: timestamp("ordered_at").notNull(),
    visitorSessionId: text("visitor_session_id").notNull(),
    pageUrl: text("page_url").notNull(),
    viaChat: boolean("via_chat").notNull().default(false),
    viaPrompt: boolean("via_prompt").notNull().default(false),
    viaEmail: boolean("via_email").notNull().default(false),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    promptImpressionId: uuid("prompt_impression_id").references(() => promptImpressions.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    emailMessageId: uuid("email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sales_order_idx")
      .on(t.siteId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex("sales_page_idx")
      .on(t.siteId, t.visitorSessionId, t.pageUrl)
      .where(sql`${t.externalId} is null`),
    index("sales_site_ordered_idx").on(t.siteId, t.orderedAt),
  ],
);

/** An invitation from the platform owner to set up an account (created with the invite). */
export const accountInvites = pgTable("account_invites", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  /** Lowercased. */
  email: text("email").notNull(),
  /** sha256 of the link's token; the token itself is never stored. */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  acceptedUserId: text("accepted_user_id"),
  createdAt: createdAt(),
});

/** Warnings already emailed to an account's owners, once per period. */
export const accountNotices = pgTable(
  "account_notices",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** `YYYY-MM` for usage notices, `trial` for trial reminders. */
    period: text("period").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("account_notices_once_idx").on(t.accountId, t.period, t.kind)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull().default(0),
  createdAt: createdAt(),
});

export type Account = typeof accounts.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type SiteGreeting = typeof siteGreetings.$inferSelect;
export type KbSource = typeof kbSources.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type SiteInsight = typeof siteInsights.$inferSelect;
export type PromptImpression = typeof promptImpressions.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type StoreConnection = typeof storeConnections.$inferSelect;
export type Buyer = typeof buyers.$inferSelect;
export type BuyerOrder = typeof buyerOrders.$inferSelect;
export type BuyerEmail = typeof buyerEmails.$inferSelect;
export type BuyerFeedback = typeof buyerFeedback.$inferSelect;
export type AccountInvite = typeof accountInvites.$inferSelect;
