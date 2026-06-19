import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import type {
  FlarexMigrationResult,
  FlarexPersistence,
  FlarexPersistenceCheck,
  FlarexPersistenceTx,
  FlarexSqlClient,
  QueryResult,
} from "./index";
import { FLAREX_MIGRATIONS, type FlarexMigration } from "./index";
import { flarexSchema, schemaMigrations } from "./schema";

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

export interface PGliteFlarexPersistence extends FlarexPersistence {
  drizzle: PgliteDatabase<typeof flarexSchema>;
}

export async function createPGlitePersistence(
  options: PGlitePersistenceOptions = {},
): Promise<PGliteFlarexPersistence> {
  const db: PGliteLike =
    options.db ?? (new PGlite(options.dataDir) as unknown as PGliteLike);
  const drizzleDb = drizzle({
    client: db as unknown as PGlite,
    schema: flarexSchema,
  });

  return {
    drizzle: drizzleDb,
    exec: (sql) => db.exec(sql),
    query: (sql, params) => db.query(sql, params),

    async check(): Promise<FlarexPersistenceCheck> {
      await db.query("select 1 as ok");
      return { status: "ok" };
    },

    migrate(): Promise<FlarexMigrationResult> {
      return runDrizzleMigrations(db, drizzleDb);
    },

    transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T> {
      return db.transaction((tx) => fn(tx));
    },
  };
}

async function runDrizzleMigrations(
  client: FlarexSqlClient,
  db: PgliteDatabase<typeof flarexSchema>,
  migrations: readonly FlarexMigration[] = FLAREX_MIGRATIONS,
): Promise<FlarexMigrationResult> {
  await client.exec(`
    create table if not exists flarex_schema_migrations (
      version integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const applied: FlarexMigration[] = [];

  for (const migration of migrations) {
    const existing = await db
      .select({ version: schemaMigrations.version })
      .from(schemaMigrations)
      .where(eq(schemaMigrations.version, migration.version))
      .limit(1);

    if (existing.length > 0) {
      continue;
    }

    await client.exec(migration.sql);
    await db.insert(schemaMigrations).values({
      version: migration.version,
      name: migration.name,
    });
    applied.push(migration);
  }

  return { applied };
}
