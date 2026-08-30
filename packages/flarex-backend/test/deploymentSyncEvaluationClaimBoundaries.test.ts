import type { DatabaseSync } from "node:sqlite";

import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  MAX_QUERY_GENERATION,
  MAX_QUERY_SYNC_WORK_REVISION,
  type EvaluationWorkScanContinuation,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  CLAIM_COMMON_READ_STAGES,
  claimEvaluationWork,
  claimRequest,
  type ClaimSqlProbe,
  type ClaimSqlStage,
  insertUndecodableClaimScanSentinel,
  makeClaimSqlProbe,
  seedMaximumBlockedClaimState,
} from "./deploymentSyncClaimTestSupport";
import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  recordEvaluationOutcome,
} from "./deploymentSyncEvaluationAttemptOutcomeTestSupport";
import {
  beginEvaluation,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  readEvaluationScope,
  snapshotEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

const FRESH_SCAN_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "scan-read",
] as const satisfies readonly ClaimSqlStage[]);

const FRESH_POINT_TRACE = Object.freeze([
  ...FRESH_SCAN_TRACE,
  "selected-query-read",
] as const satisfies readonly ClaimSqlStage[]);

const ANCHORED_SCAN_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "anchor-read",
  "scan-read",
] as const satisfies readonly ClaimSqlStage[]);

const ANCHORED_PREFIX_PAGE_TRACE = Object.freeze([
  ...ANCHORED_SCAN_TRACE,
  "scan-read",
] as const satisfies readonly ClaimSqlStage[]);

