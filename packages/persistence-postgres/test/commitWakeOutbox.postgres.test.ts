import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import type { ScopeEpochUuidV1 } from "flarex-protocol/storage-authority";

import type { FlarexPersistence } from "../src";
import {
  CommitWakeCorruptionErrorV1,
  CommitWakeResourceExhaustionErrorV1,
  CommitWakeStaleClaimErrorV1,
  createCommitWakeOutboxRepositoryV1,
  type ClaimedCommitWakeV1,
} from "../src/commitWakeOutbox";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  commitSeq,
  insertPendingWake,
  insertWakeHeader,
  insertWakeScope,
  WAKE_EPOCH_A,
  WAKE_EPOCH_B,
  WAKE_EPOCH_C,
  WAKE_OWNER_A,
  WAKE_OWNER_B,
  WAKE_SCOPE_A,
  WAKE_SCOPE_B,
} from "./commitWakeOutboxTestSupport";
import { runEffect } from "./effectTestRuntime";
import { verifyCommitWakeMigration } from "./commitWakeMigrationScenario";
import { makeDrizzleCopyFixture } from "./migrationFixtureSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
type SqlPersistence = Pick<FlarexPersistence, "query">;

describePostgres("real Postgres S09-B commit-wake outbox", () => {
  it("preserves delivery states and replays 0092 in a non-public schema", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-commit-wake", "postgres", "0092_commit-wake.sql");
    try {
      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await verifyCommitWakeMigration(persistence, fixture, databaseOptions.migrationsSchema);
          expect((await persistence.query("select current_schema() as name")).rows)
            .not.toEqual([{ name: "public" }]);
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("gives concurrent claimers disjoint rows and one exact-commit winner", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedWakeRange(persistence, 3);
      const repository = createCommitWakeOutboxRepositoryV1(
        persistence.drizzle,
      );
      const [left, right] = await Promise.all([
        runEffect(repository.claimReadyBatch({
          scopeUuid: WAKE_SCOPE_A,
          claimOwner: WAKE_OWNER_A,
          leaseMilliseconds: 60_000,
          limit: 1,
        })),
        runEffect(repository.claimReadyBatch({
          scopeUuid: WAKE_SCOPE_A,
          claimOwner: WAKE_OWNER_B,
          leaseMilliseconds: 60_000,
          limit: 1,
        })),
      ]);
      expect(left).toHaveLength(1);
      expect(right).toHaveLength(1);
      expect(new Set([
        left[0]?.commitSeq,
        right[0]?.commitSeq,
      ])).toEqual(new Set([1n, 2n]));

      const [first, second] = await Promise.all([
        runEffect(repository.claimForCommit({
          scopeUuid: WAKE_SCOPE_A,
          commitSeq: commitSeq(3n),
          claimOwner: WAKE_OWNER_A,
          leaseMilliseconds: 60_000,
        })),
        runEffect(repository.claimForCommit({
          scopeUuid: WAKE_SCOPE_A,
          commitSeq: commitSeq(3n),
          claimOwner: WAKE_OWNER_B,
          leaseMilliseconds: 60_000,
        })),
      ]);
      expect([first, second].filter(Option.isSome)).toHaveLength(1);
      expect([first, second].filter(Option.isNone)).toHaveLength(1);
    });
  });

  it("writes claim and settlement times from the exact database statement clock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedWakeRange(persistence, 1);
      await persistence.query(`
        create function fx_test_assert_commit_wake_database_clock()
        returns trigger
        language plpgsql
        as $$
        begin
          if new.delivery_state = 'claimed' then
            if new.claimed_at is distinct from statement_timestamp()
              or new.claim_expires_at is distinct from
                statement_timestamp() + interval '60 seconds'
            then
              raise exception 'claim timestamps did not use statement time';
            end if;
          elsif new.delivery_state = 'delivered' then
            if new.delivered_at is distinct from statement_timestamp() then
              raise exception 'delivery timestamp did not use statement time';
            end if;
          end if;
          return new;
        end;
        $$;

        create trigger fx_test_commit_wake_database_clock
        before update on fx_system_commit_wake
        for each row
        execute function fx_test_assert_commit_wake_database_clock()
      `);

      const repository = createCommitWakeOutboxRepositoryV1(
        persistence.drizzle,
      );
      const claimed = await runEffect(repository.claimForCommit({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: commitSeq(1n),
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
      }));
      if (Option.isNone(claimed)) throw new Error("Expected a wake claim.");

      await expect(runEffect(repository.settleClaim({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: claimed.value.commitSeq,
        claimOwner: WAKE_OWNER_A,
        claimFence: claimed.value.claimFence,
        settlement: { kind: "delivered" },
      }))).resolves.toMatchObject({ state: "delivered" });
    });
  });

  it("redelivers after send-before-ack and rejects the stale pre-crash fence", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedWakeRange(persistence, 1);
      const repository = createCommitWakeOutboxRepositoryV1(
        persistence.drizzle,
      );
      const sink = new DeterministicCommitWakeSink(WAKE_EPOCH_A, 0n);
      const firstOption = await runEffect(repository.claimForCommit({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: commitSeq(1n),
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
      }));
      if (Option.isNone(firstOption)) throw new Error("Expected a wake claim.");
      expect(sink.accept(firstOption.value, WAKE_EPOCH_A)).toBe("applied");

      // The process crashes after the sink durably accepts but before ack.
      await persistence.query(`
        update fx_system_commit_wake
        set claim_expires_at = claimed_at + interval '1 millisecond'
        where scope_uuid = '${WAKE_SCOPE_A}'::uuid and commit_seq = 1
      `);
      const replayed = await runEffect(repository.claimReadyBatch({
        scopeUuid: WAKE_SCOPE_A,
        claimOwner: WAKE_OWNER_B,
        leaseMilliseconds: 60_000,
        limit: 1,
      }));
      const replayedWake = replayed[0];
      if (replayedWake === undefined) throw new Error("Expected wake replay.");
      expect(sink.accept(replayedWake, WAKE_EPOCH_A)).toBe("duplicate");
      expect(replayedWake).toMatchObject({
        claimFence: 2n,
        previousFailure: { code: "claim_lease_expired" },
      });

      const stale = await runEffect(Effect.result(
        repository.settleClaim({
          scopeUuid: WAKE_SCOPE_A,
          commitSeq: commitSeq(1n),
          claimOwner: WAKE_OWNER_A,
          claimFence: firstOption.value.claimFence,
          settlement: { kind: "delivered" },
        }),
      ));
      expect(Result.isFailure(stale)).toBe(true);
      if (Result.isFailure(stale)) {
        expect(stale.failure).toBeInstanceOf(CommitWakeStaleClaimErrorV1);
      }
      await expect(runEffect(repository.settleClaim({
        scopeUuid: WAKE_SCOPE_A,
        commitSeq: commitSeq(1n),
        claimOwner: WAKE_OWNER_B,
        claimFence: replayedWake.claimFence,
        settlement: { kind: "delivered" },
      }))).resolves.toMatchObject({ state: "delivered" });
    });
  });

  it("keeps compaction correlation atomic and old-epoch wakes claimable", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertWakeScope(persistence, {
        scopeUuid: WAKE_SCOPE_A,
        epochUuid: WAKE_EPOCH_B,
        lastCommitSeq: 2n,
        oldestAvailableCommitSeq: 0n,
      });
      for (const sequence of [1n, 2n]) {
        await insertWakeHeader(
          persistence,
          WAKE_SCOPE_A,
          WAKE_EPOCH_A,
          sequence,
        );
        await insertPendingWake(persistence, {
          scopeUuid: WAKE_SCOPE_A,
          epochUuid: WAKE_EPOCH_A,
          commitSeq: sequence,
        });
      }
      const repository = createCommitWakeOutboxRepositoryV1(
        persistence.drizzle,
      );
      const compactor = await persistence.pool.connect();
      try {
        await compactor.query("begin");
        await compactor.query(
          `update fx_system_scope_clock
           set oldest_available_commit_seq = 2
           where scope_uuid = $1::uuid`,
          [WAKE_SCOPE_A],
        );
        await compactor.query(
          `delete from fx_system_commit
           where scope_uuid = $1::uuid and commit_seq = 1`,
          [WAKE_SCOPE_A],
        );

        const raced = await runEffect(repository.claimForCommit({
          scopeUuid: WAKE_SCOPE_A,
          commitSeq: commitSeq(1n),
          claimOwner: WAKE_OWNER_A,
          leaseMilliseconds: 60_000,
        }));
        expect(Option.isSome(raced)).toBe(true);
        if (Option.isSome(raced)) {
          expect(raced.value.epochUuid).toBe(WAKE_EPOCH_A);
        }
        await compactor.query("commit");

        await persistence.query(`
          update fx_system_commit_wake
          set claim_expires_at = claimed_at + interval '1 millisecond'
          where scope_uuid = '${WAKE_SCOPE_A}'::uuid and commit_seq = 1
        `);
        const postCompaction = await runEffect(
          repository.claimReadyBatch({
            scopeUuid: WAKE_SCOPE_A,
            claimOwner: WAKE_OWNER_B,
            leaseMilliseconds: 60_000,
            limit: 1,
          }),
        );
        expect(postCompaction).toHaveLength(1);
        expect(postCompaction[0]?.epochUuid).toBe(WAKE_EPOCH_A);

        await persistence.query(`
          delete from fx_system_commit
          where scope_uuid = '${WAKE_SCOPE_A}'::uuid and commit_seq = 2
        `);
        const equality = await runEffect(Effect.result(
          repository.claimForCommit({
            scopeUuid: WAKE_SCOPE_A,
            commitSeq: commitSeq(2n),
            claimOwner: WAKE_OWNER_A,
            leaseMilliseconds: 60_000,
          }),
        ));
        expect(Result.isFailure(equality)).toBe(true);
        if (Result.isFailure(equality)) {
          expect(equality.failure).toBeInstanceOf(
            CommitWakeCorruptionErrorV1,
          );
          expect(equality.failure).toMatchObject({
            reason: "missingRetainedHeader",
          });
        }

        const currentSink = new DeterministicCommitWakeSink(WAKE_EPOCH_B, 2n);
        const oldWake = postCompaction[0];
        if (oldWake === undefined) throw new Error("Expected old-epoch wake.");
        expect(currentSink.accept(oldWake, WAKE_EPOCH_B)).toBe(
          "oldEpochDuplicate",
        );
        const oldSink = new DeterministicCommitWakeSink(WAKE_EPOCH_A, 1n);
        expect(oldSink.observeEpoch(WAKE_EPOCH_B)).toBe("resnapshot");
      } finally {
        await compactor.query("rollback").catch(() => undefined);
        compactor.release();
      }
    });
  });

  it("rolls back the whole selected batch when a later claim fence is exhausted", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedWakeRange(persistence, 2);
      await persistence.query(`
        update fx_system_commit_wake
        set claim_fence = 9223372036854775807,
            last_failure_code = 'transient_delivery', last_failed_at = now(),
            next_attempt_at = now()
        where scope_uuid = '${WAKE_SCOPE_A}'::uuid and commit_seq = 2
      `);
      const repository = createCommitWakeOutboxRepositoryV1(persistence.drizzle);
      const result = await runEffect(Effect.result(repository.claimReadyBatch({
        scopeUuid: WAKE_SCOPE_A,
        claimOwner: WAKE_OWNER_A,
        leaseMilliseconds: 60_000,
        limit: 2,
      })));
      if (Result.isSuccess(result)) throw new Error("Expected claim-fence exhaustion.");
      expect(result.failure).toBeInstanceOf(CommitWakeResourceExhaustionErrorV1);
      expect((await persistence.query(`
        select commit_seq::text, claim_fence::text, delivery_state, claim_owner
        from fx_system_commit_wake order by commit_seq
      `)).rows).toEqual([
        { commit_seq: "1", claim_fence: "0", delivery_state: "pending", claim_owner: null },
        { commit_seq: "2", claim_fence: "9223372036854775807", delivery_state: "pending", claim_owner: null },
      ]);
    });
  });

  it("uses only the due-time index and commit primary key for bounded claims", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await seedWakeRange(persistence, 25);
      await persistence.query("analyze fx_system_commit_wake");
      await persistence.query("set enable_seqscan = off");
      const claimPlan = await persistence.query<{
        plan: unknown;
      }>(`
        explain (format json, costs off)
        select commit_seq
        from fx_system_commit_wake
        where scope_uuid = '${WAKE_SCOPE_A}'::uuid
          and delivery_state in ('pending', 'claimed')
          and case
            when delivery_state = 'pending' then next_attempt_at
            when delivery_state = 'claimed' then claim_expires_at
            else null
          end <= clock_timestamp()
        order by case
          when delivery_state = 'pending' then next_attempt_at
          when delivery_state = 'claimed' then claim_expires_at
          else null
        end, commit_seq
        limit 10
        for update skip locked
      `);
      const claimPlanText = JSON.stringify(claimPlan.rows);
      expect(claimPlanText).toContain(
        "fx_system_commit_wake_claimable_idx",
      );
      expect(claimPlanText).toContain("Index Cond");
      expect(claimPlanText).toContain("next_attempt_at");
      expect(claimPlanText).toContain("claim_expires_at");
      const tokenPlan = await persistence.query<{ plan: unknown }>(`
        explain (format json, costs off)
        select commit_seq
        from fx_system_commit_wake
        where scope_uuid = '${WAKE_SCOPE_A}'::uuid
          and commit_seq = 17
      `);
      expect(JSON.stringify(tokenPlan.rows)).toContain(
        "fx_system_commit_wake_scope_uuid_commit_seq_pk",
      );
      expect((await persistence.query(`
        select indexname from pg_indexes
        where schemaname = current_schema() and tablename = 'fx_system_commit_wake'
        order by indexname
      `)).rows).toEqual([
        { indexname: "fx_system_commit_wake_claimable_idx" },
        { indexname: "fx_system_commit_wake_scope_uuid_commit_seq_pk" },
      ]);
    });
  });
});

