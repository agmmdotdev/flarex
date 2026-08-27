import { PGlite } from "@electric-sql/pglite";
import type {
  TaskRequestedEffectSequenceV1,
  TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Brand, Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import { detachDriverRows } from "../src/detachDriverRows";
import {
  TaskComputeDeliveryContinuationV1Error,
  TaskComputeDeliveryDiscoveryCorruptionError,
  TaskComputeDeliveryDiscoveryInputError,
  TaskComputeDeliveryDiscoverySqlError,
  decodeTaskComputeDeliveryContinuationV1,
  encodeTaskComputeDeliveryContinuationV1,
  makeTaskComputeDeliveryCandidateDiscovery,
  type TaskComputeDeliveryCandidateDiscovery,
  type TaskComputeDeliveryCandidatePage,
  type TaskComputeDeliveryDiscoveryError,
} from "../src/taskComputeDeliveryDiscovery";
import {
  createLocatedTaskComputeDeliveryTargetV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import {
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskRequestedEffectsV1,
} from "../src/schema";
import type { AppRowTransaction } from "../src/appRows";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../src/transactionSessionActivation";
import type { RunLocatedReadCommittedTransactionV1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  seedTaskComputeDeliverySchemaV1,
  settleTaskComputeDeliverySchemaV1,
} from "./taskComputeDeliverySchemaV1TestSupport";
import {
  seedAdditionalTaskSystemRunV1,
  TASK_LOCATOR,
  TASK_RUN_ID,
  locatedTaskAuthorityV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const RUN_BEFORE = "run_71000000-0000-4000-8000-000000000001";
const RUN_AFTER = "run_73000000-0000-4000-8000-000000000001";
const RUN_AFTER_HIGH_WATER =
  "run_74000000-0000-4000-8000-000000000001";
const taskRunId = Brand.nominal<TaskRunIdV1>();
const taskRequestedEffectSequence =
  Brand.nominal<TaskRequestedEffectSequenceV1>();
const DISCOVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 250,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 30_000,
});

describe("DTE06-C3 compute-delivery persistence discovery - PGlite", () => {
  it("exposes exact operation-specific Effect channels", () => {
    expectTypeOf<ReturnType<
      TaskComputeDeliveryCandidateDiscovery["discoverDispatchCandidates"]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDeliveryCandidatePage<"dispatch">,
      TaskComputeDeliveryDiscoveryError<"dispatch">
    >>();
    expectTypeOf<ReturnType<
      TaskComputeDeliveryCandidateDiscovery[
        "discoverCancellationCandidates"
      ]
    >>().toEqualTypeOf<Effect.Effect<
      TaskComputeDeliveryCandidatePage<"cancellation">,
      TaskComputeDeliveryDiscoveryError<"cancellation">
    >>();
  });

  it("captures authority once and preserves the transaction receiver", async () => {
    await withFixture(async ({ persistence, locatedAuthority }) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        persistence.drizzle,
      );
      let observedReceiver: unknown;
      const receiverRunner: RunLocatedReadCommittedTransactionV1 = function <
        Value,
      >(
        this: unknown,
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> {
        observedReceiver = this;
        return base(work);
      };
      const targetOwner = createLocatedTaskComputeDeliveryTargetV1(
        persistence.drizzle,
        TASK_LOCATOR,
        receiverRunner,
      );
      const target = new Proxy(targetOwner, {});
      let authorityReads = 0;
      const located = {
        get authority() {
          authorityReads += 1;
          return locatedAuthority;
        },
        target,
      };
      const discovery = success(makeTaskComputeDeliveryCandidateDiscovery(
        located,
        DISCOVERY_DEADLINE_POLICY,
        "legacy_and_application",
      ));
      expect(authorityReads).toBe(1);
      await runEffect(discovery.discoverDispatchCandidates({ limit: 1 }));
      expect(observedReceiver).toBe(target);
    });
  });

  it("strictly owns and correlates the V1 continuation contract", async () => {
    const valid = {
      codecVersion: 1,
      operation: "dispatch",
      databaseTimeBound: "2026-08-11T00:00:00.000Z",
      highWater: {
        eligibleAt: "2026-08-10T00:00:00.000Z",
        runId: RUN_AFTER,
        requestedEffectSequence: "2",
      },
      last: {
        eligibleAt: "2026-08-10T00:00:00.000Z",
        runId: TASK_RUN_ID,
        requestedEffectSequence: "1",
      },
    } as const;
    const decoded = success(decodeTaskComputeDeliveryContinuationV1(valid));
    const encoded = success(encodeTaskComputeDeliveryContinuationV1(decoded));
    expect(encoded).toEqual(valid);
    expect(encoded).not.toBe(valid);
    expect(encoded.highWater).not.toBe(valid.highWater);
    expect(Object.isFrozen(encoded)).toBe(true);
    expect(Object.isFrozen(encoded.highWater)).toBe(true);

    const excess = decodeTaskComputeDeliveryContinuationV1({
      ...valid,
      excess: true,
    });
    expect(Result.isFailure(excess)).toBe(true);
    if (Result.isSuccess(excess)) throw new Error("excess cursor accepted");
    expect(excess.failure).toBeInstanceOf(
      TaskComputeDeliveryContinuationV1Error,
    );
    expect(excess.failure).toMatchObject({
      operation: "decode",
      issue: "invalid_shape",
    });

    const protoExcess = Object.defineProperty({ ...valid }, "__proto__", {
      value: Object.freeze({ admitted: true }),
      enumerable: true,
    });
    expect(Result.isFailure(
      decodeTaskComputeDeliveryContinuationV1(protoExcess),
    )).toBe(true);

    const backward = decodeTaskComputeDeliveryContinuationV1({
      ...valid,
      last: {
        ...valid.last,
        runId: RUN_AFTER_HIGH_WATER,
      },
    });
    expect(Result.isFailure(backward)).toBe(true);
    if (Result.isSuccess(backward)) throw new Error("backward cursor accepted");
    expect(backward.failure).toMatchObject({ issue: "invalid_ordering" });

    let getterInvoked = false;
    const hostile = Object.defineProperty({}, "codecVersion", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 1;
      },
    });
    expect(Result.isFailure(
      decodeTaskComputeDeliveryContinuationV1(hostile),
    )).toBe(true);
    expect(getterInvoked).toBe(false);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => decodeTaskComputeDeliveryContinuationV1(revoked.proxy))
      .not.toThrow();

    await withFixture(async ({ discovery }) => {
      const failure = await runEffectFailure(
        discovery.discoverCancellationCandidates({
          limit: 1,
          continuation: valid,
        }),
      );
      expect(failure).toBeInstanceOf(TaskComputeDeliveryDiscoveryInputError);
      expect(failure).toMatchObject({
        operation: "cancellation",
        reason: "continuation_operation_mismatch",
      });
    });
  });

  it("discovers unseen, initial, retry-due, and expired-claim candidates separately", async () => {
    await withFixture(async ({
      persistence,
      discovery,
      legacyDiscovery,
      seeded,
      dispatchFixture,
    }) => {
      const initialDispatch = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      const waitingCancellation = await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      );
      expect(candidateKeys(initialDispatch)).toEqual([
        `dispatch:${seeded.runId}:1`,
      ]);
      expect(candidateKeys(waitingCancellation)).toEqual([
        `cancellation:${seeded.runId}:2`,
      ]);
      expect(candidateKeys(await runEffect(
        legacyDiscovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);
      expect(candidateKeys(await runEffect(
        legacyDiscovery.discoverCancellationCandidates({ limit: 10 }),
      ))).toEqual([`cancellation:${seeded.runId}:2`]);

      await persistence.drizzle.delete(
        fxSystemDurableTaskComputeCancellationsV1,
      );
      await persistence.drizzle.delete(fxSystemDurableTaskComputeDispatchesV1);
      await seedPendingComputeEffects(persistence, seeded.scopeId);
      expect(candidateKeys(await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);
      expect(candidateKeys(await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      ))).toEqual([`cancellation:${seeded.runId}:2`]);
      await restoreDispatchCheckpoint(
        persistence,
        dispatchFixture,
        seeded.scopeId,
        seeded.runId,
      );
      await persistence.drizzle.update(
        fxSystemDurableTaskComputeDispatchesV1,
      ).set({
        deliveryState: "retry_wait",
        deliveryAttemptCount: 1n,
        createdAt: sql<Date>`statement_timestamp() - interval '10 seconds'`,
        deliveryStartedAt:
          sql<Date>`statement_timestamp() - interval '5 seconds'`,
        nextAttemptAt: sql<Date>`statement_timestamp() + interval '1 hour'`,
        reasonCode: "provider_transport",
        updatedAt: sql<Date>`statement_timestamp()`,
      });
      expect((await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      )).candidates).toEqual([]);
      await persistence.drizzle.update(
        fxSystemDurableTaskComputeDispatchesV1,
      ).set({
        nextAttemptAt: sql<Date>`statement_timestamp() - interval '1 second'`,
      });
      expect(candidateKeys(await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);
      // Deliberate stored-corruption probe: bypass the typed millisecond shape.
      await persistence.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set next_attempt_at =
          date_trunc('milliseconds', statement_timestamp())
          - interval '1 second' + interval '1 microsecond'
      `);
      const alignmentFailure = await runEffectFailure(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      expect(alignmentFailure).toBeInstanceOf(
        TaskComputeDeliveryDiscoveryCorruptionError,
      );

      await persistence.drizzle.update(
        fxSystemDurableTaskComputeDispatchesV1,
      ).set({
        deliveryState: "prepared",
        deliveryAttemptCount: 0n,
        deliveryStartedAt: null,
        nextAttemptAt: null,
        reasonCode: null,
        claimOwner: "75000000-0000-4000-8000-000000000001",
        claimFence: 1n,
        claimedAt: sql<Date>`statement_timestamp()`,
        claimExpiresAt:
          sql<Date>`statement_timestamp() + interval '1 hour'`,
      });
      expect((await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      )).candidates).toEqual([]);
      await persistence.drizzle.update(
        fxSystemDurableTaskComputeDispatchesV1,
      ).set({
        claimedAt: sql<Date>`statement_timestamp() - interval '2 seconds'`,
        claimExpiresAt:
          sql<Date>`statement_timestamp() - interval '1 second'`,
      });
      expect(candidateKeys(await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      ))).toEqual([`dispatch:${seeded.runId}:1`]);
    });
  });

  it("excludes terminal checkpoints and returns an exact empty page", async () => {
    await withFixture(async ({ persistence, discovery, seeded }) => {
      await settleTaskComputeDeliverySchemaV1(
        persistence,
        seeded.evidence,
      );
      const dispatch = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      const cancellation = await runEffect(
        discovery.discoverCancellationCandidates({ limit: 10 }),
      );
      expect(dispatch.candidates).toEqual([]);
      expect(dispatch.continuation).toBeNull();
      expect(cancellation.candidates).toEqual([]);
      expect(cancellation.continuation).toBeNull();
      expect(dispatch.databaseTimeBound).toMatch(/\.\d{3}Z$/);
    });
  });

  it("fails closed on a malformed driver result", async () => {
    await withFixture(async ({ persistence, locatedAuthority }) => {
      const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
        persistence.drizzle,
      );
      const runnerFor = (
        driverResult: unknown,
      ): RunLocatedReadCommittedTransactionV1 =>
        <Value>(work: (tx: AppRowTransaction) => Promise<Value>) =>
          base((tx) => work(new Proxy(tx, {
            get: (owner, property) => {
              if (property === "execute") {
                return () => Promise.resolve(driverResult);
              }
              const member: unknown = Reflect.get(owner, property, owner);
              return typeof member === "function"
                ? member.bind(owner)
                : member;
            },
          })));
      const discoveryFor = (driverResult: unknown) => {
        const target = createLocatedTaskComputeDeliveryTargetV1(
          persistence.drizzle,
          TASK_LOCATOR,
          runnerFor(driverResult),
        );
        return success(makeTaskComputeDeliveryCandidateDiscovery(
          Object.freeze({ authority: locatedAuthority, target }),
          DISCOVERY_DEADLINE_POLICY,
          "legacy_and_application",
        ));
      };
      const emptyRow = Object.freeze({
        databaseNowEpochMillisecondsText: "0",
        databaseTimeBoundEpochMillisecondsText: "0",
        continuationFuture: false,
        highWaterEligibleAtEpochMillisecondsText: null,
        highWaterTimestampAligned: true,
        highWaterRunId: null,
        highWaterRequestedEffectSequenceText: null,
        candidateEligibleAtEpochMillisecondsText: null,
        candidateTimestampAligned: true,
        candidateRunId: null,
        candidateRequestedEffectSequenceText: null,
      });
      const scenarios = Object.freeze([
        Object.freeze({ rows: Object.freeze([]), reason: "metadata_invalid" }),
        Object.freeze({
          rows: Object.freeze([emptyRow, emptyRow]),
          reason: "candidate_invalid",
        }),
      ] as const);
      for (const scenario of scenarios) {
        const failure = await runEffectFailure(
          discoveryFor({ rows: scenario.rows })
            .discoverDispatchCandidates({ limit: 1 }),
        );
        expect(failure).toBeInstanceOf(
          TaskComputeDeliveryDiscoveryCorruptionError,
        );
        expect(failure).toMatchObject({
          operation: "dispatch",
          reason: scenario.reason,
        });
      }

      const foreignCause = new Error("hostile rows getter");
      const hostileResult = Object.defineProperty({}, "rows", {
        enumerable: true,
        get: () => {
          throw foreignCause;
        },
      });
      const foreignFailure = await runEffectFailure(
        discoveryFor(hostileResult).discoverDispatchCandidates({ limit: 1 }),
      );
      expect(foreignFailure).toBeInstanceOf(
        TaskComputeDeliveryDiscoverySqlError,
      );
      expect(foreignFailure).toMatchObject({
        operation: "dispatch",
        phase: "transaction",
      });
    });
  });

  it("paginates by exact high water and defers later work to a fresh cycle", async () => {
    await withFixture(async ({ persistence, discovery, seeded }) => {
      await persistence.drizzle.delete(
        fxSystemDurableTaskComputeCancellationsV1,
      );
      await persistence.drizzle.delete(fxSystemDurableTaskComputeDispatchesV1);
      await persistence.drizzle.delete(
        fxSystemDurableTaskRequestedEffectsV1,
      ).where(eq(
        fxSystemDurableTaskRequestedEffectsV1.kind,
        "request_execution_cancellation",
      ));
      await seedPendingComputeEffects(persistence, seeded.scopeId);
      await cloneRunAndDispatchEffect(persistence, RUN_BEFORE);
      await cloneRunAndDispatchEffect(persistence, RUN_AFTER);

      const first = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 1 }),
      );
      expect(first.candidates.map((candidate) => candidate.runId)).toEqual([
        RUN_BEFORE,
      ]);
      expect(first.continuation?.highWater.runId).toBe(RUN_AFTER);

      await cloneRunAndDispatchEffect(
        persistence,
        RUN_AFTER_HIGH_WATER,
      );
      const resumed: string[] = [];
      let continuation = first.continuation;
      while (continuation !== null) {
        const page = await runEffect(
          discovery.discoverDispatchCandidates({ limit: 1, continuation }),
        );
        resumed.push(...page.candidates.map((candidate) => candidate.runId));
        continuation = page.continuation;
      }
      expect(resumed).toEqual([TASK_RUN_ID, RUN_AFTER]);

      const fresh = await runEffect(
        discovery.discoverDispatchCandidates({ limit: 10 }),
      );
      expect(fresh.candidates.map((candidate) => candidate.runId)).toEqual([
        RUN_BEFORE,
        TASK_RUN_ID,
        RUN_AFTER,
        RUN_AFTER_HIGH_WATER,
      ]);
    });
  });
});

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    await run(await makeFixture(raw));
  } finally {
    await raw.close();
  }
}

async function makeFixture(raw: PGlite) {
  const persistence = await createPGlitePersistence({ db: raw });
  await persistence.migrate();
  const seeded = await seedTaskComputeDeliverySchemaV1(persistence);
  const [dispatchFixture] = detachDriverRows(
    await persistence.drizzle.select().from(
      fxSystemDurableTaskComputeDispatchesV1,
    ),
  );
  if (dispatchFixture === undefined) {
    throw new Error("compute dispatch fixture missing");
  }
  const target = createLocatedTaskComputeDeliveryTargetV1(
    persistence.drizzle,
    TASK_LOCATOR,
  );
  const lifecycleTarget = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const lifecycleLocated = await locatedTaskAuthorityV1(
    persistence.drizzle,
    lifecycleTarget,
    seeded.scopeId,
    seeded.deploymentId,
  );
  const discovery = success(makeTaskComputeDeliveryCandidateDiscovery(
    Object.freeze({ authority: lifecycleLocated.authority, target }),
    DISCOVERY_DEADLINE_POLICY,
    "legacy_and_application",
  ));
  const legacyDiscovery = success(makeTaskComputeDeliveryCandidateDiscovery(
    Object.freeze({ authority: lifecycleLocated.authority, target }),
    DISCOVERY_DEADLINE_POLICY,
    "legacy_only",
  ));
  return Object.freeze({
    persistence,
    seeded,
    dispatchFixture,
    discovery,
    legacyDiscovery,
    locatedAuthority: lifecycleLocated.authority,
  });
}

function candidateKeys(page: TaskComputeDeliveryCandidatePage): string[] {
  return page.candidates.map((candidate) =>
    `${candidate.operation}:${candidate.runId}:${candidate.requestedEffectSequence}`
  );
}

async function restoreDispatchCheckpoint(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  dispatchFixture: typeof fxSystemDurableTaskComputeDispatchesV1.$inferSelect,
  scopeId: string,
  runId: string,
): Promise<void> {
  await persistence.drizzle.insert(
    fxSystemDurableTaskComputeDispatchesV1,
  ).values(dispatchFixture);
  await persistence.drizzle.delete(
    fxSystemDurableTaskComputePendingV1,
  ).where(and(
    eq(fxSystemDurableTaskComputePendingV1.scopeId, ScopeIdSchema.make(scopeId)),
    eq(fxSystemDurableTaskComputePendingV1.runId, taskRunId(runId)),
    eq(
      fxSystemDurableTaskComputePendingV1.requestedEffectSequence,
      taskRequestedEffectSequence(1n),
    ),
  ));
}

async function seedPendingComputeEffects(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  scopeId: string,
): Promise<void> {
  const effects = await persistence.drizzle.select().from(
    fxSystemDurableTaskRequestedEffectsV1,
  ).where(and(
    eq(
      fxSystemDurableTaskRequestedEffectsV1.scopeId,
      ScopeIdSchema.make(scopeId),
    ),
    inArray(fxSystemDurableTaskRequestedEffectsV1.kind, [
      "dispatch_attempt",
      "request_execution_cancellation",
    ]),
  ));
  const pendingValues = effects.flatMap((effect) =>
    effect.kind === "dispatch_attempt"
        || effect.kind === "request_execution_cancellation"
      ? [{
          scopeId: effect.scopeId,
          runId: effect.runId,
          requestedEffectSequence: effect.sequence,
          kind: effect.kind,
          eligibleAt:
            sql<Date>`date_trunc('milliseconds', statement_timestamp())`,
        }]
      : []
  );
  if (pendingValues.length === 0) return;
  await persistence.drizzle.insert(
    fxSystemDurableTaskComputePendingV1,
  ).values(pendingValues).onConflictDoNothing();
}

async function cloneRunAndDispatchEffect(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  targetRunId: string,
): Promise<void> {
  await seedAdditionalTaskSystemRunV1(
    persistence,
    targetRunId,
  );
  const sourceId = taskRunId(TASK_RUN_ID);
  const targetId = taskRunId(targetRunId);
  const [effect] = await persistence.drizzle.select().from(
    fxSystemDurableTaskRequestedEffectsV1,
  ).where(and(
    eq(fxSystemDurableTaskRequestedEffectsV1.runId, sourceId),
    eq(fxSystemDurableTaskRequestedEffectsV1.kind, "dispatch_attempt"),
  )).limit(1);
  if (effect === undefined) throw new Error("dispatch effect fixture missing");
  await persistence.drizzle.insert(
    fxSystemDurableTaskRequestedEffectsV1,
  ).values({ ...effect, runId: targetId });
  const [pending] = await persistence.drizzle.select().from(
    fxSystemDurableTaskComputePendingV1,
  ).where(and(
    eq(fxSystemDurableTaskComputePendingV1.runId, sourceId),
    eq(fxSystemDurableTaskComputePendingV1.kind, "dispatch_attempt"),
  )).limit(1);
  if (pending === undefined) throw new Error("pending compute fixture missing");
  await persistence.drizzle.insert(
    fxSystemDurableTaskComputePendingV1,
  ).values({ ...pending, runId: targetId });
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
