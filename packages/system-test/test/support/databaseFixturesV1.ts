import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import { trimToNonBlankOrNull } from "@flarex/utils/strings";
import { Pool, type PoolConfig } from "pg";
import { onTestFinished } from "vitest";

let migratedDataDirPromise: Promise<Blob | File> | undefined;

export const postgresUrl = trimToNonBlankOrNull(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

export interface TemporaryPostgresSchemaOptionsV1 {
  readonly connectionString: string;
  readonly migrationsSchema: string;
  readonly poolConfig: PoolConfig;
}

export async function createMigratedPGlitePersistence(): Promise<
  PGliteFlarexPersistence
> {
  migratedDataDirPromise ??= buildMigratedDataDirV1();
  const db = await PGlite.create({ loadDataDir: await migratedDataDirPromise });
  try {
    const persistence = await createPGlitePersistence({ db });
    onTestFinished(() => db.close());
    return persistence;
  } catch (cause: unknown) {
    await db.close();
    throw cause;
  }
}

export async function withTemporaryPostgresPersistence(
  run: (persistence: PostgresFlarexPersistence) => Promise<void>,
): Promise<void> {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  const suffix = randomBytes(12).toString("hex");
  const schemaName = `flarex_system_test_${suffix}`;
  const migrationsSchema = `flarex_system_test_migrations_${suffix}`;
  const adminPool = new Pool({ connectionString: postgresUrl });
  let persistence: PostgresFlarexPersistence | undefined;
  let primaryCause: unknown;
  try {
    await adminPool.query(`create schema ${quoteIdentifierV1(schemaName)}`);
    await adminPool.query(`create schema ${quoteIdentifierV1(migrationsSchema)}`);
    persistence = await createPostgresPersistence({
      connectionString: postgresUrl,
      migrationsSchema,
      poolConfig: { options: `-c search_path=${schemaName}` },
    });
    await persistence.migrate();
    await run(persistence);
  } catch (cause: unknown) {
    primaryCause = cause;
    throw cause;
  } finally {
    const cleanupCauses: unknown[] = [];
    if (persistence !== undefined) {
      const activePersistence = persistence;
      await captureCleanupV1(cleanupCauses, () => activePersistence.close());
    }
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(`drop schema if exists ${quoteIdentifierV1(schemaName)} cascade`)
    );
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifierV1(migrationsSchema)} cascade`,
      )
    );
    await captureCleanupV1(cleanupCauses, () => adminPool.end());
    if (primaryCause === undefined && cleanupCauses.length > 0) {
      throw new Error("Failed to clean up the system-test PostgreSQL fixture.", {
        cause: cleanupCauses,
      });
    }
  }
}

export async function withTemporaryPostgresSchema(
  run: (options: TemporaryPostgresSchemaOptionsV1) => Promise<void>,
): Promise<void> {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  const suffix = randomBytes(12).toString("hex");
  const schemaName = `flarex_system_test_migration_${suffix}`;
  const migrationsSchema = `flarex_system_test_receipts_${suffix}`;
  const adminPool = new Pool({ connectionString: postgresUrl });
  let primaryCause: unknown;
  try {
    await adminPool.query(`create schema ${quoteIdentifierV1(schemaName)}`);
    await adminPool.query(`create schema ${quoteIdentifierV1(migrationsSchema)}`);
    await run({
      connectionString: postgresUrl,
      migrationsSchema,
      poolConfig: { options: `-c search_path=${schemaName}` },
    });
  } catch (cause: unknown) {
    primaryCause = cause;
    throw cause;
  } finally {
    const cleanupCauses: unknown[] = [];
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(`drop schema if exists ${quoteIdentifierV1(schemaName)} cascade`)
    );
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifierV1(migrationsSchema)} cascade`,
      )
    );
    await captureCleanupV1(cleanupCauses, () => adminPool.end());
    if (primaryCause === undefined && cleanupCauses.length > 0) {
      throw new Error(
        "Failed to clean up the system-test PostgreSQL migration fixture.",
        { cause: cleanupCauses },
      );
    }
  }
}

async function buildMigratedDataDirV1(): Promise<Blob | File> {
  const db = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    return await db.dumpDataDir("none");
  } finally {
    await db.close();
  }
}

async function captureCleanupV1(
  causes: unknown[],
  cleanup: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (cause: unknown) {
    causes.push(cause);
  }
}

function quoteIdentifierV1(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
