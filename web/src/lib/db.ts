import "server-only";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";

type Sql = postgres.Sql<Record<string, never>>;

const globalForDb = globalThis as unknown as { hlSql: Sql | undefined; hlReadonlySql: Sql | undefined };

/** Read-write connection pool for the app (one per server process, survives dev HMR). */
export function sql(): Sql {
  if (globalForDb.hlSql === undefined) {
    globalForDb.hlSql = postgres(serverEnv().databaseUrl, { max: 10 });
  }
  return globalForDb.hlSql;
}

/** Connection as `hl_readonly`: SELECT on `readiness_v` only, read-only transactions, 3 s timeout. */
export function readonlySql(): Sql {
  if (globalForDb.hlReadonlySql === undefined) {
    globalForDb.hlReadonlySql = postgres(serverEnv().readonlyDatabaseUrl, { max: 2 });
  }
  return globalForDb.hlReadonlySql;
}
