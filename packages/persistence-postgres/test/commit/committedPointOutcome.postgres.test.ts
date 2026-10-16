import { describe, expect, it } from "vitest";

import {
  CommittedPointOutcomeCorruptionErrorV1,
} from "../../src/commit/committedPointOutcomeErrors";
import {
  createCommittedPointOutcomeResolverV1,
  type CommittedPointOutcomeResolverQueryV1,
} from "../../src/commit/committedPointOutcome";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import {
  insertCanonicalAvailableOutcome,
  insertOutcomeHeader,
  insertOutcomeScope,
  outcomeLookup,
  OUTCOME_EPOCH_A,
  OUTCOME_EPOCH_B,
  OUTCOME_SCOPE_A,
} from "./committedPointOutcomeTestSupport";
import { runEffect } from "../support/effectTestRuntime";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
} from "../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O07-A committed point outcome resolver", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence();

  it("returns one statement snapshot across concurrent atomic publication", async () => {
    await withPersistence(async (persistence) => {
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
      const settled = Promise.allSettled([first]);
      try {
        await Promise.race([
          captured.promise,
          first.then(() => { throw new Error("Resolver settled before its statement barrier."); }),
        ]);
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
      } finally {
        gate.resolve(undefined);
        await settled;
      }
    });
  }, 30_000);

  it("observes either retained or compacted history without a torn floor/header view", async () => {
    await withPersistence(async (persistence) => {
      await insertOutcomeScope(persistence, { lastCommitSeq: 3n });
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
      const settled = Promise.allSettled([retained]);
      try {
        await Promise.race([
          captured.promise,
          retained.then(() => { throw new Error("Resolver settled before its statement barrier."); }),
        ]);
        await persistence.transaction(async (transaction) => {
          await transaction.query(
            `delete from fx_system_commit where scope_uuid = $1::uuid and commit_seq = 1`,
            [OUTCOME_SCOPE_A],
          );
          await transaction.query(
            `update fx_system_scope_execution_authority set oldest_available_commit_seq = 2 where scope_id = (select scope_id from fx_system_scope_clock where scope_uuid = $1::uuid)`,
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

        await insertOutcomeHeader(persistence, {
          epochUuid: OUTCOME_EPOCH_A,
          commitSeq: 3n,
        });
        for (const { requestKey, commitSeq, reason } of [
          { requestKey: "wrong-retained-epoch", commitSeq: 3n, reason: "retainedHeaderEpochMismatch" },
          { requestKey: "future-token", commitSeq: 4n, reason: "commitTokenAheadOfClock" },
        ]) {
          await insertCanonicalAvailableOutcome(persistence, {
            requestKey,
            epochUuid: OUTCOME_EPOCH_B,
            commitSeq,
          });
          const failure = runEffect(postCompaction.resolve(outcomeLookup(requestKey)));
          await expect(failure).rejects.toBeInstanceOf(CommittedPointOutcomeCorruptionErrorV1);
          await expect(failure).rejects.toMatchObject({ reason });
        }
      } finally {
        gate.resolve(undefined);
        await settled;
      }
    });
  }, 30_000);

  it("releases SQL resources before verification and uses bounded index-backed lookup", async () => {
    await withPersistence(async (persistence) => {
      await insertOutcomeScope(persistence, { lastCommitSeq: 1n });
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, {
        requestKey: "plan-target",
        value: { ok: true },
      });
      await seedPlanOutcomes(persistence);
      for (let index = 1; index <= 512; index += 1) {
        const suffix = index.toString(16).padStart(12, "0");
        const scopeUuid = `97000000-0000-4000-8000-${suffix}`;
        const epochUuid = `98000000-0000-4000-8000-${suffix}`;
        await insertOutcomeScope(persistence, { scopeUuid, epochUuid, lastCommitSeq: 1n });
        await insertOutcomeHeader(persistence, { scopeUuid, epochUuid });
      }
      await persistence.query(`analyze fx_system_idempotency`);
      await persistence.query(`analyze fx_system_scope_clock`);
      await persistence.query(`analyze fx_system_scope_execution_authority`);
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
      const settled = Promise.allSettled([resolving]);
      try {
        await Promise.race([
          captured.promise,
          resolving.then(() => { throw new Error("Resolver settled before its statement barrier."); }),
        ]);

        const lockClient = await persistence.pool.connect();
        try {
          await lockClient.query("begin");
          await expect(lockClient.query(`
          lock table fx_system_idempotency, fx_system_scope_clock,
            fx_system_commit in access exclusive mode nowait
        `)).resolves.toBeDefined();
          await lockClient.query("rollback");
        } finally {
          await rollbackAndReleasePostgresClient(lockClient);
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
        expect(plan).toContain(`"Index Cond":"(fx_system_scope_clock.scope_uuid = '${OUTCOME_SCOPE_A}'::uuid)"`);
        expect(plan).toContain("fx_system_commit_scope_uuid_commit_seq_pk");
      } finally {
        gate.resolve(undefined);
        await settled;
      }
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
    const explained = await client.query(
      `explain (format json, verbose) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(explained.rows);
  } finally {
    await rollbackAndReleasePostgresClient(client);
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
