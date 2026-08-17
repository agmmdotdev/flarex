import { setTimeout as delay } from "node:timers/promises";

import { Result } from "effect";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedRetainedHistoryFloorTarget,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createLocatedRetainedHistoryFloorTargetInternal,
  createRetainedHistoryFloorObservationPort,
  createRetainedHistoryFloorPinFacet,
  createRetainedHistoryFloorPublicationPort,
  createTestNoReconnectRetainedHistoryFloorPublicationPinFacet,
  observeRetainedHistoryFloorCandidateEffect,
  publishRetainedHistoryFloorEffect,
  type RetainedHistoryFloorCandidateObservation,
} from "../src/retainedHistoryFloorObservation";
import { createPostgresLocatedReadCommittedTransactionRunnerV1 } from
  "../src/postgresLocatedReadCommitted";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { createPointMutationSessionActivationPersistenceV1 } from
  "../src/transactionSessionActivation";
import type { RunLocatedReadCommittedTransactionV1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from
  "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const retentionPolicy = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 1_000,
  maximumFutureIssuedAtSkewMilliseconds: 0,
  maximumLiveSnapshotRetentionMilliseconds: 10_000,
}));

describePostgres("real PostgreSQL O11-B/C retained-history floor", () => {
  it("shares the scope-clock lane and observes without publishing", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const physicalLocator = sharedLocator("o11b-postgres");
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_floor_postgres",
      );
      const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator, randomUuid: ids },
      ).ensure({
        deploymentId,
        projectId: "project_retained_floor_postgres",
      });
      const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
      await setFlarexActivationClock(persistence, scopeId);
      await seedCommits(persistence, scopeId);

      const acquiredPid = deferred<number>();
      const port = createRetainedHistoryFloorObservationPort({
        authority: {
          scopeMetadata: persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => {
              throw new Error("Shared scope must not read split receipts.");
            },
          },
          scopeClockTargets: {
            resolve: async (locator) =>
              createPostgresLocatedRetainedHistoryFloorTarget(
                persistence,
                locator,
                {
                  afterAcquire: async (client) => {
                    const result = await client.query<{ pid: number }>(
                      "select pg_backend_pid()::int as pid",
                    );
                    const pid = result.rows[0]?.pid;
                    if (pid === undefined) {
                      throw new Error("Observation backend PID is missing.");
                    }
                    acquiredPid.resolve(pid);
                  },
                },
              ),
          },
        },
        grantRetentionPolicy: retentionPolicy,
        pinFacets: [
          createRetainedHistoryFloorPinFacet("test", { kind: "absent" }),
        ],
      });
      const before = await readClock(persistence, scopeId);
      const blocker = await persistence.pool.connect();
      let observation:
        | Promise<RetainedHistoryFloorCandidateObservation>
        | undefined;
      try {
        await blocker.query("begin");
        await blocker.query(
          `select scope_id from fx_system_scope_clock
           where scope_id = $1 for update`,
          [scopeId],
        );
        observation = runEffect(observeRetainedHistoryFloorCandidateEffect(
          port,
          deploymentId,
        ));
        const pid = await acquiredPid.promise;
        await expect(waitForLockWait(persistence, pid)).resolves.toBe("Lock");
        await blocker.query("commit");

        await expect(observation).resolves.toMatchObject({
          disposition: "advanceable",
          currentFloor: 0n,
          lastCommitSeq: 3n,
          candidateFloor: 2n,
          leaseCeiling: 3n,
          timeWindowCeiling: 2n,
          additionalPinCeiling: 3n,
          holdReasons: [],
        });
        await expect(readClock(persistence, scopeId)).resolves.toEqual(before);
        const version = await persistence.query<{ version: string }>(
          "select version()",
        );
        expect(version.rows[0]?.version).toMatch(/^PostgreSQL /);
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
        if (observation !== undefined) await Promise.allSettled([observation]);
      }
    });
  }, 60_000);

  it("publishes under the lease lane and recovers rollback and uncertainty", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const physicalLocator = sharedLocator("o11c-postgres");
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_floor_publication_postgres",
      );
      const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator, randomUuid: ids },
      ).ensure({
        deploymentId,
        projectId: "project_retained_floor_publication_postgres",
      });
      const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
      await setFlarexActivationClock(persistence, scopeId);
      await seedCommits(persistence, scopeId);

      const leaseInserted = deferred<void>();
      const releaseLeaseAdmission = deferred<void>();
      const activation = createPointMutationSessionActivationPersistenceV1({
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared scope must not read split receipts.");
          },
        },
        scopeSessionTargets: {
          resolve: async (locator) =>
            createPostgresLocatedPointMutationSessionActivationTargetV1(
              persistence,
              locator,
              {
                afterWrite: async (step) => {
                  if (step !== "leaseInserted") return;
                  leaseInserted.resolve(undefined);
                  await releaseLeaseAdmission.promise;
                },
              },
            ),
        },
      }, {
        leaseDurationMilliseconds: 60_000,
        randomUuid: ids,
      });
      const activationPromise = activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(deploymentId, scopeId),
      );
      await leaseInserted.promise;

      const publisherPid = deferred<number>();
      const port = publicationPort(persistence, physicalLocator, {
        afterAcquire: async (client) => {
          const result = await client.query<{ pid: number }>(
            "select pg_backend_pid()::int as pid",
          );
          const pid = result.rows[0]?.pid;
          if (pid === undefined) throw new Error("Publisher PID is missing.");
          publisherPid.resolve(pid);
        },
      });
      const publication = runEffect(publishRetainedHistoryFloorEffect(
        port,
        deploymentId,
      ));
      try {
        await expect(waitForLockWait(
          persistence,
          await publisherPid.promise,
        )).resolves.toBe("Lock");
      } finally {
        releaseLeaseAdmission.resolve(undefined);
      }
      const [activated, published] = await Promise.all([
        activationPromise,
        publication,
      ]);
      expect(activated.status).toBe("created");
      expect(published).toMatchObject({
        disposition: "advanced",
        previousFloor: 0n,
        currentFloor: 2n,
        candidateFloor: 2n,
      });
      await expect(readClock(persistence, scopeId)).resolves.toMatchObject({
        oldest_available_commit_seq: "2",
      });

      const rollbackDeployment = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_floor_rollback_postgres",
      );
      const rollbackProvisioned =
        await createPostgresSharedScopeAuthorityProvisioner(
          persistence,
          {
            physicalLocator: sharedLocator("o11c-postgres-rollback"),
            randomUuid: ids,
          },
        ).ensure({
          deploymentId: rollbackDeployment,
          projectId: "project_retained_floor_rollback_postgres",
        });
      const rollbackScope = decodeReplacementScopeIdV1(
        rollbackProvisioned.scope.scopeId,
      );
      await setFlarexActivationClock(persistence, rollbackScope);
      await seedCommits(persistence, rollbackScope);
      await expect(runEffectFailure(publishRetainedHistoryFloorEffect(
        publicationPort(
          persistence,
          sharedLocator("o11c-postgres-rollback"),
          {},
          run => async work => run(async tx => {
            await work(tx);
            throw new Error("postgres publication rollback");
          }),
        ),
        rollbackDeployment,
      ))).resolves.toMatchObject({ issue: { kind: "callbackRolledBack" } });
      await expect(readClock(persistence, rollbackScope)).resolves
        .toMatchObject({ oldest_available_commit_seq: "0" });

      const uncertainDeployment = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_floor_uncertain_postgres",
      );
      const uncertainLocator = sharedLocator("o11c-postgres-uncertain");
      const uncertainProvisioned =
        await createPostgresSharedScopeAuthorityProvisioner(
          persistence,
          { physicalLocator: uncertainLocator, randomUuid: ids },
        ).ensure({
          deploymentId: uncertainDeployment,
          projectId: "project_retained_floor_uncertain_postgres",
        });
      const uncertainScope = decodeReplacementScopeIdV1(
        uncertainProvisioned.scope.scopeId,
      );
      await setFlarexActivationClock(persistence, uncertainScope);
      await seedCommits(persistence, uncertainScope);
      let loseFirstResponse = true;
      const uncertainPort = publicationPort(persistence, uncertainLocator, {
        release: (client, discardError) => {
          client.release(discardError);
          if (loseFirstResponse) {
            loseFirstResponse = false;
            throw new Error("lost publication response");
          }
        },
      });
      await expect(runEffectFailure(publishRetainedHistoryFloorEffect(
        uncertainPort,
        uncertainDeployment,
      ))).resolves.toMatchObject({ issue: { kind: "decisionUncertain" } });
      await expect(readClock(persistence, uncertainScope)).resolves
        .toMatchObject({ oldest_available_commit_seq: "2" });
      await expect(runEffect(publishRetainedHistoryFloorEffect(
        uncertainPort,
        uncertainDeployment,
      ))).resolves.toMatchObject({
        disposition: "held",
        previousFloor: 2n,
        currentFloor: 2n,
      });
    });
  }, 120_000);
});

