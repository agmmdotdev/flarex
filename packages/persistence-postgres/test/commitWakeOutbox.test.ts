import { Effect, Option, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CommitWakeClaimFenceV1Schema,
  CommitWakeCorruptionErrorV1,
  CommitWakeInputErrorV1,
  CommitWakeResourceExhaustionErrorV1,
  CommitWakeStaleClaimErrorV1,
  createCommitWakeOutboxRepositoryV1,
  type ClaimCommitWakeForCommitInputV1,
  type ClaimReadyCommitWakesInputV1,
  type SettleCommitWakeClaimInputV1,
} from "../src/commitWakeOutbox";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  commitSeq,
  insertPendingWake,
  insertWakeHeader,
  insertWakeScope,
  outboxSeq,
  WAKE_EPOCH_A,
  WAKE_EPOCH_B,
  WAKE_OWNER_A,
  WAKE_OWNER_B,
  WAKE_SCOPE_A,
} from "./commitWakeOutboxTestSupport";
import { runEffect } from "./effectTestRuntime";

describe("S09-B private commit-wake outbox", () => {
  it("keeps the replacement outbox outside the broad relational query surface", () => {
    type QueryLeak = Extract<
      keyof PGliteFlarexPersistence["drizzle"]["query"],
      "fxSystemOutbox"
    >;
    expectTypeOf<QueryLeak>().toEqualTypeOf<never>();
  });

  it("preserves fail-fast input validation order before transaction work", async () => {
    const persistence = await migratedPGlite();
    let transactionCalls = 0;
    const observedDatabase = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver);
        }
        const transaction = Reflect.get(target, property, target);
        return (...args: unknown[]) => {
          transactionCalls += 1;
          return Reflect.apply(transaction, target, args);
        };
      },
    });
    const repository = createCommitWakeOutboxRepositoryV1(
      observedDatabase,
    );
    const claimForCommit = {
      scopeUuid: WAKE_SCOPE_A,
      commitSeq: commitSeq(1n),
      claimOwner: WAKE_OWNER_A,
      leaseMilliseconds: 60_000,
    } satisfies ClaimCommitWakeForCommitInputV1;
    const claimReadyBatch = {
      scopeUuid: WAKE_SCOPE_A,
      claimOwner: WAKE_OWNER_A,
      leaseMilliseconds: 60_000,
      limit: 1,
    } satisfies ClaimReadyCommitWakesInputV1;
    const settleClaim = {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: outboxSeq(1n),
      claimOwner: WAKE_OWNER_A,
      claimFence: CommitWakeClaimFenceV1Schema.make(1n),
      settlement: { kind: "delivered" },
    } satisfies SettleCommitWakeClaimInputV1;

    await expectInputFailure(
      repository.claimForCommit(changed(claimForCommit, [
        ["scopeUuid", "invalid"],
        ["claimOwner", "invalid"],
        ["commitSeq", 0n],
      ])),
      "scopeUuidInvalid",
    );
    const unreadOwner = changed(claimReadyBatch, [["scopeUuid", "invalid"]]);
    Object.defineProperty(unreadOwner, "claimOwner", {
      enumerable: true,
      get() {
        throw new Error("claimOwner must not be read after scope failure");
      },
    });
    await expectInputFailure(
      repository.claimReadyBatch(unreadOwner),
      "scopeUuidInvalid",
    );
    await expectInputFailure(
      repository.claimForCommit(changed(claimForCommit, [["commitSeq", 0n]])),
      "commitSeqInvalid",
    );
    await expectInputFailure(
      repository.claimReadyBatch(changed(claimReadyBatch, [
        ["claimOwner", "invalid"],
        ["leaseMilliseconds", 0],
        ["limit", 0],
      ])),
      "claimOwnerInvalid",
    );
    await expectInputFailure(
      repository.claimReadyBatch(changed(claimReadyBatch, [
        ["leaseMilliseconds", 0],
        ["limit", 0],
      ])),
      "leaseMillisecondsInvalid",
    );
    await expectInputFailure(
      repository.claimReadyBatch(changed(claimReadyBatch, [["limit", -0]])),
      "claimBatchLimitInvalid",
    );
    await expectInputFailure(
      repository.settleClaim(changed(settleClaim, [
        ["scopeUuid", "invalid"],
        ["outboxSeq", 0n],
      ])),
      "scopeUuidInvalid",
    );
    await expectInputFailure(
      repository.settleClaim(changed(settleClaim, [
        ["outboxSeq", 0n],
        ["claimOwner", "invalid"],
      ])),
      "outboxSeqInvalid",
    );
    await expectInputFailure(
      repository.settleClaim(changed(settleClaim, [
        ["claimOwner", "invalid"],
        ["claimFence", 0n],
      ])),
      "claimOwnerInvalid",
    );
    await expectInputFailure(
      repository.settleClaim(changed(settleClaim, [
        ["claimFence", 0n],
        ["settlement", {
          kind: "retry",
          retryDelayMilliseconds: 0,
          failureCode: "transient_delivery",
        }],
      ])),
      "claimFenceInvalid",
    );
    await expectInputFailure(
      repository.settleClaim(changed(settleClaim, [["settlement", {
        kind: "retry",
        retryDelayMilliseconds: 0,
        failureCode: "transient_delivery",
      }]])),
      "retryDelayMillisecondsInvalid",
    );
    await expectInputFailure(
      repository.settleClaim(changed(settleClaim, [["settlement", {
        kind: "deadLettered",
        failureCode: "terminal_delivery",
        failureSummary: " ",
      }]])),
      "failureSummaryInvalid",
    );
    expect(transactionCalls).toBe(0);
  });

  it("claims an old-epoch wake, retries it, and delivers it with exact fencing", async () => {
    const persistence = await migratedPGlite();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_B,
      lastCommitSeq: 1n,
      lastOutboxSeq: 1n,
    });
    await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 1n,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 1n,
    });

    const repository = createCommitWakeOutboxRepositoryV1(
      persistence.drizzle,
    );
    const first = await runEffect(repository.claimForCommit({
      scopeUuid: WAKE_SCOPE_A,
      commitSeq: commitSeq(1n),
      claimOwner: WAKE_OWNER_A,
      leaseMilliseconds: 60_000,
    }));
    expect(Option.isSome(first)).toBe(true);
    if (Option.isNone(first)) throw new Error("Expected the first wake claim.");
    expect(first.value).toMatchObject({
      epochUuid: WAKE_EPOCH_A,
      claimFence: 1n,
      attemptCount: 1n,
      previousFailure: null,
    });

    const retry = await runEffect(repository.settleClaim({
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: outboxSeq(1n),
      claimOwner: WAKE_OWNER_A,
      claimFence: first.value.claimFence,
      settlement: {
        kind: "retry",
        retryDelayMilliseconds: 1,
        failureCode: "transient_delivery",
        failureSummary: "temporary sink refusal",
      },
    }));
    expect(retry.state).toBe("pending");

    await persistence.query(`
      update fx_system_outbox
      set next_attempt_at = clock_timestamp()
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid and outbox_seq = 1
    `);
    const secondBatch = await runEffect(repository.claimReadyBatch({
      scopeUuid: WAKE_SCOPE_A,
      claimOwner: WAKE_OWNER_B,
      leaseMilliseconds: 60_000,
      limit: 10,
    }));
    expect(secondBatch).toHaveLength(1);
    const secondClaim = secondBatch[0];
    if (secondClaim === undefined) throw new Error("Expected a retry claim.");
    expect(secondClaim).toMatchObject({
      claimFence: 2n,
      attemptCount: 2n,
      claimOwner: WAKE_OWNER_B,
      previousFailure: {
        code: "transient_delivery",
        summary: "temporary sink refusal",
      },
    });

    const delivered = await runEffect(repository.settleClaim({
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: outboxSeq(1n),
      claimOwner: WAKE_OWNER_B,
      claimFence: secondClaim.claimFence,
      settlement: { kind: "delivered" },
    }));
    expect(delivered.state).toBe("delivered");

    const terminalReplay = await runEffect(repository.claimForCommit({
      scopeUuid: WAKE_SCOPE_A,
      commitSeq: commitSeq(1n),
      claimOwner: WAKE_OWNER_A,
      leaseMilliseconds: 60_000,
    }));
    expect(Option.isNone(terminalReplay)).toBe(true);

    const stored = await persistence.query<{
      state: string;
      attempt_count: string;
      claim_fence: string;
      failure_code: string | null;
      failure_summary: string | null;
    }>(`
      select
        delivery_state as state,
        attempt_count::text,
        claim_fence::text,
        last_failure_code as failure_code,
        last_failure_summary as failure_summary
      from fx_system_outbox
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid and outbox_seq = 1
    `);
    expect(stored.rows).toEqual([{
      state: "delivered",
      attempt_count: "2",
      claim_fence: "2",
      failure_code: "transient_delivery",
      failure_summary: "temporary sink refusal",
    }]);
  });

  it("reclaims an expired lease and rejects the stale same-row fence", async () => {
    const persistence = await migratedPGlite();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 1n,
      lastOutboxSeq: 1n,
    });
    await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 1n,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 1n,
    });
    const repository = createCommitWakeOutboxRepositoryV1(
      persistence.drizzle,
    );
    const first = await runEffect(repository.claimReadyBatch({
      scopeUuid: WAKE_SCOPE_A,
      claimOwner: WAKE_OWNER_A,
      leaseMilliseconds: 60_000,
      limit: 1,
    }));
    expect(first).toHaveLength(1);

    await persistence.query(`
      update fx_system_outbox
      set claim_expires_at = claimed_at + interval '1 millisecond'
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid and outbox_seq = 1
    `);
    const reclaimed = await runEffect(repository.claimReadyBatch({
      scopeUuid: WAKE_SCOPE_A,
      claimOwner: WAKE_OWNER_B,
      leaseMilliseconds: 60_000,
      limit: 1,
    }));
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({
      claimFence: 2n,
      previousFailure: { code: "claim_lease_expired", summary: null },
    });

    const firstClaim = first[0];
    if (firstClaim === undefined) throw new Error("Expected the first claim.");
    const staleResult = await runEffect(Effect.result(
      repository.settleClaim({
        scopeUuid: WAKE_SCOPE_A,
        outboxSeq: outboxSeq(1n),
        claimOwner: WAKE_OWNER_A,
        claimFence: firstClaim.claimFence,
        settlement: { kind: "delivered" },
      }),
    ));
    expect(Result.isFailure(staleResult)).toBe(true);
    if (Result.isFailure(staleResult)) {
      expect(staleResult.failure).toBeInstanceOf(
        CommitWakeStaleClaimErrorV1,
      );
      expect(staleResult.failure).toMatchObject({
        reason: "claimOwnerMismatch",
      });
    }
  });

  it("uses the inclusive retained floor and permits only strictly pre-floor missing headers", async () => {
    const persistence = await migratedPGlite();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 3n,
      oldestAvailableCommitSeq: 2n,
      lastOutboxSeq: 3n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 1n,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 1n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 2n,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 2n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 3n,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 3n,
    });
    const repository = createCommitWakeOutboxRepositoryV1(
      persistence.drizzle,
    );

    const compacted = await runEffect(repository.claimForCommit({
      scopeUuid: WAKE_SCOPE_A,
      commitSeq: commitSeq(1n),
      claimOwner: WAKE_OWNER_A,
      leaseMilliseconds: 60_000,
    }));
    expect(Option.isSome(compacted)).toBe(true);

    const floorResult = await runEffect(Effect.result(
      repository.claimForCommit({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: commitSeq(2n),
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
      }),
    ));
    expect(Result.isFailure(floorResult)).toBe(true);
    if (Result.isFailure(floorResult)) {
      expect(floorResult.failure).toBeInstanceOf(
        CommitWakeCorruptionErrorV1,
      );
      expect(floorResult.failure).toMatchObject({
        reason: "missingRetainedHeader",
      });
    }
    const aboveFloorResult = await runEffect(Effect.result(
      repository.claimForCommit({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: commitSeq(3n),
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
      }),
    ));
    expect(Result.isFailure(aboveFloorResult)).toBe(true);
    if (Result.isFailure(aboveFloorResult)) {
      expect(aboveFloorResult.failure).toBeInstanceOf(
        CommitWakeCorruptionErrorV1,
      );
      expect(aboveFloorResult.failure).toMatchObject({
        reason: "missingRetainedHeader",
      });
    }
  });

  it("fails closed on clock/token corruption and claim-fence exhaustion", async () => {
    const persistence = await migratedPGlite();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 1n,
      lastOutboxSeq: 1n,
    });
    await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
    await persistence.query(`
      insert into fx_system_outbox
        (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
         delivery_state, next_attempt_at, attempt_count, claim_fence,
         last_failure_code, last_failed_at)
      values
        ('${WAKE_SCOPE_A}', 1, '${WAKE_EPOCH_A}', 1,
         'deployment_sync_commit_wake_v1', 'pending', now(),
         9223372036854775807, 9223372036854775807,
         'transient_delivery', now())
    `);
    const repository = createCommitWakeOutboxRepositoryV1(
      persistence.drizzle,
    );
    const exhausted = await runEffect(Effect.result(
      repository.claimReadyBatch({
        scopeUuid: WAKE_SCOPE_A,
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
        limit: 1,
      }),
    ));
    expect(Result.isFailure(exhausted)).toBe(true);
    if (Result.isFailure(exhausted)) {
      expect(exhausted.failure).toBeInstanceOf(
        CommitWakeResourceExhaustionErrorV1,
      );
    }

    await persistence.query(`
      update fx_system_scope_clock
      set last_outbox_seq = 0
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid
    `);
    const corrupt = await runEffect(Effect.result(
      repository.claimForCommit({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: commitSeq(1n),
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
      }),
    ));
    expect(Result.isFailure(corrupt)).toBe(true);
    if (Result.isFailure(corrupt)) {
      expect(corrupt.failure).toBeInstanceOf(CommitWakeCorruptionErrorV1);
      expect(corrupt.failure).toMatchObject({
        reason: "outboxSeqAheadOfClock",
      });
    }

    const stored = await persistence.query<{
      attempt_count: string;
      claim_fence: string;
      delivery_state: string;
    }>(`
      select attempt_count::text, claim_fence::text, delivery_state
      from fx_system_outbox
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid and outbox_seq = 1
    `);
    expect(stored.rows).toEqual([{
      attempt_count: "9223372036854775807",
      claim_fence: "9223372036854775807",
      delivery_state: "pending",
    }]);
  });
});

async function migratedPGlite(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

function changed<Value extends object>(
  value: Value,
  fields: ReadonlyArray<readonly [PropertyKey, unknown]>,
): Value {
  const changedValue = structuredClone(value);
  for (const [field, replacement] of fields) {
    Reflect.set(changedValue, field, replacement);
  }
  return changedValue;
}

async function expectInputFailure<Success, Failure>(
  effect: Effect.Effect<Success, Failure>,
  reason: CommitWakeInputErrorV1["reason"],
): Promise<void> {
  const result = await runEffect(Effect.result(effect));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isSuccess(result)) {
    throw new Error("Expected commit-wake input validation to fail.");
  }
  expect(result.failure).toBeInstanceOf(CommitWakeInputErrorV1);
  expect(result.failure).toMatchObject({ reason });
}
