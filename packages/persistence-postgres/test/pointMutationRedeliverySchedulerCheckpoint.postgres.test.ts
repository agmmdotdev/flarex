import { asNonArrayRecord } from "@flarex/utils/records";
import { sql } from "drizzle-orm";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { AppRowTransaction } from "../src/appRows";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerDecisionUncertainV1Error,
  PointMutationRedeliverySchedulerStaleV1Error,
  createPointMutationRedeliverySchedulerCheckpointV1,
  type PointMutationRedeliverySchedulerCheckpointV1,
} from "../src/pointMutationRedeliverySchedulerCheckpoint";
import { POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1 } from
  "../src/pointMutationRedeliverySchedulerModel";
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
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const OWNER_ONE = "77000000-0000-4000-8000-000000000001";
const OWNER_TWO = "77000000-0000-4000-8000-000000000002";

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "point-mutation-redelivery-scheduler-postgres",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describePostgres("real Postgres O08-B2b2b2b1b2b2b0 scheduler checkpoint", () => {
  it("serializes concurrent acquisition and preserves one durable restart truth", async () => {
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
      await runEffect(
        winnerRepository.checkpointEffect(
          winner.run,
          await continuationEvidence(
            new TextEncoder().encode('{"codecVersion":1}'),
          ),
        ),
      );
      await runEffect(winnerRepository.releaseEffect(winner.run));

      const restarted = repository(
        persistence,
        one.kind === "acquired" ? OWNER_TWO : OWNER_ONE,
      );
      const acquired = await acquire(restarted);
      expect(new TextDecoder().decode(
        acquired.continuation!.canonicalBytes,
      )).toBe('{"codecVersion":1}');
      const state = await row(persistence);
      expect(state).toMatchObject({
        scheduler_state: "claimed",
        run_fence: "2",
        checkpoint_sequence: "0",
      });
    });
  }, 60_000);

  it("rolls back a rejected statement and permits only one exact retry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      let reject = false;
      const statementCause = new Error("injected Postgres statement failure");
      const repositoryWithFailure =
        createPointMutationRedeliverySchedulerCheckpointV1(
          switchableStatementTarget(
            locatedTarget(persistence),
            () => reject,
            statementCause,
          ),
          { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
        );
      const acquired = await acquire(repositoryWithFailure);
      reject = true;
      expect(await runEffectFailure(
        repositoryWithFailure.checkpointEffect(
          acquired.run,
          await continuationEvidence(new Uint8Array([1])),
        ),
      )).toBeInstanceOf(
        PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
      );
      expect(await row(persistence)).toMatchObject({
        checkpoint_sequence: "0",
        continuation_bytes: null,
      });
      reject = false;
      await expect(runEffect(
        repositoryWithFailure.checkpointEffect(
          acquired.run,
          await continuationEvidence(new Uint8Array([1])),
        ),
      )).resolves.toMatchObject({ checkpointSequence: 1n });
      expect(await row(persistence)).toMatchObject({
        checkpoint_sequence: "1",
      });
    });
  }, 60_000);

  it("mints no handle after an uncertain committed acquisition and recovers only after durable expiry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const uncertain = createPointMutationRedeliverySchedulerCheckpointV1(
        committedThenUncertainTarget(locatedTarget(persistence)),
        { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
      );
      expect(await runEffectFailure(uncertain.acquireEffect())).toBeInstanceOf(
        PointMutationRedeliverySchedulerDecisionUncertainV1Error,
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
        update fx_system_point_mutation_redelivery_scheduler
        set
          claimed_at = clock_timestamp() - interval '2 seconds',
          claim_expires_at = clock_timestamp() - interval '1 second'
        where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
      `);
      const recovered = await acquire(fresh);
      expect(recovered.run).toBeDefined();
      expect(await row(persistence)).toMatchObject({
        run_fence: "2",
        run_owner: OWNER_TWO,
      });
    });
  }, 60_000);

  it("rejects stale checkpoints and uses the singleton primary-key plan", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scheduler = repository(persistence, OWNER_ONE);
      const acquired = await acquire(scheduler);
      await persistence.drizzle.execute(sql`
        update fx_system_point_mutation_redelivery_scheduler
        set checkpoint_sequence = 1
        where scheduler_key = ${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}
      `);
      expect(await runEffectFailure(
        scheduler.checkpointEffect(acquired.run, null),
      )).toBeInstanceOf(PointMutationRedeliverySchedulerStaleV1Error);

      await withPostgresSequentialScansDisabled(persistence, async (client) => {
        const explained = await client.query<{ readonly "QUERY PLAN": unknown }>(
          `
            explain (analyze, buffers, format json)
            select scheduler_key
            from fx_system_point_mutation_redelivery_scheduler
            where scheduler_key = $1
            for update
          `,
          [POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1],
        );
        const nodes = collectPlanNodes(explained.rows[0]?.["QUERY PLAN"]);
        expect(nodes.some((node) =>
          node["Index Name"] ===
            "fx_system_point_mutation_redelivery_scheduler_pkey" &&
          node["Actual Rows"] === 1
        )).toBe(true);
        expect(nodes.some((node) =>
          node["Relation Name"] ===
            "fx_system_point_mutation_redelivery_scheduler" &&
          node["Node Type"] === "Seq Scan"
        )).toBe(false);
      });
    });
  }, 60_000);
});

function repository(
  persistence: PostgresFlarexPersistence,
  owner: string,
): PointMutationRedeliverySchedulerCheckpointV1 {
  return createPointMutationRedeliverySchedulerCheckpointV1(
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

async function acquire(repository: PointMutationRedeliverySchedulerCheckpointV1) {
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
    [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
      work(new Proxy(tx, {
        get(inner, property, receiver) {
          if (property === "execute") {
            return (statement: Parameters<AppRowTransaction["execute"]>[0]) =>
              reject()
                ? Promise.reject(cause)
                : inner.execute(statement);
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
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => {
      await target[RUN_LOCATED_READ_COMMITTED_V1](work);
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "decisionUncertain",
        settlementCause: new Error("simulated lost committed response"),
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
    select
      scheduler_state,
      run_fence::text as run_fence,
      checkpoint_sequence::text as checkpoint_sequence,
      run_owner::text as run_owner,
      continuation_bytes
    from fx_system_point_mutation_redelivery_scheduler
    where scheduler_key = 'point_mutation_redelivery_v1'
  `);
  return result.rows[0];
}

function collectPlanNodes(value: unknown): ReadonlyArray<Record<string, unknown>> {
  const nodes: Record<string, unknown>[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    const record = asNonArrayRecord(candidate);
    if (record === null) return;
    if (typeof record["Node Type"] === "string") nodes.push(record);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return nodes;
}

async function continuationEvidence(bytes: Uint8Array) {
  const input = new Uint8Array(bytes);
  return Object.freeze({
    codecVersion: 1 as const,
    canonicalBytes: input,
    sha256: new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
  });
}
