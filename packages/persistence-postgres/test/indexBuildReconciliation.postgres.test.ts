import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import { ScopeEpochSchema, ScopeIdSchema } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  IndexBuildReconciliationIntegrationV1Error,
  reconcilePublishedIndexBuildsV1Effect,
} from
  "../src/indexBuildReconciliation";
import {
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describePostgres("real PostgreSQL S03-D3 reconciliation", () => {
  it("proves atomic replay, fencing, concurrency, and bounded restart", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      const version = await persistence.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      const concurrent = await Promise.all(Array.from(
        { length: 12 },
        () => reconcile(fixture),
      ));
      expect(concurrent.filter((result) =>
        result.status === "reconciled" && result.disposition === "created"
      )).toHaveLength(1);
      expect(concurrent.filter((result) =>
        result.status === "reconciled" && result.disposition === "replayed"
      )).toHaveLength(11);

      await persistence.query(
        `update fx_system_scope_clock
         set storage_generation_fence = 2, epoch = $2, last_commit_seq = 25
         where scope_id = $1`,
        [fixture.scopeId, "epoch_s03_d3_pg_2"],
      );
      const redeployed = await reconcile(fixture);
      expect(redeployed).toMatchObject({
        disposition: "redeployed",
        redeclaredCount: 2,
        storageGenerationFence: 2n,
      });

      await persistence.query(
        `delete from fx_system_index_build_state where scope_id = $1`,
        [fixture.scopeId],
      );
      const rollbackFailure = await runEffectFailure(
        reconcilePublishedIndexBuildsV1Effect(
        fixture.ports,
        fixture.input,
        { faultAfter: () => { throw new Error("postgres rollback"); } },
      ));
      expect(rollbackFailure).toBeInstanceOf(
        IndexBuildReconciliationIntegrationV1Error,
      );
      const afterRollback = await persistence.query<{ count: string }>(
        `select count(*)::text as count
         from fx_system_index_build_state where scope_id = $1`,
        [fixture.scopeId],
      );
      expect(afterRollback.rows[0]?.count).toBe("0");

      const resumed = await reconcile(fixture);
      expect(resumed).toMatchObject({ disposition: "created", createdCount: 2 });
      const exact = await persistence.query<{
        count: string;
        minimum_fence: string;
        maximum_fence: string;
        minimum_frontier: string;
        maximum_frontier: string;
      }>(
        `select count(*)::text as count,
                min(attempt_fence)::text as minimum_fence,
                max(attempt_fence)::text as maximum_fence,
                min(start_commit_seq)::text as minimum_frontier,
                max(start_commit_seq)::text as maximum_frontier
           from fx_system_index_build_state where scope_id = $1`,
        [fixture.scopeId],
      );
      expect(exact.rows[0]).toEqual({
        count: "2",
        minimum_fence: "1",
        maximum_fence: "1",
        minimum_frontier: "25",
        maximum_frontier: "25",
      });
    });
  }, 120_000);
});

async function fixtureFor(persistence: PostgresFlarexPersistence) {
  const deploymentId = "deployment_s03_d3_postgres";
  const scopeId = ScopeIdSchema.make("scope_s03_d3_postgres");
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    "schema_s03_d3_postgres",
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_s03_d3_postgres",
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, ScopeEpochSchema.make("epoch_s03_d3_postgres")],
  );
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [{
      logicalName: "users",
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: {
          type: "object",
          value: {
            email: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
      },
    }],
    indexes: [{
      tableLogicalName: "users",
      descriptor: "byEmail",
      fields: ["email"],
    }],
  });
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    persistence,
    LOCATOR,
  );
  return {
    scopeId,
    input: { deploymentId, schemaVersionId },
    ports: {
      controlDb: persistence.drizzle,
      authority: {
        scopeMetadata: {
          getScopeMetadataByDeploymentId: (value: string) =>
            persistence.getScopeMetadataByDeploymentId(value),
        },
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => null,
        },
        scopeClockTargets: { resolve: async () => target },
      },
    },
  } as const;
}

function reconcile(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
) {
  return runEffect(reconcilePublishedIndexBuildsV1Effect(
    fixture.ports,
    fixture.input,
  ));
}
