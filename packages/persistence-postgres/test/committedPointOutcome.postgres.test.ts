import { describe, expect, it } from "vitest";

import {
  CommittedPointOutcomeCorruptionErrorV1,
  createCommittedPointOutcomeResolverV1,
  type CommittedPointOutcomeResolverQueryV1,
} from "../src/committedPointOutcome";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  insertCanonicalAvailableOutcome,
  insertOutcomeHeader,
  insertOutcomeScope,
  outcomeLookup,
  OUTCOME_EPOCH_A,
  OUTCOME_EPOCH_B,
  OUTCOME_SCOPE_A,
} from "./committedPointOutcomeTestSupport";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O07-A committed point outcome resolver", () => {
  it("returns one statement snapshot across concurrent atomic publication", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertOutcomeScope(persistence, { lastCommitSeq: 0n });
      const gate = deferred<void>();
      const captured = deferred<void>();
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
        {
          afterStatement: async () => {
            captured.resolve(undefined);
            await gate.promise;
          },
        },
      );
      const first = runEffect(resolver.resolve(outcomeLookup("race")));
      await captured.promise;
      await persistence.transaction(async (transaction) => {
        await transaction.query(
          `update fx_system_scope_clock set last_commit_seq = 1 where scope_uuid = $1::uuid`,
          [OUTCOME_SCOPE_A],
        );
        await insertOutcomeHeader(transaction);
        await insertCanonicalAvailableOutcome(transaction, {
          requestKey: "race",
        });
      });
      gate.resolve(undefined);
      await expect(first).resolves.toEqual({ kind: "missing" });
      await expect(
        runEffect(
          createCommittedPointOutcomeResolverV1(persistence.drizzle).resolve(
            outcomeLookup("race"),
          ),
        ),
      ).resolves.toMatchObject({ kind: "available" });
    });
  }, 30_000);

  it("observes either retained or compacted history without a torn floor/header view", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertOutcomeScope(persistence, { lastCommitSeq: 2n });
      await insertOutcomeHeader(persistence, {
        epochUuid: OUTCOME_EPOCH_A,
        commitSeq: 1n,
      });
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "compaction",
        epochUuid: OUTCOME_EPOCH_A,
        commitSeq: 1n,
      });
      const gate = deferred<void>();
      const captured = deferred<void>();
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
        {
          afterStatement: async () => {
            captured.resolve(undefined);
            await gate.promise;
          },
        },
      );
      const retained = runEffect(
        resolver.resolve(outcomeLookup("compaction")),
      );
      await captured.promise;
      await persistence.transaction(async (transaction) => {
        await transaction.query(
          `delete from fx_system_commit where scope_uuid = $1::uuid and commit_seq = 1`,
          [OUTCOME_SCOPE_A],
        );
        await transaction.query(
          `update fx_system_scope_clock set oldest_available_commit_seq = 2 where scope_uuid = $1::uuid`,
          [OUTCOME_SCOPE_A],
        );
      });
      gate.resolve(undefined);
      await expect(retained).resolves.toMatchObject({ kind: "available" });
      const postCompaction = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
      );
      await expect(
        runEffect(postCompaction.resolve(outcomeLookup("compaction"))),
      ).resolves.toMatchObject({ kind: "available" });

      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "at-floor",
        epochUuid: OUTCOME_EPOCH_B,
        commitSeq: 2n,
      });
      const atFloor = runEffect(
        postCompaction.resolve(outcomeLookup("at-floor")),
      );
      await expect(atFloor).rejects.toBeInstanceOf(
        CommittedPointOutcomeCorruptionErrorV1,
      );
      await expect(atFloor).rejects.toMatchObject({
        reason: "missingRetainedHeader",
      });
    });
  }, 30_000);

  it("releases SQL resources before verification and uses bounded index-backed lookup", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertOutcomeScope(persistence, { lastCommitSeq: 1n });
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "plan-target",
        value: { ok: true },
      });
      await seedPlanOutcomes(persistence);
      await persistence.query(`analyze fx_system_idempotency`);
      await persistence.query(`analyze fx_system_scope_clock`);
      await persistence.query(`analyze fx_system_commit`);

      let observed: CommittedPointOutcomeResolverQueryV1 | undefined;
      const gate = deferred<void>();
      const captured = deferred<void>();
      const resolver = createCommittedPointOutcomeResolverV1(
        persistence.drizzle,
        {
          observeQuery: (query) => { observed = query; },
          afterStatement: async () => {
            captured.resolve(undefined);
            await gate.promise;
          },
        },
      );
      const resolving = runEffect(
        resolver.resolve(outcomeLookup("plan-target")),
      );
      await captured.promise;

      const lockClient = await persistence.pool.connect();
      try {
        await lockClient.query("begin");
        await expect(lockClient.query(`
          lock table fx_system_idempotency, fx_system_scope_clock,
            fx_system_commit in access exclusive mode nowait
        `)).resolves.toBeDefined();
        await lockClient.query("rollback");
      } finally {
        lockClient.release();
      }
      gate.resolve(undefined);
      await expect(resolving).resolves.toMatchObject({ kind: "available" });

      expect(observed).toBeDefined();
      if (observed === undefined) throw new Error("Missing observed query.");
      expect(observed.sql.toLowerCase()).toContain("octet_length");
      expect(observed.sql.toLowerCase()).toContain("case when");
      const plan = await explainObservedQuery(persistence, observed);
      expect(plan).toContain(
        "fx_system_idempotency_scope_uuid_request_key_pk",
      );
      expect(plan).toContain("fx_system_scope_clock_scope_uuid_unique");
      expect(plan).toContain("fx_system_commit_scope_uuid_commit_seq_pk");
    });
  }, 30_000);
});

async function seedPlanOutcomes(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_idempotency
        (scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_expired_at)
      select $1::uuid, 'plan-' || series,
        decode(repeat('31', 32), 'hex'), 'messages:create',
        decode(repeat('42', 32), 'hex'), $2::uuid, 1,
        'expired', now()
      from generate_series(1, 200) as series
    `,
    [OUTCOME_SCOPE_A, OUTCOME_EPOCH_A],
  );
}

async function explainObservedQuery(
  persistence: PostgresFlarexPersistence,
  query: CommittedPointOutcomeResolverQueryV1,
): Promise<string> {
  const client = await persistence.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local enable_seqscan = off");
    await client.query("set local enable_bitmapscan = off");
    const explained = await client.query(
      `explain (format json, verbose) ${query.sql}`,
      [...query.params],
    );
    await client.query("rollback");
    return JSON.stringify(explained.rows);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function deferred<A>(): {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
} {
  let resolvePromise: ((value: A) => void) | undefined;
  const promise = new Promise<A>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: (value) => {
      if (resolvePromise === undefined) throw new Error("Deferred not ready.");
      resolvePromise(value);
    },
  };
}
