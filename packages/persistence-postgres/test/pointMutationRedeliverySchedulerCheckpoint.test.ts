import { sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { PointMutationMultiScopeRedeliveryV1 } from
  "../../executor/src/pointMutationMultiScopeRedelivery";
import {
  createPointMutationRedeliverySchedulerRunV1,
  type PointMutationRedeliverySchedulerCheckpointPortV1,
} from "../../executor/src/pointMutationRedeliverySchedulerRun";

import type { AppRowTransaction } from "../src/appRows";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfigurationV1Error,
  PointMutationRedeliverySchedulerCorruptionV1Error,
  PointMutationRedeliverySchedulerDecisionUncertainV1Error,
  PointMutationRedeliverySchedulerInputV1Error,
  PointMutationRedeliverySchedulerResourceExhaustedV1Error,
  PointMutationRedeliverySchedulerSqlV1Error,
  PointMutationRedeliverySchedulerStaleV1Error,
  createPointMutationRedeliverySchedulerCheckpointV1,
  isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error,
  type PointMutationRedeliverySchedulerAcquireV1Error,
  type PointMutationRedeliverySchedulerCheckpointV1,
  type PointMutationRedeliverySchedulerCheckpointV1Error,
  type PointMutationRedeliverySchedulerReleaseV1Error,
  type PointMutationRedeliverySchedulerRenewV1Error,
  type PointMutationRedeliverySchedulerRunV1,
} from "../src/pointMutationRedeliverySchedulerCheckpoint";
import {
  MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1,
} from "../src/pointMutationRedeliverySchedulerModel";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import * as persistenceRoot from "../src";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "point-mutation-redelivery-scheduler-test",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const OWNER_ONE = "76000000-0000-4000-8000-000000000001";
const OWNER_TWO = "76000000-0000-4000-8000-000000000002";

