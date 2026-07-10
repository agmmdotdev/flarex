import { setTimeout as delay } from "node:timers/promises";
import {
  LegacyV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  CommitSeqSchema,
  OutboxSeqSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  SplitScopeAuthorityTargetResolutionError,
  SplitScopeInitialClockConflictError,
  type LocatedSplitScopeClockTarget,
  type PostgresFlarexPersistence,
  type SplitScopeAuthorityProvisioner,
} from "../src/postgres";
import {
  getScopeAuthorityProvisioningReceipt,
} from "../src/scopeAuthorityProvisioningReceipt";
import type {
  SplitScopePhysicalLocator,
} from "../src/scopeMetadataTypes";
import { fxSystemScopeClocks } from "../src/schema";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const databaseLocator = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "scope_database",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;

describePostgres("real Postgres split scope authority provisioning", () => {
  it("publishes, replays, and preserves conflicting target authority", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const created = await provisionerFor(
        control,
        target,
        uuidSequence(1, 2),
      ).ensure({
        deploymentId: "deployment_split_pg_publish",
        projectId: "project_split_pg_publish",
      });

      expect(created).toMatchObject({
        status: "published_ready",
        createdDeployment: true,
        scope: { physicalLocator: databaseLocator },
        receipt: {
          state: "ready",
          initialEpoch: `epoch_${testUuid(2)}`,
          physicalLocator: databaseLocator,
        },
      });
      await expect(control.getScopeClock(created.scope.scopeId)).resolves.toBeNull();
      await expect(target.getScopeClock(created.scope.scopeId)).resolves.toMatchObject({
        storageGeneration: "legacy_v1",
        storageGenerationFence: 1n,
        lastCommitSeq: 0n,
        lastOutboxSeq: 0n,
        epoch: `epoch_${testUuid(2)}`,
      });

      const replay = createPostgresSplitScopeAuthorityProvisioner(control, {
        placementPlanner: {
          plan() {
            throw new Error("ready replay must use persisted placement");
          },
        },
        targetResolver: resolverFor(target),
        randomUuid: () => {
          throw new Error("ready replay must use persisted authority");
        },
      });
      await expect(
        replay.ensure({
          deploymentId: "deployment_split_pg_publish",
          projectId: "project_split_pg_publish",
        }),
      ).resolves.toMatchObject({
        status: "already_ready",
        createdDeployment: false,
        scope: { scopeId: created.scope.scopeId },
        receipt: { initialEpoch: created.receipt.initialEpoch },
      });

      const conflictScopeId = ScopeIdSchema.make(`scope_${testUuid(3)}`);
      await target.drizzle.insert(fxSystemScopeClocks).values({
        scopeId: conflictScopeId,
        storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(1n),
        lastCommitSeq: CommitSeqSchema.make(0n),
        lastOutboxSeq: OutboxSeqSchema.make(0n),
        epoch: ScopeEpochSchema.make("epoch_existing_target_authority"),
      });
      await expect(
        provisionerFor(control, target, uuidSequence(3, 4)).ensure({
          deploymentId: "deployment_split_pg_conflict",
          projectId: "project_split_pg_conflict",
        }),
      ).rejects.toBeInstanceOf(SplitScopeInitialClockConflictError);
      await expect(target.getScopeClock(conflictScopeId)).resolves.toMatchObject({
        epoch: "epoch_existing_target_authority",
      });
      await expect(
        getScopeAuthorityProvisioningReceipt(control.drizzle, conflictScopeId),
      ).resolves.toMatchObject({
        state: "reserved",
        initialEpoch: `epoch_${testUuid(4)}`,
      });
    });
  }, 60_000);

  it("resumes a committed reservation and serializes concurrent reconcilers", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const input = {
        deploymentId: "deployment_split_pg_concurrent",
        projectId: "project_split_pg_concurrent",
      } as const;
      const reserveOnly = createPostgresSplitScopeAuthorityProvisioner(control, {
        placementPlanner: { plan: () => databaseLocator },
        targetResolver: {
          async resolve() {
            throw new Error("injected-target-unavailable");
          },
        },
        randomUuid: uuidSequence(5, 6),
      });
      await expect(reserveOnly.ensure(input)).rejects.toBeInstanceOf(
        SplitScopeAuthorityTargetResolutionError,
      );
      const scopeId = ScopeIdSchema.make(`scope_${testUuid(5)}`);
      await expect(
        getScopeAuthorityProvisioningReceipt(control.drizzle, scopeId),
      ).resolves.toMatchObject({
        state: "reserved",
        initialEpoch: `epoch_${testUuid(6)}`,
      });
      await expect(target.getScopeClock(scopeId)).resolves.toBeNull();

      const locatedTarget = createPostgresLocatedSplitScopeClockTarget(
        target,
        databaseLocator,
      );
      const createReconciler = () =>
        createPostgresSplitScopeAuthorityProvisioner(control, {
          placementPlanner: {
            plan() {
              throw new Error("reserved replay must use persisted placement");
            },
          },
          targetResolver: {
            async resolve() {
              return locatedTarget;
            },
          },
          randomUuid: () => {
            throw new Error("reserved replay must use persisted authority");
          },
        });
      const advisoryKey = 73_602;
      await installTargetInsertGate(target, advisoryKey);
      const gateClient = await target.pool.connect();
      let gateHeld = false;
      let firstPromise:
        | ReturnType<SplitScopeAuthorityProvisioner["ensure"]>
        | undefined;
      let secondPromise:
        | ReturnType<SplitScopeAuthorityProvisioner["ensure"]>
        | undefined;

      try {
        const gatePid = await backendPid(gateClient);
        await gateClient.query("select pg_advisory_lock($1)", [advisoryKey]);
        gateHeld = true;
        const firstEnsure = createReconciler().ensure(input);
        firstPromise = firstEnsure;
        await waitForBlockedSessionCount(target, gatePid, 1);
        await proveControlAuthorityIsUnlocked(control, input.deploymentId, scopeId);

        const secondEnsure = createReconciler().ensure(input);
        secondPromise = secondEnsure;
        await waitForBlockedSessionCount(target, gatePid, 2);
        await gateClient.query("select pg_advisory_unlock($1)", [advisoryKey]);
        gateHeld = false;
        const [first, second] = await Promise.all([firstEnsure, secondEnsure]);

        expect([first.status, second.status].sort()).toEqual([
          "already_ready",
          "published_ready",
        ]);
        expect(first.scope.scopeId).toBe(second.scope.scopeId);
        expect(first.receipt.initialEpoch).toBe(second.receipt.initialEpoch);
        await expect(target.getScopeClock(scopeId)).resolves.toMatchObject({
          storageGeneration: "legacy_v1",
          storageGenerationFence: 1n,
          lastCommitSeq: 0n,
          lastOutboxSeq: 0n,
          epoch: `epoch_${testUuid(6)}`,
        });
        await expect(
          getScopeAuthorityProvisioningReceipt(control.drizzle, scopeId),
        ).resolves.toMatchObject({ state: "ready" });
      } finally {
        if (gateHeld) {
          await gateClient.query("select pg_advisory_unlock($1)", [advisoryKey]);
        }
        await Promise.allSettled(
          [firstPromise, secondPromise].filter(
            (promise): promise is NonNullable<typeof promise> =>
              promise !== undefined,
          ),
        );
        gateClient.release();
      }
    });
  }, 60_000);
});