function publicationPort(
  persistence: PostgresFlarexPersistence,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  targetOptions: Parameters<
    typeof createPostgresLocatedRetainedHistoryFloorTarget
  >[2] = {},
  decorateRunner?: (
    runner: RunLocatedReadCommittedTransactionV1,
  ) => RunLocatedReadCommittedTransactionV1,
) {
  return createRetainedHistoryFloorPublicationPort({
    authority: {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared scope must not read split receipts.");
        },
      },
      scopeClockTargets: {
        resolve: async (locator) => {
          const runner = createPostgresLocatedReadCommittedTransactionRunnerV1(
            persistence.pool,
            targetOptions,
          );
          return createLocatedRetainedHistoryFloorTargetInternal(
            persistence.drizzle,
            locator,
            decorateRunner === undefined ? runner : decorateRunner(runner),
          );
        },
      },
    },
    grantRetentionPolicy: retentionPolicy,
    pinFacets: [
      createTestNoReconnectRetainedHistoryFloorPublicationPinFacet(),
    ],
  });
}

async function seedCommits(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<void> {
  await persistence.query(
    `insert into fx_system_commit
       (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
     select scope_uuid, epoch_uuid, values.commit_seq, 0,
            clock_timestamp() - values.age
     from fx_system_scope_clock,
          (values
            (1::bigint, interval '30 seconds'),
            (2::bigint, interval '20 seconds'),
            (3::bigint, interval '1 second')
          ) as values(commit_seq, age)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    "update fx_system_scope_clock set last_commit_seq = 3 where scope_id = $1",
    [scopeId],
  );
}

async function readClock(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{
  last_commit_seq: string;
  oldest_available_commit_seq: string;
}>> {
  const result = await persistence.query<{
    last_commit_seq: string;
    oldest_available_commit_seq: string;
  }>(
    `select last_commit_seq::text, oldest_available_commit_seq::text
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Scope clock is missing.");
  return Object.freeze({ ...row });
}

async function waitForLockWait(
  persistence: PostgresFlarexPersistence,
  pid: number,
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await persistence.query<{
      wait_event_type: string | null;
    }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    const waitEventType = result.rows[0]?.wait_event_type;
    if (waitEventType === "Lock") return waitEventType;
    await delay(10);
  }
  throw new Error("Observation did not block on the scope-clock lock.");
}

function sharedLocator(databaseKey: string): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function uuidFactory(): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `97100000-0000-4000-8000-${suffix}`;
  };
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolvePromise === undefined) throw new Error("Deferred not ready.");
      resolvePromise(value);
    },
  };
}
