import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

const sql = (globalForDb.__sql ??= postgres(env.DATABASE_URL, { max: 10 }));

export const db = drizzle(sql, { schema });
export { sql };
