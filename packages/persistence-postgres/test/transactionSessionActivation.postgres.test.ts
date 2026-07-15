import { setTimeout as delay } from "node:timers/promises";

import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { TransactionPackageIdV1Schema } from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  PointMutationSessionActivationV1Error,
  PointMutationSessionAttemptLoadV1Error,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionActivationResultV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly physicalLocator: SharedDatabaseScopePhysicalLocator;
}

describePostgres("real Postgres O03-B session authority", () => {
  it("serializes exact same-request activation into one created and one replayed anchor", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "same_request",
        sharedLocator("same-request"),
        ids,
      );
      const activation = createActivationPersistence(
        persistence,
        ids,
      );
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );

      const results = await Promise.all([
        activation.activate(input),
        activation.activate(input),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "created",
        "replayed",
      ]);
      expect(results[0]?.anchor).toEqual(results[1]?.anchor);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
      });
    });
  });

  it("gives changed-evidence competition one winner under the scope lock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "changed_competition",
        sharedLocator("changed-competition"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const first = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );
      const second = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
        {
          evidence: {
            packageId: TransactionPackageIdV1Schema.make(
              "package_activation_competitor",
            ),
          },
        },
      );

      const settled = await Promise.allSettled([
        activation.activate(first),
        activation.activate(second),
      ]);
      const fulfilled = settled.find(
        (result) => result.status === "fulfilled",
      );
      const rejected = settled.find(
        (result) => result.status === "rejected",
      );

      expect(settled.filter((result) => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected"))
        .toHaveLength(1);
      expect(fulfilled?.status === "fulfilled" && fulfilled.value.status)
        .toBe("created");
      expect(rejected?.status === "rejected" ? rejected.reason : undefined)
        .toMatchObject({
        issue: { reason: "requestKeyConflict" },
      } satisfies Partial<PointMutationSessionActivationV1Error>);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
      });
    });
  });

  it("allows an independent scope to activate while another scope transaction is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "independent_a",
        sharedLocator("independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "independent_b",
        sharedLocator("independent-b"),
        ids,
      );
      const entered = deferred<void>();
      const release = deferred<void>();
      const activationA = createActivationPersistence(persistence, ids, {
        afterWrite: async (step) => {
          if (step !== "sessionInserted") return;
          entered.resolve();
          await release.promise;
        },
      });
      const activationB = createActivationPersistence(persistence, ids);
      const pendingA = activationA.activate(
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      );
      await entered.promise;

      let resultB: PointMutationSessionActivationResultV1 | undefined;
      try {
        resultB = await Promise.race([
          activationB.activate(
            pointMutationSessionActivationFixture(
              contextB.deploymentId,
              contextB.scopeId,
            ),
          ),
          delay(5_000).then(() => {
            throw new Error("Independent-scope activation timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;
      if (resultB === undefined) {
        throw new Error("Independent-scope activation returned no result.");
      }

      expect(resultA.status).toBe("created");
      expect(resultB.status).toBe("created");
      await expect(rowCounts(persistence, contextA.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
      });
      await expect(rowCounts(persistence, contextB.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
      });
    });
  });

  it("rolls back both authoritative rows after either mutating statement", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "rollback",
        sharedLocator("rollback"),
        ids,
      );
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );

      for (const failureStep of ["sessionInserted", "leaseInserted"] as const) {
        const activation = createActivationPersistence(persistence, ids, {
          afterWrite: (step) => {
            if (step === failureStep) throw new Error(`fail:${step}`);
          },
        });

        await expect(activation.activate(input)).rejects.toThrow(
          `fail:${failureStep}`,
        );
        await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
          sessions: 0,
          leases: 0,
        });
      }
    });
  });

  it("serializes concurrent exact reloads without mutating their anchor or lease", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_reload",
        sharedLocator("attempt-reload"),
        ids,
      );
      const activated = await createActivationPersistence(
        persistence,
        ids,
      ).activate(pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ));
      const selector = selectorFromAnchor(activated.anchor);
      const before = await attemptRowState(persistence, context.scopeId);
      const steps: string[] = [];
      const loader = createLoadPersistence(persistence, {
        afterLoadLock: (step) => {
          steps.push(step);
        },
      });

      const results = await Promise.all([
        loader.load(selector),
        loader.load(Object.freeze({ ...selector })),
      ]);

      expect(results[0]).toEqual(results[1]);
      expect(results[0]?.anchor).toEqual(activated.anchor);
      expect(steps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
      ]);
      await expect(attemptRowState(persistence, context.scopeId))
        .resolves.toEqual(before);
    });
  });

  it("allows an independent scope to reload while another exact attempt is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "attempt_independent_a",
        sharedLocator("attempt-independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "attempt_independent_b",
        sharedLocator("attempt-independent-b"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const anchorA = (await activation.activate(
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      )).anchor;
      const anchorB = (await activation.activate(
        pointMutationSessionActivationFixture(
          contextB.deploymentId,
          contextB.scopeId,
        ),
      )).anchor;
      const entered = deferred<void>();
      const release = deferred<void>();
      const loaderA = createLoadPersistence(persistence, {
        afterLoadLock: async (step) => {
          if (step !== "sessionLocked") return;
          entered.resolve();
          await release.promise;
        },
      });
      const loaderB = createLoadPersistence(persistence);
      const pendingA = loaderA.load(selectorFromAnchor(anchorA));
      await entered.promise;

      let resultB;
      try {
        resultB = await Promise.race([
          loaderB.load(selectorFromAnchor(anchorB)),
          delay(5_000).then(() => {
            throw new Error("Independent-scope attempt reload timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;

      expect(resultA.anchor).toEqual(anchorA);
      expect(resultB.anchor).toEqual(anchorB);
    });
  });

  it("uses database time only after the exact lease lock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_expiry",
        sharedLocator("attempt-expiry"),
        ids,
      );
      const anchor = (await createActivationPersistence(
        persistence,
        ids,
      ).activate(pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ))).anchor;
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = clock_timestamp() + interval '2 seconds'
          where session_id = $1
        `,
        [anchor.sessionId],
      );
      const loader = createLoadPersistence(persistence, {
        afterLoadLock: async (step) => {
          if (step === "leaseLocked") await delay(2_200);
        },
      });

      await expect(loader.load(selectorFromAnchor(anchor)))
        .rejects.toMatchObject({
          issue: { reason: "activeAttemptExpired" },
        } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    });
  });

  it("rejects authority that changes after preliminary placement resolution", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_authority_race",
        sharedLocator("attempt-authority-race"),
        ids,
      );
      const anchor = (await createActivationPersistence(
        persistence,
        ids,
      ).activate(pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ))).anchor;
      const baseTarget =
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          context.physicalLocator,
        );
      const ports = {
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (): Promise<LocatedScopeClockReader> => ({
            ...baseTarget,
            getCurrentClock: async (scopeId) => {
              const preliminary = await baseTarget.getCurrentClock(scopeId);
              await persistence.query(
                `
                  update fx_system_scope_clock
                  set storage_generation_fence = storage_generation_fence + 1
                  where scope_id = $1
                `,
                [scopeId],
              );
              return preliminary;
            },
          }),
        },
      } satisfies PointMutationSessionActivationResolutionPortsV1;
      const loader = createPointMutationSessionAttemptLoadPersistenceV1(ports);

      await expect(loader.load(selectorFromAnchor(anchor)))
        .rejects.toMatchObject({
          issue: { reason: "storageGenerationFenceChanged" },
        } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    });
  });

  it("serializes concurrent exact abort and expiry into one terminal transition", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_race",
        sharedLocator("attempt-terminal-race"),
        ids,
      );
      const anchor = (await createActivationPersistence(
        persistence,
        ids,
      ).activate(pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ))).anchor;
      await persistence.query(
        `update fx_system_snapshot_lease
         set lease_expires_at = '2000-01-01T00:00:00.000Z'
         where session_id = $1`,
        [anchor.sessionId],
      );
      const events: string[] = [];
      const terminalization = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: (event) => {
          events.push(`${event.operation}:${event.phase}:${event.step}`);
        },
      });
      const selector = selectorFromAnchor(anchor);

      const results = await Promise.all([
        terminalization.abort({
          selector,
          expectedSnapshotToken: anchor.snapshotToken,
        }),
        terminalization.expire(selector),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "observed",
        "terminalized",
      ]);
      expect(results.map((result) => result.terminal.lifecycle))
        .toEqual(["expired", "expired"]);
      expect(events.filter((event) => event.endsWith(":clockLocked")))
        .toHaveLength(2);
      expect(events.filter((event) => event.endsWith(":sessionLocked")))
        .toHaveLength(2);
      expect(events.filter((event) => event.endsWith(":leaseLocked")))
        .toHaveLength(1);
      expect(events.filter((event) => event.includes(":write:")))
        .toHaveLength(2);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 0,
      });
    });
  });

  it("reads database time after the exact lease lock when expiry crosses its edge", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_expiry",
        sharedLocator("attempt-terminal-expiry"),
        ids,
      );
      const anchor = (await createActivationPersistence(
        persistence,
        ids,
      ).activate(pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ))).anchor;
      await persistence.query(
        `update fx_system_snapshot_lease
         set lease_expires_at = clock_timestamp() + interval '2 seconds'
         where session_id = $1`,
        [anchor.sessionId],
      );
      const events: string[] = [];
      const terminalization = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: async (event) => {
          events.push(`${event.phase}:${event.step}`);
          if (event.phase === "lock" && event.step === "leaseLocked") {
            await delay(2_200);
          }
        },
      });

      await expect(
        terminalization.expire(selectorFromAnchor(anchor)),
      ).resolves.toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "expired" },
      });
      expect(events).toEqual([
        "lock:clockLocked",
        "lock:sessionLocked",
        "lock:leaseLocked",
        "write:leaseDeleted",
        "write:sessionTerminalized",
      ]);
    });
  });

  it("allows an independent scope to terminalize while another attempt is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "attempt_terminal_independent_a",
        sharedLocator("attempt-terminal-independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "attempt_terminal_independent_b",
        sharedLocator("attempt-terminal-independent-b"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const anchorA = (await activation.activate(
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      )).anchor;
      const anchorB = (await activation.activate(
        pointMutationSessionActivationFixture(
          contextB.deploymentId,
          contextB.scopeId,
        ),
      )).anchor;
      const entered = deferred<void>();
      const release = deferred<void>();
      const terminalizationA = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: async (event) => {
          if (event.phase !== "lock" || event.step !== "sessionLocked") return;
          entered.resolve();
          await release.promise;
        },
      });
      const terminalizationB = createTerminalizationPersistence(persistence);
      const pendingA = terminalizationA.abort({
        selector: selectorFromAnchor(anchorA),
        expectedSnapshotToken: anchorA.snapshotToken,
      });
      await entered.promise;

      let resultB;
      try {
        resultB = await Promise.race([
          terminalizationB.abort({
            selector: selectorFromAnchor(anchorB),
            expectedSnapshotToken: anchorB.snapshotToken,
          }),
          delay(5_000).then(() => {
            throw new Error("Independent-scope terminalization timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;

      expect(resultA.terminal.lifecycle).toBe("aborted");
      expect(resultB.terminal.lifecycle).toBe("aborted");
    });
  });

  it("rolls back lease deletion and terminal lifecycle after the second write", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_rollback",
        sharedLocator("attempt-terminal-rollback"),
        ids,
      );
      const anchor = (await createActivationPersistence(
        persistence,
        ids,
      ).activate(pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ))).anchor;
      const before = await attemptRowState(persistence, context.scopeId);
      const terminalization = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: (event) => {
          if (
            event.phase === "write" &&
            event.step === "sessionTerminalized"
          ) {
            throw new Error("fail:sessionTerminalized");
          }
        },
      });

      await expect(terminalization.abort({
        selector: selectorFromAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken,
      })).rejects.toThrow("fail:sessionTerminalized");
      await expect(attemptRowState(persistence, context.scopeId))
        .resolves.toEqual(before);
    });
  });
});

async function provisionContext(
  persistence: PostgresFlarexPersistence,
  label: string,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  ids: () => string,
): Promise<ActivationContext> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_activation_postgres_${label}`,
  );
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator, randomUuid: ids },
  ).ensure({
    deploymentId,
    projectId: `project_activation_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  return { deploymentId, scopeId, physicalLocator };
}

function createActivationPersistence(
  persistence: PostgresFlarexPersistence,
  ids: () => string,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionActivationPersistenceV1(
    resolutionPorts(persistence, targetOptions),
    {
      leaseDurationMilliseconds: 60_000,
      randomUuid: ids,
    },
  );
}

function createLoadPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionAttemptLoadPersistenceV1(
    resolutionPorts(persistence, targetOptions),
  );
}

function createTerminalizationPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionAttemptTerminalizationPersistenceV1(
    resolutionPorts(persistence, targetOptions),
  );
}

function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

async function attemptRowState(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<Record<string, unknown>> {
  const result = await persistence.query<Record<string, unknown>>(
    `
      select s.lifecycle,
             s.attempt_fence::text as attempt_fence,
             s.updated_at::text as session_updated_at,
             l.attempt_fence::text as lease_attempt_fence,
             l.snapshot_epoch_uuid::text as snapshot_epoch_uuid,
             l.snapshot_commit_seq::text as snapshot_commit_seq,
             l.lease_expires_at::text as lease_expires_at
      from fx_system_tx_session s
      join fx_system_snapshot_lease l
        on l.scope_uuid = s.scope_uuid
       and l.session_id = s.session_id
      join fx_system_scope_clock c
        on c.scope_uuid = s.scope_uuid
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Attempt reload row is missing.");
  return row;
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): PointMutationSessionActivationResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared activation must not read provisioning receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

async function rowCounts(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<{ readonly sessions: number; readonly leases: number }> {
  const result = await persistence.query<{
    sessions: number;
    leases: number;
  }>(
    `
      select
        (select count(*)::int from fx_system_tx_session
          where scope_uuid = c.scope_uuid) as sessions,
        (select count(*)::int from fx_system_snapshot_lease
          where scope_uuid = c.scope_uuid) as leases
      from fx_system_scope_clock c
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Activation scope clock is missing.");
  return row;
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
    return `52000000-0000-4000-8000-${suffix}`;
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred resolver is unavailable.");
      }
      resolvePromise(value);
    },
  };
}