describe("deployment query-sync evaluation claim boundaries", () => {
  it("admits 4,096 combined facts and rejects an undecoded 4,097 sentinel", async () => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const maximum = seedMaximumBlockedClaimState(prepared);
      const atMaximum = snapshotClaimPopulation(prepared);
      expect(atMaximum).toMatchObject({
        queryCount: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
        scope: {
          metrics: { queryCount: MAX_EVALUATION_WORK_QUERY_INSPECTIONS },
        },
      });
      expect(atMaximum.firstQueryKey).toBe(
        maximum.lowestBlockedWork.queryKey,
      );

      probe.start();
      await expect(claimEvaluationWork(
        prepared,
        claimRequest(MAX_EVALUATION_WORK_QUERY_INSPECTIONS),
      )).resolves.toEqual({
        _tag: "blocked",
        blockedWork: maximum.lowestBlockedWork,
      });
      expect(probe.stop()).toEqual(FRESH_SCAN_TRACE);
      expectScanCompletions(probe, [{ rowsRead: 4_096, limit: 4_097 }]);
      expect(snapshotClaimPopulation(prepared)).toEqual(atMaximum);

      probe.start();
      const partial = await claimEvaluationWork(prepared, claimRequest(1));
      if (partial._tag !== "continued") {
        throw new Error(`Expected continued scan, received ${partial._tag}.`);
      }
      expect(probe.stop()).toEqual(FRESH_SCAN_TRACE);

      probe.start();
      await expect(claimEvaluationWork(
        prepared,
        claimRequest(
          MAX_EVALUATION_WORK_QUERY_INSPECTIONS - 1,
          partial.continuation,
        ),
      )).resolves.toEqual({
        _tag: "blocked",
        blockedWork: maximum.lowestBlockedWork,
      });
      expect(probe.stop()).toEqual([
        ...CLAIM_COMMON_READ_STAGES,
        "scan-read",
        "scan-read",
      ]);
      expectScanCompletions(probe, [
        { rowsRead: 1, limit: 4_097 },
        { rowsRead: 4_095, limit: 4_096 },
      ]);
      expect(snapshotClaimPopulation(prepared)).toEqual(atMaximum);

      const sentinelQueryKey = insertUndecodableClaimScanSentinel(prepared);
      const overMaximum = snapshotClaimPopulation(prepared);
      expect(overMaximum).toMatchObject({
        queryCount: MAX_EVALUATION_WORK_QUERY_INSPECTIONS + 1,
        lastQueryKey: sentinelQueryKey,
      });

      probe.start();
      const freshOverflow = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork(claimRequest(
          MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
        )),
      );
      expectStoredCorruption(
        freshOverflow,
        "transitionFactsRejected",
        "evaluationScanFactsInvalid",
      );
      expect(probe.stop()).toEqual(FRESH_SCAN_TRACE);
      expectScanCompletions(probe, [{ rowsRead: 4_097, limit: 4_097 }]);
      expect(snapshotClaimPopulation(prepared)).toEqual(overMaximum);

      probe.start();
      const resumedOverflow = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork(claimRequest(
          MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
          partial.continuation,
        )),
      );
      expectStoredCorruption(
        resumedOverflow,
        "transitionFactsRejected",
        "evaluationScanFactsInvalid",
      );
      expect(probe.stop()).toEqual([
        ...CLAIM_COMMON_READ_STAGES,
        "scan-read",
        "scan-read",
      ]);
      expectScanCompletions(probe, [
        { rowsRead: 1, limit: 4_097 },
        { rowsRead: 4_096, limit: 4_097 },
      ]);
      expect(snapshotClaimPopulation(prepared)).toEqual(overMaximum);
    } finally {
      prepared.database.close();
    }
  }, 30_000);

  it.each([
    {
      name: "malformed prefix",
      mutate: (database: DatabaseSync, queryKey: string) => {
        database.prepare(`UPDATE deployment_sync_queries
          SET provisional_generation = '01'
          WHERE query_key = ?`).run(queryKey);
      },
      expected: "storedCorruption",
    },
    {
      name: "crossed prefix",
      mutate: (database: DatabaseSync, queryKey: string) => {
        database.prepare(`UPDATE deployment_sync_queries
          SET provisional_disposition = 'ready'
          WHERE query_key = ?`).run(queryKey);
      },
      expected: "invalidContinuation",
    },
  ] as const)("rolls back and rejects a $name", async scenario => {
    const fixture = await prepareBlockedContinuationFixture();
    try {
      expect(fixture.issueTrace).toEqual(ANCHORED_SCAN_TRACE);
      const inspectedQueryKey = fixture.continuation.lastInspectedQueryKey;
      if (inspectedQueryKey === null) {
        throw new Error("Expected one inspected prefix query.");
      }
      const before = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.startStageMutation({
        stage: "scan-read",
        occurrence: 1,
        mutate: () => scenario.mutate(
          fixture.prepared.database,
          inspectedQueryKey,
        ),
      });

      const exit = await Effect.runPromiseExit(
        fixture.prepared.state.claimEvaluationWork(claimRequest(
          1,
          fixture.continuation,
        )),
      );

      if (scenario.expected === "storedCorruption") {
        expectStoredCorruption(exit, "rowInvalid");
      } else {
        expectTypedFailure(exit, {
          _tag: "InvalidEvaluationWorkContinuationError",
          operation: "claimEvaluationWork",
          reason: "notStateIssued",
        });
      }
      expect(fixture.probe.stop()).toEqual(ANCHORED_PREFIX_PAGE_TRACE);
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        before,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });

  it.each([
    {
      name: "missing point",
      mutate: (database: DatabaseSync, queryKey: string) => {
        database.prepare(`DELETE FROM deployment_sync_queries
          WHERE query_key = ?`).run(queryKey);
      },
      causeReason: "transitionFactsRejected",
      transitionReason: "evaluationSelectedQueryFactsInvalid",
    },
    {
      name: "crossed point",
      mutate: (database: DatabaseSync, queryKey: string) => {
        database.prepare(`UPDATE deployment_sync_queries
          SET provisional_disposition = 'blocked'
          WHERE query_key = ?`).run(queryKey);
      },
      causeReason: "transitionFactsRejected",
      transitionReason: "evaluationSelectedQueryFactsInvalid",
    },
    {
      name: "malformed point",
      mutate: (database: DatabaseSync, queryKey: string) => {
        database.prepare(`UPDATE deployment_sync_queries
          SET query_identity = 'not-canonical'
          WHERE query_key = ?`).run(queryKey);
      },
      causeReason: "rowInvalid",
      transitionReason: null,
    },
  ] as const)("rolls back and rejects a $name", async scenario => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const descriptor = queryDescriptor(210);
      await beginEvaluation(prepared, descriptor);
      const before = snapshotEvaluationState(prepared.database);
      probe.startStageMutation({
        stage: "selected-query-read",
        occurrence: 1,
        mutate: () => scenario.mutate(
          prepared.database,
          descriptor.queryKey,
        ),
      });

      const exit = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork(claimRequest(1)),
      );

      expectStoredCorruption(
        exit,
        scenario.causeReason,
        scenario.transitionReason,
      );
      expect(probe.stop()).toEqual(FRESH_POINT_TRACE);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it.each([
    {
      name: "revision exhaustion",
      maximumGeneration: false,
      error: {
        _tag: "QuerySyncWorkRevisionExhaustedError",
        operation: "claimEvaluationWork",
      },
    },
    {
      name: "generation exhaustion before revision exhaustion",
      maximumGeneration: true,
      error: {
        _tag: "QueryGenerationExhaustedError",
        operation: "claimEvaluationWork",
        currentGeneration: MAX_QUERY_GENERATION,
      },
    },
  ] as const)("returns $name without writing", async scenario => {
    const probe = makeClaimSqlProbe();
    const prepared = await prepareDirtyClaimFixture(probe);
    try {
      prepared.database.prepare(`UPDATE deployment_sync_scope_state
        SET evaluation_work_revision = ?
        WHERE singleton = 1`).run(MAX_QUERY_SYNC_WORK_REVISION.toString());
      if (scenario.maximumGeneration) setMaximumRetainedGeneration(prepared);
      const before = snapshotEvaluationState(prepared.database);
      probe.start();

      const exit = await Effect.runPromiseExit(
        prepared.state.claimEvaluationWork(claimRequest(1)),
      );

      expectTypedFailure(exit, scenario.error);
      expect(probe.stop()).toEqual(FRESH_POINT_TRACE);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });
});

