import { sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { AppRowTransaction } from "../src/appRows";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  RetainedHistorySchedulerConfirmedRollbackV1Error,
  RetainedHistorySchedulerCorruptionV1Error,
  RetainedHistorySchedulerDecisionUncertainV1Error,
  RetainedHistorySchedulerInputV1Error,
  RetainedHistorySchedulerStaleV1Error,
  createRetainedHistorySchedulerCheckpointV1,
  type RetainedHistorySchedulerCheckpointV1,
} from "../src/retainedHistorySchedulerCheckpointV1";
import { RETAINED_HISTORY_SCHEDULER_KEY_V1 } from
  "../src/retainedHistorySchedulerModelV1";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const OWNER_ONE = "94000000-0000-4000-8000-000000000001";
const OWNER_TWO = "94000000-0000-4000-8000-000000000002";

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "retained-history-scheduler-checkpoint-test",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describe("O11-F1 retained-history scheduler checkpoint", () => {
  it("persists owned evidence, reloads it cold, and isolates both existing schedulers", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const first = repository(persistence, OWNER_ONE);
    const acquired = await acquire(first);
    const sourceBytes = new Uint8Array([1, 2, 3, 4]);
    const evidence = await continuationEvidence(sourceBytes);

    await expect(runEffect(
      first.checkpointEffect(acquired.run, evidence),
    )).resolves.toMatchObject({ checkpointSequence: 1n });
    sourceBytes.fill(91);
    evidence.canonicalBytes.fill(92);
    await expect(runEffect(first.renewEffect(acquired.run))).resolves
      .toMatchObject({ kind: "renewed" });
    await expect(runEffect(first.releaseEffect(acquired.run))).resolves
      .toMatchObject({ kind: "released" });
    expect(await runEffectFailure(first.releaseEffect(acquired.run)))
      .toBeInstanceOf(RetainedHistorySchedulerInputV1Error);

    const restarted = repository(persistence, OWNER_TWO);
    const reloaded = await acquire(restarted);
    expect([...reloaded.continuation!.canonicalBytes]).toEqual([1, 2, 3, 4]);
    reloaded.continuation!.canonicalBytes.fill(77);
    expect([...reloaded.continuation!.canonicalBytes]).toEqual([1, 2, 3, 4]);
    expect(await runEffectFailure(restarted.renewEffect({
      ...reloaded.run,
    }))).toBeInstanceOf(RetainedHistorySchedulerInputV1Error);

    expect(await schedulerRows(persistence)).toEqual([
      {
        table_name: "retained",
        run_fence: 2,
        checkpoint_sequence: 0,
      },
      { table_name: "point", run_fence: 0, checkpoint_sequence: 0 },
      { table_name: "task", run_fence: 0, checkpoint_sequence: 0 },
    ]);
  });

  it("fences competing owners and rejects stale checkpoint state", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const first = repository(persistence, OWNER_ONE);
    const second = repository(persistence, OWNER_TWO);
    const acquired = await acquire(first);
    await expect(runEffect(second.acquireEffect())).resolves.toMatchObject({
      kind: "busy",
    });
    await persistence.drizzle.execute(sql`
      update fx_system_retained_history_scheduler
      set checkpoint_sequence = 1
      where scheduler_key = ${RETAINED_HISTORY_SCHEDULER_KEY_V1}
    `);
    expect(await runEffectFailure(
      first.checkpointEffect(acquired.run, null),
    )).toBeInstanceOf(RetainedHistorySchedulerStaleV1Error);
  });

  it("fails closed on digest-corrupted durable continuation evidence", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const first = repository(persistence, OWNER_ONE);
    const acquired = await acquire(first);
    await runEffect(first.checkpointEffect(
      acquired.run,
      await continuationEvidence(new Uint8Array([8, 9])),
    ));
    await runEffect(first.releaseEffect(acquired.run));
    await persistence.drizzle.execute(sql`
      update fx_system_retained_history_scheduler
      set continuation_sha256 = decode(repeat('00', 32), 'hex')
      where scheduler_key = ${RETAINED_HISTORY_SCHEDULER_KEY_V1}
    `);
    const failure = await runEffectFailure(
      repository(persistence, OWNER_TWO).acquireEffect(),
    );
    expect(failure).toBeInstanceOf(RetainedHistorySchedulerCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "continuationDigestMismatch" });
    expect(await retainedRow(persistence)).toMatchObject({
      scheduler_state: "claimed",
      run_fence: 2,
      checkpoint_sequence: 0,
      run_owner: OWNER_TWO,
    });
  });

  it("recovers confirmed rollback exactly and cold-recovers an uncertain committed claim", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let reject = false;
    const statementCause = new Error("injected retained-history statement failure");
    const withFailure = createRetainedHistorySchedulerCheckpointV1(
      switchableStatementTarget(
        locatedTarget(persistence),
        () => reject,
        statementCause,
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const acquired = await acquire(withFailure);
    const evidence = await continuationEvidence(new Uint8Array([5]));
    reject = true;
    expect(await runEffectFailure(
      withFailure.checkpointEffect(acquired.run, evidence),
    )).toBeInstanceOf(RetainedHistorySchedulerConfirmedRollbackV1Error);
    expect(await retainedRow(persistence)).toMatchObject({
      checkpoint_sequence: 0,
      continuation_bytes: null,
    });
    reject = false;
    await expect(runEffect(
      withFailure.checkpointEffect(acquired.run, evidence),
    )).resolves.toMatchObject({ checkpointSequence: 1n });
    await runEffect(withFailure.releaseEffect(acquired.run));

    const uncertain = createRetainedHistorySchedulerCheckpointV1(
      committedThenUncertainTarget(locatedTarget(persistence)),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_TWO },
    );
    expect(await runEffectFailure(uncertain.acquireEffect())).toBeInstanceOf(
      RetainedHistorySchedulerDecisionUncertainV1Error,
    );
    expect(await retainedRow(persistence)).toMatchObject({
      scheduler_state: "claimed",
      run_fence: 2,
      run_owner: OWNER_TWO,
    });
    const fresh = repository(persistence, OWNER_ONE);
    await expect(runEffect(fresh.acquireEffect())).resolves.toMatchObject({
      kind: "busy",
    });
    await persistence.drizzle.execute(sql`
      update fx_system_retained_history_scheduler
      set
        claimed_at = now() - interval '2 seconds',
        claim_expires_at = now() - interval '1 second'
      where scheduler_key = ${RETAINED_HISTORY_SCHEDULER_KEY_V1}
    `);
    await expect(acquire(fresh)).resolves.toMatchObject({ kind: "acquired" });
    expect(await retainedRow(persistence)).toMatchObject({
      run_fence: 3,
      run_owner: OWNER_ONE,
    });
  });

  it("closes the opaque run when settlement is interrupted", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let blockSettlement = false;
    let releaseSettlement = () => {};
    let markSettlementBlocked = () => {};
    const settlementBlocked = new Promise<void>((resolve) => {
      markSettlementBlocked = resolve;
    });
    const settlementRelease = new Promise<void>((resolve) => {
      releaseSettlement = resolve;
    });
    const checkpoint = createRetainedHistorySchedulerCheckpointV1(
      blockingSettledTarget(
        locatedTarget(persistence),
        () => blockSettlement,
        () => markSettlementBlocked(),
        settlementRelease,
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const acquired = await acquire(checkpoint);
    blockSettlement = true;
    const fiber = Effect.runFork(checkpoint.renewEffect(acquired.run));
    const completion = runEffect(Fiber.await(fiber));
    await settlementBlocked;
    const interrupting = runEffect(Fiber.interrupt(fiber));
    releaseSettlement();
    await interrupting;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(await runEffectFailure(checkpoint.renewEffect(acquired.run)))
      .toMatchObject({ reason: "runClosed" });
  });
});

