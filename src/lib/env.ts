import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    APP_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CHAT_MODEL: z.string().min(1).default("claude-opus-5-5"),
    VOYAGE_API_KEY: z.string().min(1).optional(),
    FAKE_MODEL: bool,
    FAKE_EMBEDDINGS: bool,
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default("./.storage"),
    S3_ENDPOINT: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    PLATFORM_OWNER_EMAILS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
  })
  .superRefine((e, ctx) => {
    const need = (name: string, ok: boolean, why: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [name], message: `${name} is required ${why}` });
    };
    need("ANTHROPIC_API_KEY", e.FAKE_MODEL || !!e.ANTHROPIC_API_KEY, "unless FAKE_MODEL=true");
    need("VOYAGE_API_KEY", e.FAKE_EMBEDDINGS || !!e.VOYAGE_API_KEY, "unless FAKE_EMBEDDINGS=true");
    if (e.STORAGE_DRIVER === "s3") {
      for (const k of [
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const) {
        need(k, !!e[k], "when STORAGE_DRIVER=s3");
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  // Treat empty strings (e.g. `KEY=` in .env files) as unset.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Memoized parse of process.env. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * Lazily-parsed view of the environment. Behaves like a plain object for
 * property reads, `in`, Object.keys and spreading; parsing happens on first use.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_t, prop) => (prop === "then" ? undefined : Reflect.get(getEnv(), prop)),
  has: (_t, prop) => Reflect.has(getEnv(), prop),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: (_t, prop) => {
    const d = Reflect.getOwnPropertyDescriptor(getEnv(), prop);
    return d && { ...d, configurable: true };
  },
  set: () => false,
  defineProperty: () => false,
  deleteProperty: () => false,
});