interface BlockedContinuationFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: ClaimSqlProbe;
  readonly continuation: EvaluationWorkScanContinuation;
  readonly issueTrace: readonly ClaimSqlStage[];
}

async function prepareBlockedContinuationFixture(): Promise<
  BlockedContinuationFixture
> {
  const probe = makeClaimSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  for (const seed of [220, 230]) {
    await beginEvaluation(prepared, queryDescriptor(seed));
    const claimed = await claimEvaluationWork(prepared, claimRequest(
      MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
    ));
    if (claimed._tag !== "claimed") {
      throw new Error(`Expected fixture claim, received ${claimed._tag}.`);
    }
    await recordEvaluationOutcome(
      prepared,
      claimed.attempt,
      "terminalRefusal",
    );
  }
  probe.start();
  const partial = await claimEvaluationWork(prepared, claimRequest(1));
  if (partial._tag !== "continued") {
    throw new Error(`Expected fixture continuation, received ${partial._tag}.`);
  }
  const issueTrace = probe.stop();
  return Object.freeze({
    prepared,
    probe,
    continuation: partial.continuation,
    issueTrace,
  });
}

async function prepareDirtyClaimFixture(
  probe: ClaimSqlProbe,
): Promise<PreparedEvaluationState> {
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(240);
  const attempt = await beginEvaluation(prepared, descriptor);
  const dependencyLabel = "claim-exhaustion";
  const completed = await completeEvaluation(
    prepared,
    attempt,
    makeCompletionEvidence(prepared, attempt, {
      dependencyLabels: [dependencyLabel],
      resultSeed: 241,
      publicationLabel: "claim-exhaustion-pending",
    }),
  );
  if (completed._tag !== "completed") {
    throw new Error(`Expected completed fixture, received ${completed._tag}.`);
  }
  await applyCompletionBatch(
    prepared,
    captureCompletionBatch(prepared.binding, 12n, [dependencyLabel]),
  );
  return prepared;
}

