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
import { Client } from "pg";
import { Effect } from "effect";

import {
  createRequestScopedExecutorWorker,
  type RequestScopedExecutorWorkerDependencies,
} from "./requestLifecycle";
import { makeDeploymentProjectScopeLookupHostV1 } from "./deploymentProjectScopeLookup";
import { deploymentProjectScopeLookupPathV1 } from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { makeApplicationExecutorGateway, type ExecutorApplicationGatewayEnv } from "./applicationGateway";

export { FlarexApplication } from "./application";

const sharedScopePhysicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const productionDependencies = {
  createClient: connectionString => new Client({ connectionString }),
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
    return (request) => {
      const pathname = new URL(request.url).pathname;
      return pathname === deploymentProjectScopeLookupPathV1
        ? deploymentScopeLookup(request)
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

export function createExecutorWorker() {
  return makeApplicationExecutorGateway(createRequestScopedExecutorWorker(productionDependencies));
}

export default createExecutorWorker() satisfies ExportedHandler<ExecutorApplicationGatewayEnv>;
