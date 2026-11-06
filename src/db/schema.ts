import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
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
  lastCrawledAt: timestamp("last_crawled_at"),
  lastSeenAt: timestamp("last_seen_at"),
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
    createdAt: createdAt(),
  },
  (t) => [index("conversations_site_idx").on(t.siteId, t.lastMessageAt)],
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
  kind: text("kind", { enum: ["chat", "image_description"] }).notNull(),
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
  source: text("source", { enum: ["fallback"] })
    .notNull()
    .default("fallback"),
  createdAt: createdAt(),
});

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
