import { PGlite } from "@electric-sql/pglite";

import type {
  FlarexMigrationResult,
  FlarexPersistence,
  FlarexPersistenceCheck,
  FlarexPersistenceTx,
  QueryResult,
} from "./index";
import { runMigrations } from "./index";

type PGliteLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  transaction<T>(fn: (tx: PGliteTransactionLike) => Promise<T>): Promise<T>;
};

type PGliteTransactionLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
};

export interface PGlitePersistenceOptions {
  dataDir?: string;
  db?: PGliteLike;
}

export async function createPGlitePersistence(
  options: PGlitePersistenceOptions = {},
): Promise<FlarexPersistence> {
  const db: PGliteLike =
    options.db ?? (new PGlite(options.dataDir) as unknown as PGliteLike);

  return {
    exec: (sql) => db.exec(sql),
    query: (sql, params) => db.query(sql, params),

    async check(): Promise<FlarexPersistenceCheck> {
      await db.query("select 1 as ok");
      return { status: "ok" };
    },

    migrate(): Promise<FlarexMigrationResult> {
      return runMigrations(db);
    },

    transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T> {
      return db.transaction((tx) => fn(tx));
    },
  };
}
