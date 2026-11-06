import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(32),
  ANTHROPIC_API_KEY: "sk-ant-test",
  VOYAGE_API_KEY: "pa-test",
};

describe("parseEnv", () => {
  it("requires ANTHROPIC_API_KEY unless FAKE_MODEL", () => {
    const noKey = { ...base, ANTHROPIC_API_KEY: undefined };
    expect(() => parseEnv({ ...noKey, FAKE_MODEL: "false" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(parseEnv({ ...noKey, FAKE_MODEL: "true" }).FAKE_MODEL).toBe(true);
  });

  it("requires VOYAGE_API_KEY unless FAKE_EMBEDDINGS", () => {
    const noKey = { ...base, VOYAGE_API_KEY: undefined };
    expect(() => parseEnv({ ...noKey, FAKE_EMBEDDINGS: "false" })).toThrow(/VOYAGE_API_KEY/);
    expect(parseEnv({ ...noKey, FAKE_EMBEDDINGS: "true" }).FAKE_EMBEDDINGS).toBe(true);
  });

  it("requires S3_* when STORAGE_DRIVER=s3", () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    const ok = parseEnv({
      ...base,
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "auto",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(ok.STORAGE_DRIVER).toBe("s3");
  });

  it("parses owner emails trimmed and lowercased", () => {
    expect(parseEnv({ ...base, PLATFORM_OWNER_EMAILS: " A@x.com, b@y.com " }).PLATFORM_OWNER_EMAILS).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
    expect(parseEnv(base).PLATFORM_OWNER_EMAILS).toEqual([]);
  });

  it("defaults CHAT_MODEL, STORAGE_DRIVER and STORAGE_LOCAL_DIR", () => {
    const e = parseEnv(base);
    expect(e.CHAT_MODEL).toBe("claude-opus-5-5");
    expect(e.STORAGE_DRIVER).toBe("local");
    expect(e.STORAGE_LOCAL_DIR).toBe("./.storage");
    expect(e.FAKE_MODEL).toBe(false);
    expect(e.FAKE_EMBEDDINGS).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const e = parseEnv({ ...base, RESEND_API_KEY: "", CHAT_MODEL: "" });
    expect(e.RESEND_API_KEY).toBeUndefined();
    expect(e.CHAT_MODEL).toBe("claude-opus-5-5");
  });
});

describe("env (lazy view)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("behaves like a plain object for keys, in and spread", async () => {
    for (const [k, v] of Object.entries({ ...base, FAKE_MODEL: "true", FAKE_EMBEDDINGS: "true" })) {
      vi.stubEnv(k, v);
    }
    const { env } = await import("@/lib/env");
    expect(Object.keys(env)).toContain("CHAT_MODEL");
    expect("CHAT_MODEL" in env).toBe(true);
    expect({ ...env }.CHAT_MODEL).toBe("claude-opus-5-5");
    expect((env as unknown as { then?: unknown }).then).toBeUndefined();
    expect(() => JSON.stringify(env)).not.toThrow();
  });
});
