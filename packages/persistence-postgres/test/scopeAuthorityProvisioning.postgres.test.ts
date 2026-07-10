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
        createdDeployment: false,
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

  it("holds the existing deployment project lock through authority commit", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_pg_project_lock";
      const projectId = "project_pg_project_lock";
      const advisoryKey = 93_021;
      await persistence.insertDeploymentMetadata({ deploymentId, projectId });
      await persistence.query(`
        create function flarex_scope_authority_test_gate()
        returns trigger
        language plpgsql
        as $function$
        begin
          perform pg_advisory_xact_lock(${advisoryKey});
          return new;
        end
        $function$;

        create trigger flarex_scope_authority_test_gate
        before insert on fx_control_scope
        for each row execute function flarex_scope_authority_test_gate();
      `);
      const gateClient = await persistence.pool.connect();
      const projectUpdateClient = await persistence.pool.connect();
      let gateHeld = false;
      let projectUpdateTransaction = false;

      try {
        await gateClient.query("select pg_advisory_lock($1)", [advisoryKey]);
        gateHeld = true;
        const ensurePromise = provisioner(
          persistence,
          uuidSequence(uuids.scopeA, uuids.epochA),
        ).ensure({ deploymentId, projectId });
        const authorityPid = await waitForAdvisoryWaiter(
          persistence,
          advisoryKey,
        );
        const pidResult = await projectUpdateClient.query<{ pid: number }>(
          "select pg_backend_pid()::integer as pid",
        );
        const projectUpdatePid = pidResult.rows[0]?.pid;
        if (projectUpdatePid === undefined) {
          throw new Error("Project update connection returned no backend PID.");
        }
        await projectUpdateClient.query("begin");
        projectUpdateTransaction = true;
        const projectUpdatePromise = projectUpdateClient.query(
          "update deployments set project_id = $2 where deployment_id = $1",
          [deploymentId, "project_replacement"],
        );

        const blockers = await waitForBlockingPids(
          persistence,
          projectUpdatePid,
        );
        expect(blockers).toContain(authorityPid);

        await gateClient.query("select pg_advisory_unlock($1)", [advisoryKey]);
        gateHeld = false;
        const [ensured] = await Promise.all([
          ensurePromise,
          projectUpdatePromise,
        ]);
        await projectUpdateClient.query("rollback");
        projectUpdateTransaction = false;

        expect(ensured).toMatchObject({
          status: "created_scope_and_clock",
          deployment: { deploymentId, projectId },
        });
        await expect(
          persistence.getDeploymentMetadata(deploymentId),
        ).resolves.toMatchObject({ projectId });
        await expect(
          persistence.getScopeMetadataByDeploymentId(deploymentId),
        ).resolves.toMatchObject({
          deploymentId,
          scopeId: `scope_${uuids.scopeA}`,
        });
      } finally {
        if (gateHeld) {
          await gateClient.query("select pg_advisory_unlock($1)", [advisoryKey]);
        }
        if (projectUpdateTransaction) {
          await projectUpdateClient.query("rollback");
        }
        gateClient.release();
        projectUpdateClient.release();
      }
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

async function waitForAdvisoryWaiter(
  persistence: Pick<PostgresFlarexPersistence, "query">,
  advisoryKey: number,
): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await persistence.query<{ pid: number }>(
      `
        select pid::integer as pid
        from pg_locks
        where locktype = 'advisory'
          and granted = false
          and classid = 0::oid
          and objid = $1::integer::oid
          and objsubid = 1
        order by pid
        limit 1
      `,
      [advisoryKey],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await delay(10);
  }
  throw new Error("Authority provisioner did not reach the advisory gate.");
}

async function waitForBlockingPids(
  persistence: Pick<PostgresFlarexPersistence, "query">,
  blockedPid: number,
): Promise<readonly number[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await persistence.query<{ blockers: number[] }>(
      "select pg_blocking_pids($1::integer) as blockers",
      [blockedPid],
    );
    const blockers = result.rows[0]?.blockers ?? [];
    if (blockers.length > 0) return blockers;
    await delay(10);
  }
  throw new Error(`Backend ${blockedPid} was not blocked by authority commit.`);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
