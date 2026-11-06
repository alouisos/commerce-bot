import { afterEach, describe, expect, it, vi } from "vitest";

// `next build` imports route modules to collect page data without the runtime env, so nothing may read
// env at module load.
const VARS = ["DATABASE_URL", "APP_URL", "BETTER_AUTH_SECRET", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY", "FAKE_MODEL", "FAKE_EMBEDDINGS"];

describe("modules load without the runtime env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("db client, auth and the auth route import cleanly; env is only parsed on first use", async () => {
    for (const k of VARS) vi.stubEnv(k, undefined);
    vi.resetModules();
    const { db } = await import("@/db/client");
    const { auth } = await import("@/lib/auth");
    await import("@/app/api/auth/[...all]/route");
    expect(() => db.select).toThrow(/Invalid environment/);
    expect(() => auth.api).toThrow(/Invalid environment/);
  });
});
