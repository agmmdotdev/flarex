import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPostgresSharedScopeAuthorityProvisioner,
  InvalidGeneratedScopeAuthorityIdError,
  SharedScopeAuthorityConflictError,
  type PostgresFlarexPersistence,
  type SharedScopeAuthorityProvisioner,
} from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const sharedLocator = {
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const;

const uuids = {
  scopeA: "10000000-0000-4000-8000-000000000001",
  epochA: "10000000-0000-4000-8000-000000000002",
  scopeB: "10000000-0000-4000-8000-000000000003",
  epochB: "10000000-0000-4000-8000-000000000004",
} as const;

describePostgres("real Postgres shared scope authority provisioning", () => {
  it("converges concurrent provisioners and survives response-loss retry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const first = provisioner(
        persistence,
        uuidSequence(uuids.scopeA, uuids.epochA),
      );
      const second = provisioner(
        persistence,
        uuidSequence(uuids.scopeB, uuids.epochB),
      );
      const input = {
        deploymentId: "deployment_pg_concurrent_provision",
        projectId: "project_pg_concurrent_provision",
      } as const;

      const results = await Promise.all([
        first.ensure(input),
        second.ensure(input),
      ]);

      expect(new Set(results.map((result) => result.scope.scopeId)).size).toBe(
        1,
      );
      expect(new Set(results.map((result) => result.clock.epoch)).size).toBe(1);
      expect(results.map((result) => result.status).sort()).toEqual([
        "already_provisioned",
        "created",
      ]);
      await expect(authorityCounts(persistence)).resolves.toEqual({
        deployments: "1",
        scopes: "1",
        clocks: "1",
      });

      const responseLossRetry = provisioner(persistence, () => {
        throw new Error("A completed retry must reuse persisted authority.");
      });
      const retried = await responseLossRetry.ensure(input);
      expect(retried).toMatchObject({
        status: "already_provisioned",
        scope: { scopeId: results[0]?.scope.scopeId },
        clock: { epoch: results[0]?.clock.epoch },
      });
    });
  });

  it("converges concurrent scope creation for an existing deployment", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_scope_race",
        projectId: "project_pg_scope_race",
      });
      const first = provisioner(
        persistence,
        uuidSequence(uuids.scopeA, uuids.epochA),
      );
      const second = provisioner(
        persistence,
        uuidSequence(uuids.scopeB, uuids.epochB),
      );
      const input = {
        deploymentId: "deployment_pg_scope_race",
        projectId: "project_pg_scope_race",
      } as const;

      const results = await Promise.all([
        first.ensure(input),
        second.ensure(input),
      ]);

      expect(new Set(results.map((result) => result.scope.scopeId)).size).toBe(
        1,
      );
      expect(results.map((result) => result.status).sort()).toEqual([
        "already_provisioned",
        "created_scope_and_clock",
      ]);
      await expect(authorityCounts(persistence)).resolves.toEqual({
        deployments: "1",
        scopes: "1",
        clocks: "1",
      });
    });
  });

  it("fails closed concurrently when an existing scope is missing its clock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make(`scope_${uuids.scopeA}`);
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_pg_missing_clock",
        projectId: "project_pg_missing_clock",
      });
      await persistence.insertScopeMetadata({
        scopeId,
        deploymentId: "deployment_pg_missing_clock",
        physicalLocator: sharedLocator,
      });
      const noRepairIds = () => {
        throw new Error("Normal provisioning must not repair a missing clock.");
      };
      const first = provisioner(persistence, noRepairIds);
      const second = provisioner(persistence, noRepairIds);
      const input = {
        deploymentId: "deployment_pg_missing_clock",
        projectId: "project_pg_missing_clock",
      } as const;
      const expectedConflict = {
        name: "SharedScopeAuthorityConflictError",
        conflict: {
          reason: "clockMissingForExistingScope",
          scopeId,
        },
      } as const;

      await Promise.all([
        expect(first.ensure(input)).rejects.toMatchObject(expectedConflict),
        expect(second.ensure(input)).rejects.toMatchObject(expectedConflict),
      ]);
      await expect(persistence.getScopeClock(scopeId)).resolves.toBeNull();
    });
  });

  it("rolls back deployment and locator when clock initialization fails", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const failing = provisioner(
        persistence,
        uuidSequence(uuids.scopeA, "invalid-epoch-uuid"),
      );

      await expect(
        failing.ensure({
          deploymentId: "deployment_pg_rollback",
          projectId: "project_pg_rollback",
        }),
      ).rejects.toBeInstanceOf(InvalidGeneratedScopeAuthorityIdError);
      await expect(authorityCounts(persistence)).resolves.toEqual({
        deployments: "0",
        scopes: "0",
        clocks: "0",
      });
    });
  });

  it("rejects immutable locator conflicts without replacing authority", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const original = provisioner(
        persistence,
        uuidSequence(uuids.scopeA, uuids.epochA),
      );
      const created = await original.ensure({
        deploymentId: "deployment_pg_locator_conflict",
        projectId: "project_pg_locator_conflict",
      });
      const conflicting = createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        {
          physicalLocator: {
            ...sharedLocator,
            databaseKey: "secondary",
          },
          randomUuid: () => {
            throw new Error("A locator conflict must not allocate IDs.");
          },
        },
      );

      await expect(
        conflicting.ensure({
          deploymentId: "deployment_pg_locator_conflict",
          projectId: "project_pg_locator_conflict",
        }),
      ).rejects.toBeInstanceOf(SharedScopeAuthorityConflictError);
      await expect(
        persistence.getScopeMetadataByDeploymentId(
          "deployment_pg_locator_conflict",
        ),
      ).resolves.toEqual(created.scope);
      await expect(
        persistence.getScopeClock(created.scope.scopeId),
      ).resolves.toEqual(created.clock);
    });
  });
});

function provisioner(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
): SharedScopeAuthorityProvisioner {
  return createPostgresSharedScopeAuthorityProvisioner(persistence, {
    physicalLocator: sharedLocator,
    randomUuid,
  });
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("UUID test sequence was exhausted.");
    }
    index += 1;
    return value;
  };
}

async function authorityCounts(
  persistence: Pick<PostgresFlarexPersistence, "query">,
): Promise<{
  readonly deployments: string;
  readonly scopes: string;
  readonly clocks: string;
}> {
  const result = await persistence.query<{
    deployments: string;
    scopes: string;
    clocks: string;
  }>(`
    select
      (select count(*)::text from deployments) as deployments,
      (select count(*)::text from fx_control_scope) as scopes,
      (select count(*)::text from fx_system_scope_clock) as clocks
  `);
  const counts = result.rows[0];
  if (counts === undefined) {
    throw new Error("Authority count query returned no row.");
  }
  return counts;
}
