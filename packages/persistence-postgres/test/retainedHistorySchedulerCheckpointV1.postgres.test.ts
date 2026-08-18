import { sql } from "drizzle-orm";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { AppRowTransaction } from "../src/appRows";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  RetainedHistorySchedulerConfirmedRollbackV1Error,
  RetainedHistorySchedulerDecisionUncertainV1Error,
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
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const OWNER_ONE = "95000000-0000-4000-8000-000000000001";
const OWNER_TWO = "95000000-0000-4000-8000-000000000002";

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "retained-history-scheduler-postgres",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describePostgres("real PostgreSQL O11-F1 retained-history checkpoint", () => {
  it("serializes acquisition and cold-reloads exactly one durable continuation", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const left = repository(persistence, OWNER_ONE);
      const right = repository(persistence, OWNER_TWO);
      const [one, two] = await Promise.all([
        runEffect(left.acquireEffect()),
        runEffect(right.acquireEffect()),
      ]);
      expect([one.kind, two.kind].sort()).toEqual(["acquired", "busy"]);
      const winner = one.kind === "acquired"
        ? one
        : two.kind === "acquired"
        ? two
        : undefined;
      if (winner === undefined) throw new Error("Expected one scheduler winner.");
      const winnerRepository = one.kind === "acquired" ? left : right;
      const bytes = new TextEncoder().encode('{"version":1}');
      await runEffect(winnerRepository.checkpointEffect(
        winner.run,
        await continuationEvidence(bytes),
      ));
      await runEffect(winnerRepository.releaseEffect(winner.run));

      const restarted = repository(
        persistence,
        one.kind === "acquired" ? OWNER_TWO : OWNER_ONE,
      );
      const acquired = await acquire(restarted);
      expect(new TextDecoder().decode(
        acquired.continuation!.canonicalBytes,
      )).toBe('{"version":1}');
      expect(await row(persistence)).toMatchObject({
        scheduler_state: "claimed",
        run_fence: "2",
        checkpoint_sequence: "0",
      });
    });
  }, 60_000);

  it("rolls back a failed checkpoint and permits its exact retry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      let reject = false;
      const statementCause = new Error("injected Postgres statement failure");
      const withFailure = createRetainedHistorySchedulerCheckpointV1(
        switchableStatementTarget(
          locatedTarget(persistence),
          () => reject,
          statementCause,
        ),
        { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
      );
      const acquired = await acquire(withFailure);
      const evidence = await continuationEvidence(new Uint8Array([1]));
      reject = true;
      expect(await runEffectFailure(
        withFailure.checkpointEffect(acquired.run, evidence),
      )).toBeInstanceOf(RetainedHistorySchedulerConfirmedRollbackV1Error);
      expect(await row(persistence)).toMatchObject({
        checkpoint_sequence: "0",
        continuation_bytes: null,
      });
      reject = false;
      await expect(runEffect(
        withFailure.checkpointEffect(acquired.run, evidence),
      )).resolves.toMatchObject({ checkpointSequence: 1n });
    });
  }, 60_000);

  it("cold-recovers only after an uncertain committed claim expires", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const uncertain = createRetainedHistorySchedulerCheckpointV1(
        committedThenUncertainTarget(locatedTarget(persistence)),
        { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
      );
      expect(await runEffectFailure(uncertain.acquireEffect())).toBeInstanceOf(
        RetainedHistorySchedulerDecisionUncertainV1Error,
      );
      expect(await row(persistence)).toMatchObject({
        scheduler_state: "claimed",
        run_fence: "1",
        run_owner: OWNER_ONE,
      });
      const fresh = repository(persistence, OWNER_TWO);
      await expect(runEffect(fresh.acquireEffect())).resolves.toMatchObject({
        kind: "busy",
      });
      await persistence.drizzle.execute(sql`
        update fx_system_retained_history_scheduler
        set
          claimed_at = clock_timestamp() - interval '2 seconds',
          claim_expires_at = clock_timestamp() - interval '1 second'
        where scheduler_key = ${RETAINED_HISTORY_SCHEDULER_KEY_V1}
      `);
      await acquire(fresh);
      expect(await row(persistence)).toMatchObject({
        run_fence: "2",
        run_owner: OWNER_TWO,
      });
    });
  }, 60_000);
});

function repository(
  persistence: PostgresFlarexPersistence,
  owner: string,
): RetainedHistorySchedulerCheckpointV1 {
  return createRetainedHistorySchedulerCheckpointV1(
    locatedTarget(persistence),
    { claimDurationMilliseconds: 60_000, randomUuid: () => owner },
  );
}

function locatedTarget(
  persistence: PostgresFlarexPersistence,
): LocatedReadCommittedAttemptTargetV1 {
  const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED Postgres target.");
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

async function row(persistence: PostgresFlarexPersistence) {
  const result = await persistence.query<{
    readonly scheduler_state: string;
    readonly run_fence: string;
    readonly checkpoint_sequence: string;
    readonly run_owner: string | null;
    readonly continuation_bytes: Uint8Array | null;
  }>(`
    select scheduler_state, run_fence::text, checkpoint_sequence::text,
      run_owner::text, continuation_bytes
    from fx_system_retained_history_scheduler
  `);
  return result.rows[0];
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
