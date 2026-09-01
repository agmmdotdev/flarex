import {
  createFlarexExecutor,
  withReadyDeploymentAuthority,
} from "@flarex/executor";
import { createFlarexExecutorFetchHandler } from "@flarex/executor-http/fetch";
import type { SharedDatabaseScopePhysicalLocator } from "@flarex/persistence-postgres";
import {
  createPostgresClientPersistence,
  createPostgresClientSharedScopeAuthorityProvisioner,
} from "@flarex/persistence-postgres/postgres-client";
import { createPostgresClientScopeSyncChangeSourceReaderV1 } from
  "@flarex/persistence-postgres/internal/scope-sync-change-source-read-v1";
import { Client, type ClientConfig } from "pg";
import { Effect } from "effect";

import {
  createRequestScopedExecutorWorker,
  type ExecutorWorker,
  type ExecutorWorkerEnv,
  type RequestScopedExecutorWorkerDependencies,
} from "./requestLifecycle";
import { makeDeploymentProjectScopeLookupHostV1 } from "./deploymentProjectScopeLookup";
import { deploymentProjectScopeLookupPathV1 } from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { querySyncSourceReadPathV1 } from
  "@flarex/executor-http/internal-query-sync-source-read-v1";
import { makeQuerySyncSourceReadHostV1 } from "./querySyncSourceRead";

const sharedScopePhysicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const productionDependencies = {
  createClient: (connectionString, request) => new Client(
    executorPostgresClientConfigForRequest(connectionString, request),
  ),
  createHandler: ({ client, capabilityToken }) => {
    const persistence = createPostgresClientPersistence(client);
    const executorPersistence = withReadyDeploymentAuthority(
      persistence,
      createPostgresClientSharedScopeAuthorityProvisioner(client, {
        physicalLocator: sharedScopePhysicalLocator,
      }),
    );
    const executorHandler = createFlarexExecutorFetchHandler({
      executor: createFlarexExecutor({ persistence: executorPersistence }),
      capabilityToken,
    });
    const deploymentScopeLookup = makeDeploymentProjectScopeLookupHostV1(
      persistence,
      {
        reportResourceFailure: ({ operation }) => Effect.logError(
          "Flarex deployment project-scope lookup failed.",
          Object.freeze({ operation, cause: "redacted" }),
        ),
      },
    );
    const querySyncSourceRead = makeQuerySyncSourceReadHostV1(
      createPostgresClientScopeSyncChangeSourceReaderV1(client),
      {
        reportResourceFailure: ({ operation }) => Effect.logError(
          "Flarex query-sync source read failed.",
          Object.freeze({ operation, cause: "redacted" }),
        ),
      },
    );
    return (request) => {
      const pathname = new URL(request.url).pathname;
      return pathname === deploymentProjectScopeLookupPathV1
        ? deploymentScopeLookup(request)
        : pathname === querySyncSourceReadPathV1
          ? querySyncSourceRead(request)
          : executorHandler(request);
    };
  },
  onCleanupError: ({ primaryError, cleanupError }) => {
    console.error("Flarex executor client cleanup failed after a primary error.", {
      primaryError,
      cleanupError,
    });
  },
} satisfies RequestScopedExecutorWorkerDependencies<Client>;

export function executorPostgresClientConfigForRequest(
  connectionString: string,
  request: Request,
): ClientConfig {
  return new URL(request.url).pathname === querySyncSourceReadPathV1
    ? Object.freeze({
        connectionString,
        connectionTimeoutMillis: 60_000,
        options: "-c statement_timeout=60000 -c transaction_timeout=60000",
        query_timeout: 60_000,
      })
    : Object.freeze({ connectionString });
}

export function createExecutorWorker(): ExecutorWorker {
  return createRequestScopedExecutorWorker(productionDependencies);
}

export default createExecutorWorker() satisfies ExportedHandler<ExecutorWorkerEnv>;