async function seedWakeRange(
  persistence: PostgresFlarexPersistence,
  count: number,
): Promise<void> {
  await insertWakeScope(persistence, {
    scopeUuid: WAKE_SCOPE_A,
    epochUuid: WAKE_EPOCH_A,
    lastCommitSeq: BigInt(count),
  });
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const value = BigInt(sequence);
    await insertWakeHeader(
      persistence,
      WAKE_SCOPE_A,
      WAKE_EPOCH_A,
      value,
    );
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: value,
    });
  }
}

type SinkDecision =
  | "applied"
  | "duplicate"
  | "gap"
  | "oldEpochDuplicate"
  | "resnapshot";

class DeterministicCommitWakeSink {
  #epochUuid: ScopeEpochUuidV1;
  #appliedThrough: bigint;

  constructor(epochUuid: ScopeEpochUuidV1, appliedThrough: bigint) {
    this.#epochUuid = epochUuid;
    this.#appliedThrough = appliedThrough;
  }

  accept(
    wake: ClaimedCommitWakeV1,
    authoritativeEpochUuid: ScopeEpochUuidV1,
  ): SinkDecision {
    if (wake.epochUuid !== this.#epochUuid) {
      return this.#epochUuid === authoritativeEpochUuid
        ? "oldEpochDuplicate"
        : "resnapshot";
    }
    if (wake.commitSeq <= this.#appliedThrough) return "duplicate";
    if (wake.commitSeq !== this.#appliedThrough + 1n) return "gap";
    this.#appliedThrough = wake.commitSeq;
    return "applied";
  }

  observeEpoch(authoritativeEpochUuid: ScopeEpochUuidV1): SinkDecision {
    return authoritativeEpochUuid === this.#epochUuid
      ? "duplicate"
      : "resnapshot";
  }
}