function provisionerFor(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
  randomUuid: () => string,
) {
  return createPostgresSplitScopeAuthorityProvisioner(control, {
    placementPlanner: { plan: () => databaseLocator },
    targetResolver: resolverFor(target),
    randomUuid,
  });
}

function resolverFor(
  target: PostgresFlarexPersistence,
): { resolve(locator: SplitScopePhysicalLocator): Promise<LocatedSplitScopeClockTarget> } {
  return {
    async resolve(locator) {
      return createPostgresLocatedSplitScopeClockTarget(target, locator);
    },
  };
}

function uuidSequence(...indexes: readonly number[]): () => string {
  let position = 0;
  return () => {
    const index = indexes[position];
    if (index === undefined) throw new Error("UUID test sequence was exhausted.");
    position += 1;
    return testUuid(index);
  };
}

function testUuid(index: number): string {
  return `10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

async function installTargetInsertGate(
  target: PostgresFlarexPersistence,
  advisoryKey: number,
): Promise<void> {
  await target.query(`
    create function fx_test_split_scope_insert_gate()
    returns trigger
    language plpgsql
    as $gate$
    begin
      perform pg_advisory_xact_lock(${advisoryKey});
      return new;
    end
    $gate$;

    create trigger fx_test_split_scope_insert_gate
    before insert on fx_system_scope_clock
    for each row execute function fx_test_split_scope_insert_gate()
  `);
}

async function backendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid()::integer as pid",
  );
  const pid = result.rows[0]?.pid;
  if (pid === undefined) throw new Error("Postgres returned no backend PID.");
  return pid;
}

async function waitForBlockedSessionCount(
  target: PostgresFlarexPersistence,
  blockerPid: number,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await target.query<{ count: string }>(
      `
        select count(*)::text as count
        from pg_stat_activity
        where $1 = any(pg_blocking_pids(pid))
      `,
      [blockerPid],
    );
    if (Number(result.rows[0]?.count ?? "0") >= expectedCount) return;
    await delay(10);
  }
  throw new Error(
    `Timed out waiting for ${expectedCount} target sessions blocked by ${blockerPid}.`,
  );
}

async function proveControlAuthorityIsUnlocked(
  control: PostgresFlarexPersistence,
  deploymentId: string,
  scopeId: ScopeId,
): Promise<void> {
  const client = await control.pool.connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    await client.query(
      "select deployment_id from deployments where deployment_id = $1 for update nowait",
      [deploymentId],
    );
    await client.query(
      "select id from fx_control_scope where id = $1 for update nowait",
      [scopeId],
    );
    await client.query(
      "select scope_id from fx_control_scope_provisioning where scope_id = $1 for update nowait",
      [scopeId],
    );
    await client.query("rollback");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("rollback");
    client.release();
  }
}
