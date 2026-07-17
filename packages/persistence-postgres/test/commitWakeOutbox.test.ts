import { Effect, Option, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CommitWakeCorruptionErrorV1,
  CommitWakeResourceExhaustionErrorV1,
  CommitWakeStaleClaimErrorV1,
  createCommitWakeOutboxRepositoryV1,
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
      lastCommitSeq: 2n,
      oldestAvailableCommitSeq: 2n,
      lastOutboxSeq: 2n,
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
