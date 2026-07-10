import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";

import type { FlarexRuntimePersistence } from "./index";
import { createFlarexRuntimePersistence } from "./runtimePersistence";
import {
  createPostgresSqlClient,
  runPostgresTransaction,
} from "./postgresRuntime";
import {
  createPostgresSharedScopeAuthorityProvisioner,
} from "./postgresSharedScopeAuthority";
import type {
  SharedScopeAuthorityProvisioner,
  SharedScopeAuthorityProvisionerOptions,
} from "./scopeAuthorityProvisioning";
import { flarexSchema } from "./schema";

export type PostgresClientFlarexPersistence = FlarexRuntimePersistence;

/**
 * Adapt an already-connected, request-scoped client. The caller owns
 * connect/end lifecycle; this adapter owns only transaction demarcation.
 */
export function createPostgresClientPersistence(
  client: Client,
): PostgresClientFlarexPersistence {
  const drizzleDb = drizzle(client, { schema: flarexSchema });
  const runtime = createFlarexRuntimePersistence({
    drizzle: drizzleDb,
    sql: createPostgresSqlClient(drizzleDb, client),
    transaction: (run) => runPostgresTransaction(client, drizzleDb, run),
  });

  return runtime;
}

export function createPostgresClientSharedScopeAuthorityProvisioner(
  client: Client,
  options: SharedScopeAuthorityProvisionerOptions,
): SharedScopeAuthorityProvisioner {
  return createPostgresSharedScopeAuthorityProvisioner(
    { drizzle: drizzle(client, { schema: flarexSchema }) },
    options,
  );
}

export {
  InvalidGeneratedScopeAuthorityIdError,
  ScopeAuthorityIdGenerationExhaustedError,
  SharedScopeAuthorityConflictError,
  SharedScopeAuthorityProvisioningStatuses,
  UnsupportedScopeAuthorityProvisioningTopologyError,
  type EnsureSharedScopeAuthorityInput,
  type EnsureSharedScopeAuthorityResult,
  type SharedScopeAuthorityConflict,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
  type SharedScopeAuthorityProvisioningStatus,
} from "./scopeAuthorityProvisioning";
