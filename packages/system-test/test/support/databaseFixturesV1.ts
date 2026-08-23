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
import { expect, onTestFinished } from "vitest";

import {
  withHistoricalApplicationAnalysisMigrations,
} from "./historicalApplicationAnalysisMigrations";

let migratedDataDirPromise: Promise<Blob | File> | undefined;

export const postgresUrl = trimToNonBlankOrNull(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

export interface TemporaryPostgresSchemaOptionsV1 {
  readonly connectionString: string;
  readonly migrationsSchema: string;
  readonly poolConfig: PoolConfig;
}

export async function expectOrdinaryPostgres18(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const role = await persistence.query<{
    is_superuser: boolean;
    can_create_database: boolean;
    can_create_role: boolean;
  }>(`
    select rolsuper as is_superuser,
           rolcreatedb as can_create_database,
           rolcreaterole as can_create_role
    from pg_roles
    where rolname = current_user
  `);
  expect(role.rows[0]).toMatchObject({
    is_superuser: false,
    can_create_database: false,
    can_create_role: false,
  });
  const version = await persistence.query<{ server_version: string }>(
    "show server_version",
  );
  expect(version.rows[0]?.server_version).toMatch(/^18\./);
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

export async function createMigratedSplitPGlitePersistence(): Promise<
  Readonly<{
    readonly control: PGliteFlarexPersistence;
    readonly target: PGliteFlarexPersistence;
  }>
> {
  const [control, target] = await Promise.all([
    createMigratedPGlitePersistence(),
    createMigratedPGlitePersistence(),
  ]);
  return Object.freeze({ control, target });
}

export async function createHistoricalApplicationAnalysisPGlitePersistence(): Promise<
  PGliteFlarexPersistence
> {
  const db = new PGlite();
  try {
    const persistence = await withHistoricalApplicationAnalysisMigrations(
      async migrationsFolder => {
        const current = await createPGlitePersistence({
          db,
          migrationsFolder,
        });
        await current.migrate();
        return current;
      },
    );
    onTestFinished(() => db.close());
    return persistence;
  } catch (cause: unknown) {
    await db.close();
    throw cause;
  }
}

export async function withTemporaryPostgresPersistence(
  run: (persistence: PostgresFlarexPersistence) => Promise<void>,
  options: Readonly<{
    readonly migrationsFolder?: string;
    readonly historicalApplicationAnalysis?: boolean;
  }> = {},
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
    const create = async (migrationsFolder: string | undefined) => {
      const current = await createPostgresPersistence({
        connectionString: postgresUrl,
        migrationsSchema,
        ...(migrationsFolder === undefined ? {} : { migrationsFolder }),
        poolConfig: { options: `-c search_path=${schemaName}` },
      });
      await current.migrate();
      return current;
    };
    persistence = options.historicalApplicationAnalysis === true
      ? await withHistoricalApplicationAnalysisMigrations(create)
      : await create(options.migrationsFolder);
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

export async function withTemporarySplitPostgresPersistence<A>(
  run: (persistence: Readonly<{
    readonly control: PostgresFlarexPersistence;
    readonly target: PostgresFlarexPersistence;
  }>) => Promise<A>,
): Promise<A> {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  const suffix = randomBytes(12).toString("hex");
  const controlSchema = `flarex_system_test_control_${suffix}`;
  const targetSchema = `flarex_system_test_target_${suffix}`;
  const migrationsSchema = `flarex_system_test_migrations_${suffix}`;
  const adminPool = new Pool({ connectionString: postgresUrl });
  let control: PostgresFlarexPersistence | undefined;
  let target: PostgresFlarexPersistence | undefined;
  let hasPrimaryCause = false;
  try {
    await adminPool.query(`create schema ${quoteIdentifierV1(controlSchema)}`);
    await adminPool.query(`create schema ${quoteIdentifierV1(targetSchema)}`);
    await adminPool.query(`create schema ${quoteIdentifierV1(migrationsSchema)}`);
    control = await createPostgresPersistence({
      connectionString: postgresUrl,
      migrationsSchema,
      migrationsTable: `control_${suffix}`,
      poolConfig: { options: `-c search_path=${controlSchema}` },
    });
    target = await createPostgresPersistence({
      connectionString: postgresUrl,
      migrationsSchema,
      migrationsTable: `target_${suffix}`,
      poolConfig: { options: `-c search_path=${targetSchema}` },
    });
    await Promise.all([control.migrate(), target.migrate()]);
    return await run(Object.freeze({ control, target }));
  } catch (cause: unknown) {
    hasPrimaryCause = true;
    throw cause;
  } finally {
    const cleanupCauses: unknown[] = [];
    if (control !== undefined) {
      const activeControl = control;
      await captureCleanupV1(cleanupCauses, () => activeControl.close());
    }
    if (target !== undefined) {
      const activeTarget = target;
      await captureCleanupV1(cleanupCauses, () => activeTarget.close());
    }
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifierV1(controlSchema)} cascade`,
      )
    );
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifierV1(targetSchema)} cascade`,
      )
    );
    await captureCleanupV1(cleanupCauses, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifierV1(migrationsSchema)} cascade`,
      )
    );
    await captureCleanupV1(cleanupCauses, () => adminPool.end());
    if (!hasPrimaryCause && cleanupCauses.length > 0) {
      throw new Error(
        "Failed to clean up the split system-test PostgreSQL fixture.",
        { cause: cleanupCauses },
      );
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
