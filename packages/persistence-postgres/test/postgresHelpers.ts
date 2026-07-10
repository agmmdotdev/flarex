import { Pool } from "pg";

import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";

export const postgresUrl = normalizePostgresUrl(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

export async function withTemporaryPostgresPersistence(
  fn: (persistence: PostgresFlarexPersistence) => Promise<void>,
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_test");
  const migrationsSchema = temporaryIdentifier("flarex_migrations");
  const adminPool = new Pool({ connectionString });
  let persistence: PostgresFlarexPersistence | undefined;
  let primaryError: unknown;

  try {
    await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await adminPool.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
    persistence = await createPostgresPersistence({
      connectionString,
      migrationsSchema,
      poolConfig: {
        options: `-c search_path=${schemaName}`,
      },
    });
    await persistence.migrate();
    await fn(persistence);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const persistenceToClose = persistence;
    if (persistenceToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => persistenceToClose.close());
    }
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new Error(
        `Failed to clean up temporary Postgres schemas: ${cleanupErrors
          .map(errorMessage)
          .join("; ")}`,
      );
    }
  }
}

export async function withTemporaryPostgresPersistencePair(
  fn: (
    control: PostgresFlarexPersistence,
    target: PostgresFlarexPersistence,
  ) => Promise<void>,
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const controlSchema = temporaryIdentifier("flarex_control_test");
  const controlMigrationsSchema = temporaryIdentifier(
    "flarex_control_migrations",
  );
  const targetSchema = temporaryIdentifier("flarex_target_test");
  const targetMigrationsSchema = temporaryIdentifier(
    "flarex_target_migrations",
  );
  const schemaNames = [
    controlSchema,
    controlMigrationsSchema,
    targetSchema,
    targetMigrationsSchema,
  ] as const;
  const adminPool = new Pool({ connectionString });
  let control: PostgresFlarexPersistence | undefined;
  let target: PostgresFlarexPersistence | undefined;
  let primaryError: unknown;

  try {
    for (const schemaName of schemaNames) {
      await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    }
    [control, target] = await Promise.all([
      createPostgresPersistence({
        connectionString,
        migrationsSchema: controlMigrationsSchema,
        poolConfig: { options: `-c search_path=${controlSchema}` },
      }),
      createPostgresPersistence({
        connectionString,
        migrationsSchema: targetMigrationsSchema,
        poolConfig: { options: `-c search_path=${targetSchema}` },
      }),
    ]);
    await Promise.all([control.migrate(), target.migrate()]);
    await fn(control, target);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const controlToClose = control;
    if (controlToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => controlToClose.close());
    }
    const targetToClose = target;
    if (targetToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => targetToClose.close());
    }
    for (const schemaName of schemaNames) {
      await recordCleanupError(cleanupErrors, () =>
        adminPool.query(
          `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
        ),
      );
    }
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new Error(
        `Failed to clean up paired temporary Postgres schemas: ${cleanupErrors
          .map(errorMessage)
          .join("; ")}`,
      );
    }
  }
}

function requiredPostgresUrl(): string {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  return postgresUrl;
}

function normalizePostgresUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function temporaryIdentifier(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function recordCleanupError(
  errors: unknown[],
  cleanup: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
