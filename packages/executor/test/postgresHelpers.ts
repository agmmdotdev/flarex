import { Pool } from "pg";
import type { SharedDatabaseScopePhysicalLocator } from "@flarex/persistence-postgres";
import { trimToNonBlankOrNull } from "@flarex/utils/strings";

import {
  createPostgresPersistence,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import {
  withReadyDeploymentAuthority,
  type FlarexExecutorPersistence,
} from "../src";

export const postgresUrl = trimToNonBlankOrNull(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

export async function withTemporaryPostgresExecutorPersistence(
  fn: (
    persistence: PostgresFlarexPersistence,
    executorPersistence: FlarexExecutorPersistence,
    scopePhysicalLocator: SharedDatabaseScopePhysicalLocator,
  ) => Promise<void>,
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_executor_test");
  const migrationsSchema = temporaryIdentifier("flarex_executor_migrations");
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
    const scopePhysicalLocator = Object.freeze({
      kind: "shared_database",
      databaseKey: "executor_test",
      schemaName,
    }) satisfies SharedDatabaseScopePhysicalLocator;
    const executorPersistence = withReadyDeploymentAuthority(
      persistence,
      createPostgresSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: scopePhysicalLocator,
      }),
    );
    await fn(persistence, executorPersistence, scopePhysicalLocator);
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

function requiredPostgresUrl(): string {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  return postgresUrl;
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
