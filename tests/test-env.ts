import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_DATABASE_URL = "postgres://concierge:concierge@localhost:5433/concierge_test";

/** Forces the test environment; never points at the dev database. */
export function applyTestEnv() {
  Object.assign(process.env, {
    DATABASE_URL: TEST_DATABASE_URL,
    APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
    FAKE_MODEL: "true",
    FAKE_EMBEDDINGS: "true",
    STORAGE_DRIVER: "local",
  });
  process.env.STORAGE_LOCAL_DIR ??= mkdtempSync(join(tmpdir(), "concierge-storage-"));
}