function setMaximumRetainedGeneration(
  prepared: PreparedEvaluationState,
): void {
  const generation = MAX_QUERY_GENERATION.toString();
  prepared.database.exec("BEGIN IMMEDIATE");
  try {
    const query = prepared.database.prepare(`UPDATE deployment_sync_queries
      SET active_generation = ?, completion_generation = ?`).run(
        generation,
        generation,
      );
    const dependencies = prepared.database.prepare(
      "UPDATE deployment_sync_query_dependencies SET generation = ?",
    ).run(generation);
    const pending = prepared.database.prepare(
      "UPDATE deployment_sync_pending_publications SET generation = ?",
    ).run(generation);
    if (
      query.changes !== 1
      || dependencies.changes !== 2
      || pending.changes !== 1
    ) {
      throw new Error("Expected the complete exhaustion fixture projection.");
    }
    prepared.database.exec("COMMIT");
  } catch (cause) {
    prepared.database.exec("ROLLBACK");
    throw cause;
  }
}

function snapshotClaimPopulation(prepared: PreparedEvaluationState) {
  const count = prepared.database.prepare(
    "SELECT count(*) AS value FROM deployment_sync_queries",
  ).get();
  const first = prepared.database.prepare(`SELECT query_key
    FROM deployment_sync_queries
    ORDER BY query_key COLLATE BINARY
    LIMIT 1`).get();
  const last = prepared.database.prepare(`SELECT query_key
    FROM deployment_sync_queries
    ORDER BY query_key COLLATE BINARY DESC
    LIMIT 1`).get();
  if (count === undefined) throw new Error("Expected claim query count.");
  return Object.freeze({
    scope: readEvaluationScope(prepared.database),
    queryCount: Number(count.value),
    firstQueryKey: first === undefined ? null : String(first.query_key),
    lastQueryKey: last === undefined ? null : String(last.query_key),
  });
}

function expectScanCompletions(
  probe: ClaimSqlProbe,
  expected: readonly Readonly<{ rowsRead: number; limit: number }>[],
): void {
  const scans = probe.completed().filter(
    completion => completion.stage === "scan-read",
  );
  expect(scans).toHaveLength(expected.length);
  for (const [index, expectation] of expected.entries()) {
    const scan = scans[index];
    if (scan === undefined) throw new Error(`Missing scan completion ${index}.`);
    expect(scan.rowsRead).toBe(expectation.rowsRead);
    expect(scan.rowsWritten).toBe(0);
    const normalizedQuery = scan.query.replace(/\s+/gu, " ").trim();
    const limitMatch = /\bLIMIT ([0-9]+);?$/u.exec(normalizedQuery);
    expect(limitMatch?.[1]).toBe(expectation.limit.toString());
  }
}

function expectStoredCorruption(
  exit: Exit.Exit<unknown, unknown>,
  causeReason: string,
  transitionReason: string | null = null,
): void {
  const error = failureOf(exit);
  expect(error).toMatchObject({
    _tag: "QuerySyncStoredStateCorruptError",
    operation: "claimEvaluationWork",
    commitCertainty: "notCommitted",
    reason: "storedAggregateInvalid",
  });
  const cause = errorCause(error);
  expect(cause).toMatchObject({
    _tag: "DeploymentQuerySyncStoredStateIssue",
    reason: causeReason,
  });
  if (transitionReason !== null) {
    expect(cause).toMatchObject({
      evidence: {
        _tag: "QuerySyncTransitionFactError",
        reason: transitionReason,
      },
    });
  }
}

function expectTypedFailure(
  exit: Exit.Exit<unknown, unknown>,
  shape: Readonly<Record<string, unknown>>,
): void {
  expect(Cause.hasDies(failureCause(exit))).toBe(false);
  expect(failureOf(exit)).toMatchObject(shape);
}

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  return Option.getOrThrow(Cause.findErrorOption(failureCause(exit)));
}

function failureCause(
  exit: Exit.Exit<unknown, unknown>,
): Cause.Cause<unknown> {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect failure.");
  return exit.cause;
}

function errorCause(error: unknown): unknown {
  if (!(error instanceof Error)) {
    throw new Error("Expected a deployment query-sync Error value.");
  }
  return error.cause;
}
