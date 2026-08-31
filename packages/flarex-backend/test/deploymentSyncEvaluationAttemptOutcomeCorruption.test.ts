import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  ATTEMPT_OUTCOME_COMMON_READ_STAGES,
  type AttemptOutcomeFixture,
  prepareCompletedAttemptOutcomeFixture,
  prepareReadyAttemptOutcomeFixture,
} from "./deploymentSyncEvaluationAttemptOutcomeTestSupport";
import {
  snapshotEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

interface AttemptOutcomeCorruptionScenario {
  readonly name: string;
  readonly prepare: () => Promise<AttemptOutcomeFixture>;
  readonly mutate: (fixture: AttemptOutcomeFixture) => void;
  readonly evidence: Readonly<Record<string, unknown>>;
}

const scenarios = [
  {
    name: "noncanonical stored query identity",
    prepare: () => prepareCompletedAttemptOutcomeFixture(341),
    mutate: (fixture: AttemptOutcomeFixture) => {
      updateQuery(fixture, "query_identity", "=");
    },
    evidence: rowCodecEvidence("valueInvalid", "query_identity"),
  },
  {
    name: "invalid active freshness window",
    prepare: () => prepareCompletedAttemptOutcomeFixture(342),
    mutate: (fixture: AttemptOutcomeFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET active_dirty_through_sequence = active_fresh_through_sequence
        WHERE query_key = ?`).run(fixture.descriptor.queryKey);
    },
    evidence: rowCodecEvidence("activeGroupInvalid", null),
  },
  {
    name: "invalid first provisional generation fence",
    prepare: () => prepareReadyAttemptOutcomeFixture(343),
    mutate: (fixture: AttemptOutcomeFixture) => {
      updateQuery(fixture, "provisional_expected_active_generation", "1");
    },
    evidence: rowCodecEvidence("provisionalGroupInvalid", null),
  },
  {
    name: "query without active or provisional state",
    prepare: () => prepareReadyAttemptOutcomeFixture(344),
    mutate: (fixture: AttemptOutcomeFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries SET
        provisional_generation = NULL,
        provisional_expected_active_generation = NULL,
        provisional_registration_sequence = NULL,
        provisional_requested_dirty_through_sequence = NULL,
        provisional_disposition = NULL
        WHERE query_key = ?`).run(fixture.descriptor.queryKey);
    },
    evidence: rowCodecEvidence("queryFactsInvalid", null),
  },
  {
    name: "noncanonical preceding completion generation",
    prepare: () => prepareCompletedAttemptOutcomeFixture(345),
    mutate: (fixture: AttemptOutcomeFixture) => {
      updateQuery(fixture, "preceding_completion_generation", "01");
    },
    evidence: rowCodecEvidence(
      "valueInvalid",
      "preceding_completion_generation",
    ),
  },
  {
    name: "invalid retained completion window",
    prepare: () => prepareCompletedAttemptOutcomeFixture(346),
    mutate: (fixture: AttemptOutcomeFixture) => {
      updateQuery(fixture, "preceding_completion_generation", "1");
    },
    evidence: rowCodecEvidence("completionFactsInvalid", null),
  },
] as const satisfies readonly AttemptOutcomeCorruptionScenario[];

describe("deployment query-sync attempt-outcome stored corruption", () => {
  it.each(scenarios)("rejects $name after the one-shot read", async scenario => {
    const fixture = await scenario.prepare();
    try {
      scenario.mutate(fixture);
      const corrupt = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.start();

      const exit = await Effect.runPromiseExit(
        fixture.prepared.state.recordEvaluationAttemptOutcome(
          fixture.attempt,
          "terminalRefusal",
        ),
      );

      expectStoredCorruption(exit, scenario.evidence);
      expect(fixture.probe.stop()).toEqual(
        ATTEMPT_OUTCOME_COMMON_READ_STAGES,
      );
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        corrupt,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });
});

function updateQuery(
  fixture: AttemptOutcomeFixture,
  column:
    | "query_identity"
    | "provisional_expected_active_generation"
    | "preceding_completion_generation",
  value: string,
): void {
  const queryKey = fixture.descriptor.queryKey;
  switch (column) {
    case "query_identity":
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET query_identity = ? WHERE query_key = ?`).run(value, queryKey);
      return;
    case "provisional_expected_active_generation":
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET provisional_expected_active_generation = ? WHERE query_key = ?`)
        .run(value, queryKey);
      return;
    case "preceding_completion_generation":
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET preceding_completion_generation = ? WHERE query_key = ?`)
        .run(value, queryKey);
  }
}

function rowCodecEvidence(
  reason: string,
  field: string | null,
) {
  return Object.freeze({
    _tag: "DeploymentQuerySyncRowCodecError",
    rowKind: "evaluationAttemptOutcome",
    reason,
    field,
  });
}

function expectStoredCorruption(
  exit: Exit.Exit<unknown, unknown>,
  evidence: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(error).toMatchObject({
    _tag: "QuerySyncStoredStateCorruptError",
    operation: "recordEvaluationAttemptOutcome",
    commitCertainty: "notCommitted",
    reason: "storedAggregateInvalid",
  });
  if (!(error instanceof Error)) {
    throw new Error("Expected a deployment query-sync Error value.");
  }
  expect(error.cause).toMatchObject({
    _tag: "DeploymentQuerySyncStoredStateIssue",
    reason: "rowInvalid",
    evidence,
  });
}
