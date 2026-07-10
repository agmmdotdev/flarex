import {
  createFlarexExecutor,
  withReadyDeploymentAuthority,
} from "@flarex/executor";
import { createFlarexHttpHandler } from "@flarex/executor-http";
import type { SharedDatabaseScopePhysicalLocator } from "@flarex/persistence-postgres";
import {
  createPostgresClientPersistence,
  createPostgresClientSharedScopeAuthorityProvisioner,
} from "@flarex/persistence-postgres/postgres-client";
import { Client } from "pg";

import {
  createRequestScopedExecutorWorker,
  type ExecutorWorker,
  type ExecutorWorkerEnv,
  type RequestScopedExecutorWorkerDependencies,
} from "./requestLifecycle";

const sharedScopePhysicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const productionDependencies = {
  createClient: (connectionString) => new Client({ connectionString }),
  createHandler: ({ client, capabilityToken }) => {
    const persistence = createPostgresClientPersistence(client);
    const executorPersistence = withReadyDeploymentAuthority(
      persistence,
      createPostgresClientSharedScopeAuthorityProvisioner(client, {
        physicalLocator: sharedScopePhysicalLocator,
      }),
    );
    return createFlarexHttpHandler({
      executor: createFlarexExecutor({ persistence: executorPersistence }),
      capabilityToken,
    });
  },
  onCleanupError: ({ primaryError, cleanupError }) => {
    console.error("Flarex executor client cleanup failed after a primary error.", {
      primaryError,
      cleanupError,
    });
  },
} satisfies RequestScopedExecutorWorkerDependencies<Client>;

export function createExecutorWorker(): ExecutorWorker {
  return createRequestScopedExecutorWorker(productionDependencies);
}

export default createExecutorWorker() satisfies ExportedHandler<ExecutorWorkerEnv>;
