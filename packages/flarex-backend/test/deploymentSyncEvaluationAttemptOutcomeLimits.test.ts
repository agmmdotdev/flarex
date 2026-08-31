import {
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_QUERY_SYNC_WORK_REVISION,
  MAX_REFERENCE_QUERIES,
  QuerySyncStateLimitError,
  QuerySyncWorkRevisionExhaustedError,
  captureNamespaceCursor,
  captureQuerySyncWorkRevision,
  recordEvaluationAttemptOutcome as recordReferenceEvaluationAttemptOutcome,
  type NamespaceCursor,
  type QueryEvaluationAttempt,
  type QueryState,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import type {
  DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
import {
  ATTEMPT_OUTCOME_COMMON_READ_STAGES,
  makeAttemptOutcomeSqlProbe,
  recordEvaluationOutcome,
} from "./deploymentSyncEvaluationAttemptOutcomeTestSupport";
import {
  buildCountedCanonicalMaximumEvaluationPopulation,
  seedEvaluationPopulation,
} from "./deploymentSyncEvaluationPopulationTestSupport";
import {
  beginRequest,
  prepareEvaluationState,
  readEvaluationScope,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const MAXIMUM_TEST_TIMEOUT = 120_000;

describe("deployment query-sync attempt-outcome exhaustion", () => {
  it("keeps transient work eligible and prioritizes revision exhaustion at both maxima", async () => {
    const probe = makeAttemptOutcomeSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const population = buildCountedCanonicalMaximumEvaluationPopulation({
        cursor: cursorAt(prepared.binding, 11n),
        evaluationWorkRevision: success(captureQuerySyncWorkRevision(
          MAX_QUERY_SYNC_WORK_REVISION,
        )),
      });
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population.state,
      );
      const attempt = await replayAttempt(prepared, population.target);
      const before = maximumPopulationSnapshot(
        prepared.database,
        population.target.descriptor.queryKey,
      );

      probe.start();
      const eligible = await recordEvaluationOutcome(
        prepared,
        attempt,
        "transientExhausted",
      );
      expect(eligible).toEqual({
        _tag: "eligible",
        queryKey: population.target.descriptor.queryKey,
        generation: attempt.generation,
      });
      expect(probe.stop()).toEqual(ATTEMPT_OUTCOME_COMMON_READ_STAGES);
      expect(maximumPopulationSnapshot(
        prepared.database,
        population.target.descriptor.queryKey,
      )).toEqual(before);

      const expected = resultFailure(recordReferenceEvaluationAttemptOutcome(
        population.state,
        attempt,
        "terminalRefusal",
      ));
      probe.start();
      const exit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          attempt,
          "terminalRefusal",
        ),
      );

      const failure = expectTypedFailure(exit, expected);
      expect(failure).toBeInstanceOf(QuerySyncWorkRevisionExhaustedError);
      expect(failure).toMatchObject({
        _tag: "QuerySyncWorkRevisionExhaustedError",
        operation: "recordEvaluationAttemptOutcome",
        currentRevision: MAX_QUERY_SYNC_WORK_REVISION,
      });
      expect(probe.stop()).toEqual(ATTEMPT_OUTCOME_COMMON_READ_STAGES);
      expect(maximumPopulationSnapshot(
        prepared.database,
        population.target.descriptor.queryKey,
      )).toEqual(before);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);

  it("maps the terminal block's exact two-byte overflow at 64 MiB", async () => {
    const probe = makeAttemptOutcomeSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const population = buildCountedCanonicalMaximumEvaluationPopulation({
        cursor: cursorAt(prepared.binding, 11n),
        evaluationWorkRevision: success(captureQuerySyncWorkRevision(
          BigInt(2 * MAX_REFERENCE_QUERIES),
        )),
      });
      expect(population.state.metrics.countedCanonicalBytes).toBe(
        MAX_COUNTED_CANONICAL_BYTES,
      );
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population.state,
      );
      const attempt = await replayAttempt(prepared, population.target);
      const expected = resultFailure(recordReferenceEvaluationAttemptOutcome(
        population.state,
        attempt,
        "terminalRefusal",
      ));
      const before = maximumPopulationSnapshot(
        prepared.database,
        population.target.descriptor.queryKey,
      );
      probe.start();

      const exit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          attempt,
          "terminalRefusal",
        ),
      );

      const failure = expectTypedFailure(exit, expected);
      expect(failure).toBeInstanceOf(QuerySyncStateLimitError);
      expect(failure).toMatchObject({
        _tag: "QuerySyncStateLimitError",
        operation: "buildQuerySyncState",
        dimension: "countedCanonicalBytes",
        maximum: MAX_COUNTED_CANONICAL_BYTES,
        observed: MAX_COUNTED_CANONICAL_BYTES + 2,
      });
      expect(probe.stop()).toEqual(ATTEMPT_OUTCOME_COMMON_READ_STAGES);
      expect(maximumPopulationSnapshot(
        prepared.database,
        population.target.descriptor.queryKey,
      )).toEqual(before);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);
});

async function replayAttempt(
  prepared: Awaited<ReturnType<typeof prepareEvaluationState>>,
  query: QueryState,
): Promise<QueryEvaluationAttempt> {
  const provisional = query.provisional;
  if (provisional === null) throw new Error("Expected a provisional target.");
  const receipt = await Effect.runPromise(
    prepared.state.beginQueryEvaluation(beginRequest(
      prepared.binding,
      query.descriptor,
      {
        ...(provisional.expectedActiveGeneration === null
          ? {}
          : {
            expectedActiveGeneration: provisional.expectedActiveGeneration,
          }),
        ...(provisional.requestedDirtyThroughSequence === null
          ? {}
          : {
            requestedDirtyThroughSequence:
              provisional.requestedDirtyThroughSequence,
          }),
      },
    )),
  );
  if (receipt._tag !== "replayed") {
    throw new Error(`Expected replayed evaluation, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

function cursorAt(
  binding: DeploymentQuerySyncBinding,
  appliedThroughSequence: bigint,
): NamespaceCursor {
  return success(captureNamespaceCursor({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    appliedThroughSequence,
  }));
}

function maximumPopulationSnapshot(
  database: import("node:sqlite").DatabaseSync,
  queryKey: string,
) {
  return Object.freeze({
    scope: readEvaluationScope(database),
    queryCount: Number(database.prepare(
      "SELECT count(*) AS value FROM deployment_sync_queries",
    ).get()?.value),
    pendingCount: Number(database.prepare(
      "SELECT count(*) AS value FROM deployment_sync_pending_publications",
    ).get()?.value),
    target: database.prepare(`SELECT
      query_key,
      provisional_generation,
      provisional_expected_active_generation,
      provisional_registration_sequence,
      provisional_requested_dirty_through_sequence,
      provisional_disposition
      FROM deployment_sync_queries WHERE query_key = ?`).get(queryKey),
  });
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  expected: unknown,
): unknown {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(failure).toEqual(expected);
  return failure;
}

function resultFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected portable attempt-outcome failure.");
    },
  });
}