describe("O08-B2b2b2b1b2b2b0 scheduler checkpoint foundation", () => {
  it("classifies confirmed rollback only by direct class and exact operation", () => {
    const direct = new PointMutationRedeliverySchedulerConfirmedRollbackV1Error({
      operation: "acquire",
      cause: new Error("rolled back"),
    });
    expect(
      isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error(direct),
    ).toBe(true);
    expect(
      isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error(direct),
    ).toBe(false);
    expect(Reflect.apply(
      isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
      undefined,
      [Object.freeze({
        _tag: "PointMutationRedeliverySchedulerConfirmedRollbackV1Error",
        operation: "acquire",
        cause: direct.cause,
      })],
    )).toBe(false);
  });

  it("migrates one fixed-key idle singleton with strict constraints", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const rows = await schedulerRows(persistence);
    expect(rows).toEqual([expect.objectContaining({
      scheduler_key: POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1,
      scheduler_state: "idle",
      run_fence: 0,
      checkpoint_sequence: 0,
      run_owner: null,
      claim_expires_at: null,
      continuation_bytes: null,
    })]);

    await expect(persistence.drizzle.execute(sql`
      insert into fx_system_point_mutation_redelivery_scheduler
        (scheduler_key, scheduler_state, run_fence, checkpoint_sequence)
      values (${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}, 'idle', 0, 0)
    `)).rejects.toThrow();
    expect(persistenceRoot).not.toHaveProperty(
      "createPointMutationRedeliverySchedulerCheckpointV1",
    );
    await expect(persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set scheduler_state = 'claimed'
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `)).rejects.toThrow();
    await expect(persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set scheduler_key = 'another_scheduler'
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `)).rejects.toThrow();
  });

  it("acquires once, checkpoints detached bytes, renews, releases, and reloads only durable truth", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const first = repository(persistence, [OWNER_ONE]);
    const acquired = await acquire(first);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const checkpointEvidence = await continuationEvidence(bytes);
    const checkpointed = await runEffect(
      first.checkpointEffect(acquired.run, checkpointEvidence),
    );
    bytes.fill(99);
    expect(checkpointed.checkpointSequence).toBe(1n);
    const competing = repository(persistence, [OWNER_TWO]);
    expect(await runEffect(competing.acquireEffect())).toMatchObject({
      kind: "busy",
    });
    const renewed = await runEffect(first.renewEffect(acquired.run));
    expect(renewed.claimExpiresAt.getTime()).toBeGreaterThan(
      acquired.claimExpiresAt.getTime(),
    );
    await runEffect(first.releaseEffect(acquired.run));
    const firstClosed = await runEffectFailure(first.releaseEffect(acquired.run));
    expect(firstClosed).toBeInstanceOf(
      PointMutationRedeliverySchedulerInputV1Error,
    );

    await persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set next_run_at = clock_timestamp() + interval '1 hour'
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const restarted = repository(persistence, [OWNER_TWO]);
    expect(await runEffect(restarted.acquireEffect())).toMatchObject({
      kind: "notDue",
    });
    await persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set next_run_at = clock_timestamp()
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const reloaded = await acquire(restarted);
    expect([...reloaded.continuation!.canonicalBytes]).toEqual([1, 2, 3, 4]);
    const detached = reloaded.continuation!.canonicalBytes;
    detached.fill(77);
    expect([...reloaded.continuation!.canonicalBytes]).toEqual([1, 2, 3, 4]);
    expect(reloaded.run).not.toBe(acquired.run);
  });

  it("runs one bounded invocation outside durable truth and restarts from the exact checkpoint", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const continuation = Object.freeze({
      codecVersion: 1 as const,
      directory: Object.freeze({ kind: "unstarted" as const }),
      scopes: Object.freeze([]),
    });
    const observedInputs: unknown[] = [];
    let calls = 0;
    const multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect"> =
      Object.freeze({
        sweepEffect: (input) => {
          observedInputs.push(input);
          calls += 1;
          return Effect.succeed(Object.freeze({
            scopeDirectoryQueries: 0,
            attemptPagesCharged: 1,
            candidateAttemptsCharged: 1,
            scopes: Object.freeze([]),
            continuation: calls === 1 ? continuation : null,
          }));
        },
      });

    const first = schedulerRunner(repository(persistence, [OWNER_ONE]), multiScope);
    await expect(runEffect(first.runEffect())).resolves.toMatchObject({
      kind: "completed",
      reason: "countBudget",
      invocations: 1,
    });
    expect((await schedulerRows(persistence))[0]).toMatchObject({
      scheduler_state: "idle",
      checkpoint_sequence: 1,
    });

    const restarted = schedulerRunner(
      repository(persistence, [OWNER_TWO]),
      multiScope,
    );
    await expect(runEffect(restarted.runEffect())).resolves.toMatchObject({
      kind: "completed",
      reason: "continuationExhausted",
      invocations: 1,
    });
    expect(observedInputs[0]).not.toHaveProperty("continuation");
    expect(observedInputs[1]).toHaveProperty("continuation", continuation);
    expect((await schedulerRows(persistence))[0]).toMatchObject({
      scheduler_state: "idle",
      checkpoint_sequence: 1,
      continuation_bytes: null,
    });
  });

  it("serializes duplicate acquisition and lets only an expired claim advance the lifetime fence", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const left = repository(persistence, [OWNER_ONE]);
    const right = repository(persistence, [OWNER_TWO]);
    const [one, two] = await Promise.all([
      runEffect(left.acquireEffect()),
      runEffect(right.acquireEffect()),
    ]);
    expect([one.kind, two.kind].sort()).toEqual(["acquired", "busy"]);
    const previous = one.kind === "acquired"
      ? { result: one, repository: left }
      : two.kind === "acquired"
      ? { result: two, repository: right }
      : undefined;
    if (previous === undefined) throw new Error("Expected one acquisition.");

    await persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set
        claimed_at = clock_timestamp() - interval '2 seconds',
        claim_expires_at = clock_timestamp() - interval '1 second'
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const winner = await acquire(
      one.kind === "acquired" ? right : left,
    );
    const rows = await schedulerRows(persistence);
    expect(BigInt(rows[0]?.run_fence ?? -1)).toBe(2n);
    expect(winner.claimExpiresAt).toBeInstanceOf(Date);
    expect(await runEffectFailure(
      previous.repository.renewEffect(previous.result.run),
    )).toBeInstanceOf(PointMutationRedeliverySchedulerStaleV1Error);
  });

  it("returns notDue without advancing the singleton fence", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set next_run_at = clock_timestamp() + interval '1 hour'
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const result = await runEffect(
      repository(persistence, [OWNER_ONE]).acquireEffect(),
    );
    expect(result).toMatchObject({ kind: "notDue" });
    expect((await schedulerRows(persistence))[0]).toMatchObject({
      scheduler_state: "idle",
      run_fence: 0,
    });
  });

  it("rejects stale, out-of-order, and forged handles", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const base = locatedTarget(persistence);
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(base, {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => OWNER_ONE,
    });
    const acquired = await acquire(repo);

    const forged = Object.freeze({
      _tag: "PointMutationRedeliverySchedulerRunV1" as const,
    });
    expect(await runEffectFailure(repo.renewEffect(forged))).toBeInstanceOf(
      PointMutationRedeliverySchedulerInputV1Error,
    );
    const otherFactory = repository(persistence, [OWNER_TWO]);
    expect(await runEffectFailure(otherFactory.renewEffect(acquired.run)))
      .toBeInstanceOf(PointMutationRedeliverySchedulerInputV1Error);

    await persistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set checkpoint_sequence = 1
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    expect(
      await runEffectFailure(repo.checkpointEffect(acquired.run, null)),
    ).toBeInstanceOf(PointMutationRedeliverySchedulerStaleV1Error);
  });

  it("permits one exact confirmed-rollback retry and closes on mismatch or a second rollback", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let rejectStatements = false;
    const cause = new Error("confirmed statement rollback");
    const target = switchableStatementTarget(
      locatedTarget(persistence),
      () => rejectStatements,
      cause,
    );
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(target, {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => OWNER_ONE,
    });
    const acquired = await acquire(repo);
    rejectStatements = true;
    const first = await runEffectFailure(
      repo.checkpointEffect(
        acquired.run,
        await continuationEvidence(new Uint8Array([1])),
      ),
    );
    expect(first).toBeInstanceOf(
      PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
    );
    const mismatch = await runEffectFailure(
      repo.checkpointEffect(
        acquired.run,
        await continuationEvidence(new Uint8Array([2])),
      ),
    );
    expect(mismatch).toMatchObject({ reason: "retryCommandMismatch" });
    expect(await runEffectFailure(repo.renewEffect(acquired.run))).toMatchObject({
      reason: "runClosed",
    });

    const secondPersistence = await createMigratedPGlitePersistence();
    let secondReject = false;
    const secondRepo = createPointMutationRedeliverySchedulerCheckpointV1(
      switchableStatementTarget(
        locatedTarget(secondPersistence),
        () => secondReject,
        cause,
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const secondRun = await acquire(secondRepo);
    secondReject = true;
    expect(await runEffectFailure(secondRepo.renewEffect(secondRun.run)))
      .toBeInstanceOf(PointMutationRedeliverySchedulerConfirmedRollbackV1Error);
    expect(await runEffectFailure(secondRepo.renewEffect(secondRun.run)))
      .toBeInstanceOf(PointMutationRedeliverySchedulerConfirmedRollbackV1Error);
    expect(await runEffectFailure(secondRepo.renewEffect(secondRun.run)))
      .toMatchObject({ reason: "runClosed" });
  });

  it("serializes same-run operations without erasing an exact rollback retry", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const base = locatedTarget(persistence);
    const statementCause = new Error("overlapped checkpoint rollback");
    let invocation = 0;
    let releaseRenew = () => {};
    let markRenewCommitted = () => {};
    const renewCommitted = new Promise<void>((resolve) => {
      markRenewCommitted = resolve;
    });
    const renewRelease = new Promise<void>((resolve) => {
      releaseRenew = resolve;
    });
    const target: LocatedReadCommittedAttemptTargetV1 = Object.freeze({
      physicalLocator: base.physicalLocator,
      getCurrentClock: (scopeId: ScopeId) => base.getCurrentClock(scopeId),
      [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
        work: (tx: AppRowTransaction) => Promise<Result>,
      ): Promise<Result> => {
        const currentInvocation = ++invocation;
        if (currentInvocation === 2) {
          const result = await base[RUN_LOCATED_READ_COMMITTED_V1](work);
          markRenewCommitted();
          await renewRelease;
          return result;
        }
        if (currentInvocation === 3) {
          return base[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
            work(statementRejectingTransaction(
              tx,
              () => true,
              statementCause,
            ))
          );
        }
        return base[RUN_LOCATED_READ_COMMITTED_V1](work);
      },
    });
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(target, {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => OWNER_ONE,
    });
    const acquired = await acquire(repo);
    const renewing = runEffect(repo.renewEffect(acquired.run));
    await renewCommitted;
    const exactEvidence = await continuationEvidence(new Uint8Array([1]));
    const checkpointing = runEffectFailure(
      repo.checkpointEffect(acquired.run, exactEvidence),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseRenew();
    await expect(renewing).resolves.toMatchObject({ kind: "renewed" });
    expect(await checkpointing).toBeInstanceOf(
      PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
    );
    expect(await runEffectFailure(
      repo.checkpointEffect(
        acquired.run,
        await continuationEvidence(new Uint8Array([2])),
      ),
    )).toMatchObject({ reason: "retryCommandMismatch" });
    expect(await runEffectFailure(repo.renewEffect(acquired.run)))
      .toMatchObject({ reason: "runClosed" });
  });

  it("linearizes a queued command behind an in-flight exact retry", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const base = locatedTarget(persistence);
    const statementCause = new Error("initial exact checkpoint rollback");
    let invocation = 0;
    let releaseExactRetry = () => {};
    let markExactRetryCommitted = () => {};
    const exactRetryCommitted = new Promise<void>((resolve) => {
      markExactRetryCommitted = resolve;
    });
    const exactRetryRelease = new Promise<void>((resolve) => {
      releaseExactRetry = resolve;
    });
    const target: LocatedReadCommittedAttemptTargetV1 = Object.freeze({
      physicalLocator: base.physicalLocator,
      getCurrentClock: (scopeId: ScopeId) => base.getCurrentClock(scopeId),
      [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
        work: (tx: AppRowTransaction) => Promise<Result>,
      ): Promise<Result> => {
        const currentInvocation = ++invocation;
        if (currentInvocation === 2) {
          return base[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
            work(statementRejectingTransaction(
              tx,
              () => true,
              statementCause,
            ))
          );
        }
        const result = await base[RUN_LOCATED_READ_COMMITTED_V1](work);
        if (currentInvocation === 3) {
          markExactRetryCommitted();
          await exactRetryRelease;
        }
        return result;
      },
    });
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(target, {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => OWNER_ONE,
    });
    const acquired = await acquire(repo);
    const exactEvidence = await continuationEvidence(new Uint8Array([1]));
    expect(await runEffectFailure(
      repo.checkpointEffect(acquired.run, exactEvidence),
    )).toBeInstanceOf(
      PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
    );

    const exactRetry = runEffect(
      repo.checkpointEffect(acquired.run, exactEvidence),
    );
    await exactRetryCommitted;
    const queuedNext = runEffect(
      repo.checkpointEffect(
        acquired.run,
        await continuationEvidence(new Uint8Array([2])),
      ),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releaseExactRetry();
    await expect(exactRetry).resolves.toMatchObject({
      kind: "checkpointed",
      checkpointSequence: 1n,
    });
    await expect(queuedNext).resolves.toMatchObject({
      kind: "checkpointed",
      checkpointSequence: 2n,
    });
    await expect(runEffect(repo.renewEffect(acquired.run))).resolves
      .toMatchObject({ kind: "renewed" });
  });

  it("maps decision uncertainty, cleanup, and infrastructure without minting a run", async () => {
    const persistence = await createMigratedPGlitePersistence();
    for (const [issue, Expected] of [
      [
        Object.freeze({
          kind: "decisionUncertain" as const,
          settlementCause: new Error("lost settlement"),
        }),
        PointMutationRedeliverySchedulerDecisionUncertainV1Error,
      ],
      [
        Object.freeze({
          kind: "callbackCleanupFailed" as const,
          callbackCause: new Error("callback"),
          transactionCause: new Error("rollback failed"),
        }),
        PointMutationRedeliverySchedulerSqlV1Error,
      ],
      [
        Object.freeze({
          kind: "infrastructureFailure" as const,
          phase: "beginOrConfigure" as const,
          cause: new Error("begin failed"),
        }),
        PointMutationRedeliverySchedulerSqlV1Error,
      ],
    ] as const) {
      const repo = createPointMutationRedeliverySchedulerCheckpointV1(
        failingTarget(locatedTarget(persistence), issue),
        { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
      );
      expect(await runEffectFailure(repo.acquireEffect())).toBeInstanceOf(Expected);
    }
    expect((await schedulerRows(persistence))[0]).toMatchObject({
      scheduler_state: "idle",
      run_fence: 0,
    });
  });

  it("preserves an unexpected rolled-back callback cause as a defect", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const defect = new Error("unexpected scheduler callback defect");
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(
      failingTarget(locatedTarget(persistence), Object.freeze({
        kind: "callbackRolledBack" as const,
        callbackCause: defect,
      })),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const exit = await Effect.runPromiseExit(repo.acquireEffect());
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("preserves a maximum-duration claim-expiry configuration failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(
      locatedTarget(persistence),
      {
        claimDurationMilliseconds: Number.MAX_SAFE_INTEGER,
        randomUuid: () => OWNER_ONE,
      },
    );
    expect(await runEffectFailure(repo.acquireEffect())).toBeInstanceOf(
      PointMutationRedeliverySchedulerConfigurationV1Error,
    );
    expect((await schedulerRows(persistence))[0]).toMatchObject({
      scheduler_state: "idle",
      run_fence: 0,
    });
  });

  it("closes a run after a transaction defect or interruption", async () => {
    const defectPersistence = await createMigratedPGlitePersistence();
    let defectEnabled = false;
    const defect = new Error("unexpected renewal defect");
    const defectRepo = createPointMutationRedeliverySchedulerCheckpointV1(
      switchableFailureTarget(
        locatedTarget(defectPersistence),
        () => defectEnabled,
        () => Object.freeze({
          kind: "callbackRolledBack" as const,
          callbackCause: defect,
        }),
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const defectRun = await acquire(defectRepo);
    defectEnabled = true;
    const defectExit = await Effect.runPromiseExit(
      defectRepo.renewEffect(defectRun.run),
    );
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      expect(Cause.hasDies(defectExit.cause)).toBe(true);
    }
    expect(await runEffectFailure(defectRepo.renewEffect(defectRun.run)))
      .toMatchObject({ reason: "runClosed" });

    const interruptedPersistence = await createMigratedPGlitePersistence();
    let blockSettlement = false;
    let releaseSettlement = () => {};
    let markSettlementBlocked = () => {};
    const settlementBlocked = new Promise<void>((resolve) => {
      markSettlementBlocked = resolve;
    });
    const settlementRelease = new Promise<void>((resolve) => {
      releaseSettlement = resolve;
    });
    const interruptedRepo = createPointMutationRedeliverySchedulerCheckpointV1(
      blockingSettledTarget(
        locatedTarget(interruptedPersistence),
        () => blockSettlement,
        () => markSettlementBlocked(),
        settlementRelease,
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_TWO },
    );
    const interruptedRun = await acquire(interruptedRepo);
    blockSettlement = true;
    const fiber = Effect.runFork(interruptedRepo.renewEffect(interruptedRun.run));
    const completion = runEffect(Fiber.await(fiber));
    await settlementBlocked;
    const interrupting = runEffect(Fiber.interrupt(fiber));
    releaseSettlement();
    await interrupting;
    const interruptedExit = await completion;
    expect(Exit.isFailure(interruptedExit)).toBe(true);
    if (Exit.isFailure(interruptedExit)) {
      expect(Cause.hasInterruptsOnly(interruptedExit.cause)).toBe(true);
    }
    expect(await runEffectFailure(
      interruptedRepo.renewEffect(interruptedRun.run),
    )).toMatchObject({ reason: "runClosed" });
  });

  it("closes a run after uncertain renewal so an in-flight result cannot checkpoint or start another invocation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let becomeUncertain = false;
    const repo = createPointMutationRedeliverySchedulerCheckpointV1(
      switchableCommittedThenUncertainTarget(
        locatedTarget(persistence),
        () => becomeUncertain,
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const acquired = await acquire(repo);
    becomeUncertain = true;
    expect(await runEffectFailure(repo.renewEffect(acquired.run)))
      .toBeInstanceOf(
        PointMutationRedeliverySchedulerDecisionUncertainV1Error,
      );
    expect(await runEffectFailure(
      repo.checkpointEffect(
        acquired.run,
        await continuationEvidence(new Uint8Array([1])),
      ),
    )).toMatchObject({ reason: "runClosed" });
    expect(await runEffectFailure(repo.renewEffect(acquired.run)))
      .toMatchObject({ reason: "runClosed" });
    expect((await schedulerRows(persistence))[0]).toMatchObject({
      scheduler_state: "claimed",
      checkpoint_sequence: 0,
      continuation_bytes: null,
    });
  });

  it("fails closed on missing singleton, fence exhaustion, and oversized stored evidence without fetching it", async () => {
    const missingPersistence = await createMigratedPGlitePersistence();
    await missingPersistence.drizzle.execute(sql`
      delete from fx_system_point_mutation_redelivery_scheduler
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const missing = await runEffectFailure(
      repository(missingPersistence, [OWNER_ONE]).acquireEffect(),
    );
    expect(missing).toMatchObject({ reason: "singletonMissing" });

    const exhaustedPersistence = await createMigratedPGlitePersistence();
    await exhaustedPersistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set run_fence = 9223372036854775807
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    expect(await runEffectFailure(
      repository(exhaustedPersistence, [OWNER_ONE]).acquireEffect(),
    )).toBeInstanceOf(
      PointMutationRedeliverySchedulerResourceExhaustedV1Error,
    );
    expect(BigInt(
      (await schedulerRows(exhaustedPersistence))[0]?.run_fence ?? -1,
    )).toBe(9_223_372_036_854_775_807n);

    const checkpointExhaustedPersistence =
      await createMigratedPGlitePersistence();
    const checkpointExhaustedRepository = repository(
      checkpointExhaustedPersistence,
      [OWNER_ONE],
    );
    const checkpointExhaustedRun = await acquire(
      checkpointExhaustedRepository,
    );
    await checkpointExhaustedPersistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set checkpoint_sequence = 9223372036854775807
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const checkpointExhausted = await runEffectFailure(
      checkpointExhaustedRepository.checkpointEffect(
        checkpointExhaustedRun.run,
        null,
      ),
    );
    expect(checkpointExhausted).toMatchObject({
      dimension: "checkpointSequence",
      observed: 9_223_372_036_854_775_807n,
    });

    const oversizedPersistence = await createMigratedPGlitePersistence();
    await oversizedPersistence.drizzle.execute(sql.raw(
      "alter table fx_system_point_mutation_redelivery_scheduler " +
        "drop constraint fx_system_point_mutation_redelivery_scheduler_continuation_check",
    ));
    await oversizedPersistence.drizzle.execute(sql`
      update fx_system_point_mutation_redelivery_scheduler
      set
        continuation_codec_version = 1,
        continuation_bytes = ${new Uint8Array(
          MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1 + 1,
        )},
        continuation_sha256 = ${new Uint8Array(32)}
      where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
    `);
    const oversized = await runEffectFailure(
      repository(oversizedPersistence, [OWNER_ONE]).acquireEffect(),
    );
    expect(oversized).toMatchObject({ reason: "continuationInvalid" });
  }, 30_000);

  it("accepts exactly 4 MiB and rejects plus one before any checkpoint mutation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const repo = repository(persistence, [OWNER_ONE]);
    const acquired = await acquire(repo);
    const maximum = new Uint8Array(
      MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
    );
    await expect(runEffect(
      repo.checkpointEffect(
        acquired.run,
        await continuationEvidence(maximum),
      ),
    )).resolves.toMatchObject({ checkpointSequence: 1n });
    const tooLarge = new Uint8Array(
      MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1 + 1,
    );
    expect(await runEffectFailure(
      repo.checkpointEffect(acquired.run, {
        codecVersion: 1,
        canonicalBytes: tooLarge,
        sha256: new Uint8Array(32),
      }),
    )).toMatchObject({ reason: "invalidContinuation" });
    expect(await runEffectFailure(
      repo.checkpointEffect(acquired.run, {
        codecVersion: 1,
        canonicalBytes: new Uint8Array([1]),
        sha256: new Uint8Array(32),
      }),
    )).toMatchObject({ reason: "invalidContinuation" });
    expect((await schedulerRows(persistence))[0]?.checkpoint_sequence).toBe(1);
  }, 30_000);
});

function repository(
  persistence: PGliteFlarexPersistence,
  owners: readonly string[],
): PointMutationRedeliverySchedulerCheckpointV1 {
  let index = 0;
  return createPointMutationRedeliverySchedulerCheckpointV1(
    locatedTarget(persistence),
    {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => owners[index++] ?? OWNER_TWO,
    },
  );
}

function schedulerRunner(
  repository: PointMutationRedeliverySchedulerCheckpointV1,
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
) {
  return Result.getOrThrow(createPointMutationRedeliverySchedulerRunV1(
    schedulerCheckpointPort(repository),
    multiScope,
    Object.freeze({
      maximumInvocations: 1,
      maximumAttemptPages: 2,
      maximumCandidateAttempts: 2,
      scopeLimitPerInvocation: 2,
      maximumRunMilliseconds: 10_000,
      maximumInvocationMilliseconds: 5_000,
      settlementReserveMilliseconds: 1_000,
    }),
  ));
}

function schedulerCheckpointPort(
  repository: PointMutationRedeliverySchedulerCheckpointV1,
): PointMutationRedeliverySchedulerCheckpointPortV1<
  PointMutationRedeliverySchedulerRunV1,
  PointMutationRedeliverySchedulerConfigurationV1Error,
  PointMutationRedeliverySchedulerAcquireV1Error,
  PointMutationRedeliverySchedulerRenewV1Error,
  PointMutationRedeliverySchedulerCheckpointV1Error,
  PointMutationRedeliverySchedulerReleaseV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error
> {
  return Object.freeze({
    ...repository,
    isAcquireConfirmedRollback:
      isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
    isRenewConfirmedRollback:
      isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error,
    isCheckpointConfirmedRollback:
      isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error,
    isReleaseConfirmedRollback:
      isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error,
  });
}

function locatedTarget(
  persistence: PGliteFlarexPersistence,
): LocatedReadCommittedAttemptTargetV1 {
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED PGlite target.");
  }
  return target;
}

async function acquire(
  repo: PointMutationRedeliverySchedulerCheckpointV1,
) {
  const result = await runEffect(repo.acquireEffect());
  if (result.kind !== "acquired") {
    throw new Error(`Expected acquisition, observed ${result.kind}.`);
  }
  return result;
}

function failingTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  issue: ConstructorParameters<typeof LocatedReadCommittedTransactionFailureV1>[0],
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
      _work: Parameters<
        LocatedReadCommittedAttemptTargetV1[typeof RUN_LOCATED_READ_COMMITTED_V1]
      >[0],
    ): Promise<Result> => {
      throw new LocatedReadCommittedTransactionFailureV1(issue);
    },
  });
}

function switchableFailureTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  shouldFail: () => boolean,
  issue: () => ConstructorParameters<
    typeof LocatedReadCommittedTransactionFailureV1
  >[0],
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> =>
      shouldFail()
        ? Promise.reject(new LocatedReadCommittedTransactionFailureV1(issue()))
        : target[RUN_LOCATED_READ_COMMITTED_V1](work),
  });
}

function blockingSettledTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  shouldBlock: () => boolean,
  onBlocked: () => void,
  release: Promise<void>,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => {
      const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
      if (shouldBlock()) {
        onBlocked();
        await release;
      }
      return result;
    },
  });
}

function switchableStatementTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  shouldReject: () => boolean,
  cause: unknown,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
      work(statementRejectingTransaction(tx, shouldReject, cause))
    ),
  });
}

function switchableCommittedThenUncertainTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  shouldBecomeUncertain: () => boolean,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => {
      const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
      if (shouldBecomeUncertain()) {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: new Error("simulated lost settlement response"),
        }));
      }
      return result;
    },
  });
}

function statementRejectingTransaction(
  tx: AppRowTransaction,
  shouldReject: () => boolean,
  cause: unknown,
): AppRowTransaction {
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === "execute") {
        return (statement: Parameters<AppRowTransaction["execute"]>[0]) =>
          shouldReject()
            ? Promise.reject(cause)
            : target.execute(statement);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

async function schedulerRows(persistence: PGliteFlarexPersistence) {
  return persistence.query<{
    readonly scheduler_key: string;
    readonly scheduler_state: string;
    readonly run_fence: number | bigint;
    readonly checkpoint_sequence: number | bigint;
    readonly run_owner: string | null;
    readonly claim_expires_at: Date | null;
    readonly continuation_bytes: Uint8Array | null;
  }>(
    "select scheduler_key, scheduler_state, run_fence, checkpoint_sequence, " +
      "run_owner, claim_expires_at, continuation_bytes " +
      "from fx_system_point_mutation_redelivery_scheduler",
  ).then((result) => result.rows);
}

async function continuationEvidence(bytes: Uint8Array) {
  const input = new Uint8Array(bytes);
  return Object.freeze({
    codecVersion: 1 as const,
    canonicalBytes: input,
    sha256: new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
  });
}
