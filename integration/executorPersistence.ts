import {
  withReadyDeploymentAuthority,
  type FlarexExecutorPersistence,
} from "@flarex/executor";
import type { SharedDatabaseScopePhysicalLocator } from "@flarex/persistence-postgres";
import {
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";

const integrationSharedScopePhysicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "integration",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

export function withPGliteIntegrationDeploymentAuthority(
  persistence: PGliteFlarexPersistence,
): FlarexExecutorPersistence {
  return withReadyDeploymentAuthority(
    persistence,
    createPGliteSharedScopeAuthorityProvisioner(persistence, {
      physicalLocator: integrationSharedScopePhysicalLocator,
    }),
  );
}
