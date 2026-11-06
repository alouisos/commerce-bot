import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";
import { lazy } from "@/lib/lazy";

const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

function createDb() {
  const sql = (globalForDb.__sql ??= postgres(env.DATABASE_URL, { max: 10 }));
  return drizzle(sql, { schema });
}

/** Connects on first use, so importing this module needs no env (e.g. during `next build`). */
export const db = lazy(createDb);