function repository(
  persistence: PGliteFlarexPersistence,
  owner: string,
): RetainedHistorySchedulerCheckpointV1 {
  return createRetainedHistorySchedulerCheckpointV1(
    locatedTarget(persistence),
    { claimDurationMilliseconds: 60_000, randomUuid: () => owner },
  );
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

async function acquire(repository: RetainedHistorySchedulerCheckpointV1) {
  const result = await runEffect(repository.acquireEffect());
  if (result.kind !== "acquired") {
    throw new Error(`Expected acquisition, observed ${result.kind}.`);
  }
  return result;
}

function switchableStatementTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  reject: () => boolean,
  cause: unknown,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: <ResultValue>(
      work: (tx: AppRowTransaction) => Promise<ResultValue>,
    ): Promise<ResultValue> => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
      work(new Proxy(tx, {
        get(inner, property, receiver) {
          if (property === "execute") {
            return (statement: Parameters<AppRowTransaction["execute"]>[0]) =>
              reject() ? Promise.reject(cause) : inner.execute(statement);
          }
          return Reflect.get(inner, property, receiver);
        },
      }))
    ),
  });
}

function committedThenUncertainTarget(
  target: LocatedReadCommittedAttemptTargetV1,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: async <ResultValue>(
      work: (tx: AppRowTransaction) => Promise<ResultValue>,
    ): Promise<ResultValue> => {
      await target[RUN_LOCATED_READ_COMMITTED_V1](work);
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "decisionUncertain",
        settlementCause: new Error("simulated lost settlement response"),
      }));
    },
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
    [RUN_LOCATED_READ_COMMITTED_V1]: async <ResultValue>(
      work: (tx: AppRowTransaction) => Promise<ResultValue>,
    ): Promise<ResultValue> => {
      const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
      if (shouldBlock()) {
        onBlocked();
        await release;
      }
      return result;
    },
  });
}

async function retainedRow(persistence: PGliteFlarexPersistence) {
  const rows = await persistence.query<{
    readonly scheduler_state: string;
    readonly run_fence: number | bigint;
    readonly checkpoint_sequence: number | bigint;
    readonly run_owner: string | null;
    readonly continuation_bytes: Uint8Array | null;
  }>(
    "select scheduler_state, run_fence, checkpoint_sequence, run_owner, " +
      "continuation_bytes from fx_system_retained_history_scheduler",
  );
  return rows.rows[0];
}

async function schedulerRows(persistence: PGliteFlarexPersistence) {
  const rows = await persistence.query<{
    readonly table_name: string;
    readonly run_fence: number | bigint;
    readonly checkpoint_sequence: number | bigint;
  }>(`
    select 'retained' as table_name, run_fence, checkpoint_sequence
    from fx_system_retained_history_scheduler
    union all
    select 'point' as table_name, run_fence, checkpoint_sequence
    from fx_system_point_mutation_redelivery_scheduler
    union all
    select 'task' as table_name, run_fence, checkpoint_sequence
    from fx_system_durable_task_repair_scheduler_v1
  `);
  return rows.rows.map((row) => ({
    ...row,
    run_fence: Number(row.run_fence),
    checkpoint_sequence: Number(row.checkpoint_sequence),
  }));
}

async function continuationEvidence(bytes: Uint8Array) {
  const canonicalBytes = new Uint8Array(bytes);
  const sha256 = new Uint8Array(
    await crypto.subtle.digest("SHA-256", canonicalBytes),
  );
  return Object.freeze({
    codecVersion: 1 as const,
    canonicalBytes,
    sha256,
  });
}
