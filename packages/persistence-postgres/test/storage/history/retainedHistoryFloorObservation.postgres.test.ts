import { setTimeout as delay } from "node:timers/promises";

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
} from "../../../src/database/postgres";
import {
  createLocatedRetainedHistoryFloorTargetInternal,
  createRetainedHistoryFloorObservationPort,
  createRetainedHistoryFloorPinFacet,
  createRetainedHistoryFloorPublicationPort,
  createTestNoReconnectRetainedHistoryFloorPublicationPinFacet,
  observeRetainedHistoryFloorCandidateEffect,
  publishRetainedHistoryFloorEffect,
  type RetainedHistoryFloorCandidateObservation,
  type RetainedHistoryFloorPublicationResult,
} from "../../../src/storage/history/retainedHistoryFloorObservation";
import { createPostgresLocatedReadCommittedTransactionRunnerV1 } from
  "../../../src/database/postgresLocatedReadCommitted";
import type { SharedDatabaseScopePhysicalLocator } from
  "../../../src/scope/scopeMetadataTypes";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import type {
  RunLocatedReadCommittedTransactionV1,
} from "../../../src/database/locatedTransactionIdentity";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import {
  RETAINED_FLOOR_FIXTURE_WINDOW_MS,
  retainedFloorFixturePolicy as retentionPolicy,
  retainedHistoryFloorLeaseScenario,
  seedRetainedFloorCommits,
} from "./retainedHistoryFloorLeaseScenario";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import {
  activatePointMutationSession,
} from "../../execution/session/support/attemptFixture";
import {
  pointMutationSessionActivationFixture,
} from "../../execution/session/support/activationEvidence";
import {
  setFlarexActivationClock,
} from "../../execution/session/support/authorityClock";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPersistence = useFileScopedPostgresPersistence();

describePostgres("real PostgreSQL O11-B/C retained-history floor", { concurrent: false }, () => {
  it("advances past an expired lease backlog with indexed expiry filtering", async () => {
    await withPersistence(async persistence => {
      const physicalLocator = sharedLocator("floor-lease-backlog");
      const ids = uuidFactory();
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make("deployment_floor_lease_backlog");
      const provisioned = await createPostgresSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator, randomUuid: ids,
      }).ensure({ deploymentId, projectId: "project_floor_lease_backlog" });
      const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
      await setFlarexActivationClock(persistence, scopeId);
      await seedRetainedFloorCommits(persistence.drizzle, scopeId, "beforeLease");
      const activation = createPointMutationSessionActivationPersistenceV1({
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared scope must not read split receipts."); },
        },
        scopeSessionTargets: {
          resolve: async locator => createPostgresLocatedPointMutationSessionActivationTargetV1(persistence, locator),
        },
      }, { leaseDurationMilliseconds: RETAINED_FLOOR_FIXTURE_WINDOW_MS, randomUuid: ids });
      const activated = await activatePointMutationSession(activation,
        pointMutationSessionActivationFixture(deploymentId, scopeId));
      const observation = createRetainedHistoryFloorObservationPort({
        authority: {
          scopeMetadata: persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared scope must not read split receipts."); },
          },
          scopeClockTargets: {
            resolve: async locator => createPostgresLocatedRetainedHistoryFloorTarget(persistence, locator),
          },
        },
        grantRetentionPolicy: retentionPolicy,
        pinFacets: [createRetainedHistoryFloorPinFacet("test", { kind: "absent" })],
      });
      await retainedHistoryFloorLeaseScenario({
        database: persistence.drizzle, scopeId, sessionId: activated.anchor.sessionId,
        deploymentId, observation, publication: publicationPort(persistence, physicalLocator),
      });
      await persistence.query("analyze fx_system_snapshot_lease");
      const scopeUuid = scopeId.slice("scope_".length);
      const [time] = (await persistence.query<{ now: Date }>("select clock_timestamp() as now")).rows;
      if (time === undefined) throw new Error("Expected database time.");
      const plan = await persistence.query(`
        explain (analyze, buffers, format json)
        select snapshot_epoch_uuid, snapshot_commit_seq, lease_expires_at
        from fx_system_snapshot_lease
        where scope_uuid = $1::uuid and lease_expires_at > $2::timestamptz
        order by lease_expires_at, session_id limit 4097
      `, [scopeUuid, time.now.toISOString()]);
      const planText = JSON.stringify(plan.rows);
      expect(planText).toMatch(/"Index Name":"fx_system_snapshot_lease_(retirement_pin|expiry)_idx"/);
      expect(planText).toMatch(/"Index Cond":"[^"\n]*lease_expires_at > /);
      expect(planText).not.toContain('"Node Type":"Seq Scan"');
      expect(planText).toContain('"Actual Rows":0');
    });
  }, 120_000);

  it("shares the scope-clock lane and observes without publishing", async () => {
    await withPersistence(async (persistence) => {
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
      await seedRetainedFloorCommits(persistence.drizzle, scopeId);

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
      let blockerCommitted = false;
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
        const pid = await Promise.race([
          acquiredPid.promise,
          observation.then(() => {
            throw new Error("Observation completed before acquiring its backend.");
          }),
        ]);
        await expect(waitForLockWait(persistence, pid)).resolves.toBe("Lock");
        await blocker.query("commit");
        blockerCommitted = true;

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
        try {
          if (blockerCommitted) blocker.release();
          else await rollbackAndReleasePostgresClient(blocker);
        } finally {
          if (observation !== undefined) await Promise.allSettled([observation]);
        }
      }
    });
  }, 60_000);

  it("publishes under the lease lane and recovers rollback and uncertainty", async () => {
    await withPersistence(async (persistence) => {
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
      await seedRetainedFloorCommits(persistence.drizzle, scopeId);

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
        leaseDurationMilliseconds: RETAINED_FLOOR_FIXTURE_WINDOW_MS,
        randomUuid: ids,
      });
      const activationPromise = activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(deploymentId, scopeId),
      );
      const pending: Promise<unknown>[] = [activationPromise];
      let publication: Promise<RetainedHistoryFloorPublicationResult> | undefined;
      try {
        await Promise.race([
          leaseInserted.promise,
          activationPromise.then(() => {
            throw new Error("Activation completed before the lease-admission barrier.");
          }),
        ]);
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
        publication = runEffect(publishRetainedHistoryFloorEffect(
          port,
          deploymentId,
        ));
        pending.push(publication);
        const acquiredPublisherPid = await Promise.race([
          publisherPid.promise,
          publication.then(() => {
            throw new Error("Publication completed before acquiring its backend.");
          }),
        ]);
        await expect(waitForLockWait(
          persistence,
          acquiredPublisherPid,
        )).resolves.toBe("Lock");
      } finally {
        releaseLeaseAdmission.resolve(undefined);
        await Promise.allSettled(pending);
      }
      if (publication === undefined) throw new Error("Expected retained-history publication to start.");
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
      await seedRetainedFloorCommits(persistence.drizzle, rollbackScope);
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
      await seedRetainedFloorCommits(persistence.drizzle, uncertainScope);
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
     from fx_system_scope_clock join fx_system_scope_execution_authority using(scope_id)
     where scope_id = $1`,
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
