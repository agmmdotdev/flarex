import type { DatabaseSync } from "node:sqlite";

import type {
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Encoding, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  COMPLETION_COMMON_READ_STAGES,
  type CompletionEvidenceInput,
  type CompletionSqlProbe,
  type CompletionSqlStage,
  makeCompletionEvidence,
  makeCompletionSqlProbe,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  canonicalKey,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  snapshotEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

const REPLAY_DEPENDENCY_READ_STAGES = Object.freeze([
  ...COMPLETION_COMMON_READ_STAGES,
  "completion-dependencies-read",
] as const satisfies readonly CompletionSqlStage[]);

const REPLAY_PENDING_READ_STAGES = Object.freeze([
  ...REPLAY_DEPENDENCY_READ_STAGES,
  "pending-publication-read",
] as const satisfies readonly CompletionSqlStage[]);

const MATERIAL_PENDING_READ_STAGES = Object.freeze([
  ...COMPLETION_COMMON_READ_STAGES,
  "active-dependencies-read",
  "completion-dependencies-read",
  "pending-publication-read",
] as const satisfies readonly CompletionSqlStage[]);

const MATERIAL_READ_STAGES = Object.freeze([
  ...MATERIAL_PENDING_READ_STAGES,
  "in-flight-publication-read",
  "publication-state-read",
] as const satisfies readonly CompletionSqlStage[]);

const extraDependencyKey = Encoding.encodeBase64Url(
  "dependency:completion-boundary-extra",
);
const orphanQueryKey = canonicalKey(240);
const alternateQueryIdentity = Encoding.encodeBase64Url(
  "completion-boundary-alternate-identity",
);
const alternateResultDigest = canonicalKey(241);

interface CompletionCorruptionFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: CompletionSqlProbe;
  readonly attempt: QueryEvaluationAttempt;
  readonly input: CompletionEvidenceInput;
  readonly queryKey: string;
}

interface CompletionCorruptionScenario {
  readonly name: string;
  readonly prepare: () => Promise<CompletionCorruptionFixture>;
  readonly mutate: (fixture: CompletionCorruptionFixture) => void;
  readonly causeReason: "rowInvalid" | "transitionFactsRejected";
  readonly evidence: (
    fixture: CompletionCorruptionFixture,
  ) => Readonly<Record<string, unknown>>;
  readonly stages: readonly CompletionSqlStage[];
}

const scalarScenarios = [
  {
    name: "noncanonical stored query identity",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET query_identity = '=' WHERE query_key = ?`).run(fixture.queryKey);
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "evaluationQuery",
      "valueInvalid",
      "query_identity",
    ),
    stages: COMPLETION_COMMON_READ_STAGES,
  },
  {
    name: "invalid active freshness window",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET active_dirty_through_sequence = active_fresh_through_sequence
        WHERE query_key = ?`).run(fixture.queryKey);
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "evaluationQuery",
      "activeGroupInvalid",
      null,
    ),
    stages: COMPLETION_COMMON_READ_STAGES,
  },
  {
    name: "invalid first provisional generation fence",
    prepare: prepareProvisionalFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries
        SET provisional_expected_active_generation = '1'
        WHERE query_key = ?`).run(fixture.queryKey);
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "evaluationQuery",
      "provisionalGroupInvalid",
      null,
    ),
    stages: COMPLETION_COMMON_READ_STAGES,
  },
  {
    name: "query without active or provisional state",
    prepare: prepareProvisionalFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_queries SET
        provisional_generation = NULL,
        provisional_expected_active_generation = NULL,
        provisional_registration_sequence = NULL,
        provisional_requested_dirty_through_sequence = NULL,
        provisional_disposition = NULL
        WHERE query_key = ?`).run(fixture.queryKey);
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "evaluationQuery",
      "queryFactsInvalid",
      null,
    ),
    stages: COMPLETION_COMMON_READ_STAGES,
  },
  {
    name: "noncanonical preceding completion generation",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      updateQuery(fixture, "preceding_completion_generation", "01");
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "evaluationQuery",
      "valueInvalid",
      "preceding_completion_generation",
    ),
    stages: COMPLETION_COMMON_READ_STAGES,
  },
  {
    name: "invalid retained completion window",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      updateQuery(fixture, "preceding_completion_generation", "1");
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "evaluationQuery",
      "completionFactsInvalid",
      null,
    ),
    stages: COMPLETION_COMMON_READ_STAGES,
  },
] as const satisfies readonly CompletionCorruptionScenario[];

const dependencyRowScenarios = [
  {
    name: "malformed completion dependency",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      fixture.prepared.database.prepare(`UPDATE
        deployment_sync_query_dependencies SET dependency_key = '='
        WHERE role = 'completion' AND query_key = ?`).run(fixture.queryKey);
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "dependency",
      "valueInvalid",
      "dependency_key",
    ),
    stages: REPLAY_DEPENDENCY_READ_STAGES,
  },
  {
    name: "wrong completion dependency generation",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      fixture.prepared.database.prepare(`UPDATE
        deployment_sync_query_dependencies SET generation = '2'
        WHERE role = 'completion' AND query_key = ?`).run(fixture.queryKey);
    },
    causeReason: "rowInvalid",
    evidence: (fixture: CompletionCorruptionFixture) => ({
      reason: "dependencyCrossLinkInvalid",
      role: "completion",
      queryKey: fixture.queryKey,
      expectedGeneration: 1n,
    }),
    stages: REPLAY_DEPENDENCY_READ_STAGES,
  },
] as const satisfies readonly CompletionCorruptionScenario[];

const unequalDependencyScenarios = [
  {
    name: "missing completion dependency member",
    mutate: (database: DatabaseSync, queryKey: string) => {
      database.prepare(`DELETE FROM deployment_sync_query_dependencies
        WHERE role = 'completion' AND query_key = ?
          AND dependency_key = (
            SELECT dependency_key FROM deployment_sync_query_dependencies
            WHERE role = 'completion' AND query_key = ?
            ORDER BY dependency_key COLLATE BINARY LIMIT 1
          )`).run(queryKey, queryKey);
    },
  },
  {
    name: "extra completion dependency member",
    mutate: (database: DatabaseSync, queryKey: string) => {
      database.prepare(`INSERT INTO deployment_sync_query_dependencies (
        role, query_key, generation, dependency_key
      ) VALUES ('completion', ?, '1', ?)`).run(queryKey, extraDependencyKey);
    },
  },
  {
    name: "unequal completion dependency member",
    mutate: (database: DatabaseSync, queryKey: string) => {
      updateFirstCompletionDependency(
        database,
        queryKey,
        "dependencyKey",
        extraDependencyKey,
      );
    },
  },
  {
    name: "target-orphaned completion dependency member",
    mutate: (database: DatabaseSync, queryKey: string) => {
      updateFirstCompletionDependency(
        database,
        queryKey,
        "queryKey",
        orphanQueryKey,
      );
    },
  },
  {
    name: "wrong-role completion dependency member",
    mutate: (database: DatabaseSync, queryKey: string) => {
      updateFirstCompletionDependency(
        database,
        queryKey,
        "role",
        extraDependencyKey,
      );
    },
  },
] as const;

const dependencySetScenarios = unequalDependencyScenarios.map(
  scenario => ({
    name: scenario.name,
    prepare: prepareMaterialFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      scenario.mutate(fixture.prepared.database, fixture.queryKey);
    },
    causeReason: "transitionFactsRejected" as const,
    evidence: () => ({
      _tag: "QuerySyncTransitionFactError",
      operation: "completeQueryEvaluation",
      reason: "completionDependenciesInvalid",
    }),
    stages: MATERIAL_READ_STAGES,
  }),
) satisfies readonly CompletionCorruptionScenario[];

const pendingFingerprintScenarios = [
  {
    name: "future pending generation",
    column: "generation",
    value: "2",
  },
  {
    name: "crossed pending query identity",
    column: "query_identity",
    value: alternateQueryIdentity,
  },
  {
    name: "crossed pending completion sequence",
    column: "completed_through_sequence",
    value: "10",
  },
  {
    name: "crossed pending result digest",
    column: "result_digest",
    value: alternateResultDigest,
  },
] as const;

const pendingScenarios = [
  {
    name: "malformed pending publication content",
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      updatePending(fixture, "content", "=");
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "pendingPublication",
      "valueInvalid",
      "content",
    ),
    stages: REPLAY_PENDING_READ_STAGES,
  },
  ...pendingFingerprintScenarios.map(scenario => ({
    name: scenario.name,
    prepare: prepareReplayFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      updatePending(fixture, scenario.column, scenario.value);
    },
    causeReason: "rowInvalid" as const,
    evidence: () => rowCodecEvidence(
      "pendingPublication",
      "pendingPublicationFactsInvalid",
      null,
    ),
    stages: REPLAY_PENDING_READ_STAGES,
  })),
  {
    name: "completion disposition with retained pending publication",
    prepare: prepareMaterialFixture,
    mutate: (fixture: CompletionCorruptionFixture) => {
      updateQuery(fixture, "completion_publication_disposition", "unchanged");
    },
    causeReason: "rowInvalid",
    evidence: () => rowCodecEvidence(
      "pendingPublication",
      "pendingPublicationFactsInvalid",
      null,
    ),
    stages: MATERIAL_PENDING_READ_STAGES,
  },
] as const satisfies readonly CompletionCorruptionScenario[];

const scenarios = [
  ...scalarScenarios,
  ...dependencyRowScenarios,
  ...dependencySetScenarios,
  ...pendingScenarios,
] as const satisfies readonly CompletionCorruptionScenario[];

describe("deployment query-sync completion stored corruption", () => {
  it.each(scenarios)("rejects $name at its owning read stage", async scenario => {
    const fixture = await scenario.prepare();
    try {
      scenario.mutate(fixture);
      const corrupt = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.start();

      const exit = await Effect.runPromiseExit(
        fixture.prepared.state.completeQueryEvaluation(
          fixture.attempt,
          fixture.input.evaluation,
          fixture.input.refresh,
          fixture.input.publication,
        ),
      );

      expectStoredCorruption(
        exit,
        scenario.causeReason,
        scenario.evidence(fixture),
      );
      expect(fixture.probe.stop()).toEqual(scenario.stages);
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        corrupt,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });
});

async function prepareProvisionalFixture(): Promise<
  CompletionCorruptionFixture
> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(319);
  const attempt = await beginEvaluation(prepared, descriptor);
  return Object.freeze({
    prepared,
    probe,
    attempt,
    input: makeCompletionEvidence(prepared, attempt),
    queryKey: descriptor.queryKey,
  });
}

async function prepareReplayFixture(): Promise<CompletionCorruptionFixture> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(320);
  const attempt = await beginEvaluation(prepared, descriptor);
  const input = makeCompletionEvidence(prepared, attempt, {
    dependencyLabels: ["retained"],
    publicationLabel: "retained-publication",
  });
  await completeEvaluation(prepared, attempt, input);
  return Object.freeze({
    prepared,
    probe,
    attempt,
    input,
    queryKey: descriptor.queryKey,
  });
}

async function prepareMaterialFixture(): Promise<CompletionCorruptionFixture> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(321);
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  await completeEvaluation(
    prepared,
    firstAttempt,
    makeCompletionEvidence(prepared, firstAttempt, {
      dependencyLabels: ["alpha", "beta"],
      publicationLabel: "first-publication",
    }),
  );
  const batch = captureCompletionBatch(
    prepared.binding,
    12n,
    ["alpha"],
  );
  await applyCompletionBatch(prepared, batch);
  const attempt = await beginEvaluation(prepared, descriptor, {
    expectedActiveGeneration: firstAttempt.generation,
    requestedDirtyThroughSequence: batch.sourceSequence,
  });
  return Object.freeze({
    prepared,
    probe,
    attempt,
    input: makeCompletionEvidence(prepared, attempt, {
      dependencyLabels: ["alpha", "beta"],
      resultSeed: 242,
      publicationLabel: "replacement-publication",
    }),
    queryKey: descriptor.queryKey,
  });
}

function updateQuery(
  fixture: CompletionCorruptionFixture,
  column:
    | "preceding_completion_generation"
    | "completion_publication_disposition",
  value: string,
): void {
  const database = fixture.prepared.database;
  if (column === "preceding_completion_generation") {
    database.prepare(`UPDATE deployment_sync_queries
      SET preceding_completion_generation = ? WHERE query_key = ?`).run(
      value,
      fixture.queryKey,
    );
    return;
  }
  database.prepare(`UPDATE deployment_sync_queries
    SET completion_publication_disposition = ? WHERE query_key = ?`).run(
    value,
    fixture.queryKey,
  );
}

function updatePending(
  fixture: CompletionCorruptionFixture,
  column:
    | "generation"
    | "query_identity"
    | "completed_through_sequence"
    | "result_digest"
    | "content",
  value: string,
): void {
  const database = fixture.prepared.database;
  const queryKey = fixture.queryKey;
  switch (column) {
    case "generation":
      database.prepare(`UPDATE deployment_sync_pending_publications
        SET generation = ? WHERE query_key = ?`).run(value, queryKey);
      return;
    case "query_identity":
      database.prepare(`UPDATE deployment_sync_pending_publications
        SET query_identity = ? WHERE query_key = ?`).run(value, queryKey);
      return;
    case "completed_through_sequence":
      database.prepare(`UPDATE deployment_sync_pending_publications
        SET completed_through_sequence = ? WHERE query_key = ?`).run(
        value,
        queryKey,
      );
      return;
    case "result_digest":
      database.prepare(`UPDATE deployment_sync_pending_publications
        SET result_digest = ? WHERE query_key = ?`).run(value, queryKey);
      return;
    case "content":
      database.prepare(`UPDATE deployment_sync_pending_publications
        SET content = ? WHERE query_key = ?`).run(value, queryKey);
  }
}

function updateFirstCompletionDependency(
  database: DatabaseSync,
  queryKey: string,
  mutation: "dependencyKey" | "queryKey" | "role",
  value: string,
): void {
  const whereFirst = `WHERE role = 'completion' AND query_key = ?
    AND dependency_key = (
      SELECT dependency_key FROM deployment_sync_query_dependencies
      WHERE role = 'completion' AND query_key = ?
      ORDER BY dependency_key COLLATE BINARY LIMIT 1
    )`;
  switch (mutation) {
    case "dependencyKey":
      database.prepare(`UPDATE deployment_sync_query_dependencies
        SET dependency_key = ? ${whereFirst}`).run(value, queryKey, queryKey);
      return;
    case "queryKey":
      database.prepare(`UPDATE deployment_sync_query_dependencies
        SET query_key = ? ${whereFirst}`).run(value, queryKey, queryKey);
      return;
    case "role":
      database.prepare(`UPDATE deployment_sync_query_dependencies
        SET role = 'active', dependency_key = ? ${whereFirst}`).run(
        value,
        queryKey,
        queryKey,
      );
  }
}

function rowCodecEvidence(
  rowKind: string,
  reason: string,
  field: string | null,
): Readonly<Record<string, unknown>> {
  return {
    _tag: "DeploymentQuerySyncRowCodecError",
    rowKind,
    reason,
    field,
  };
}

function expectStoredCorruption(
  exit: Exit.Exit<unknown, unknown>,
  causeReason: CompletionCorruptionScenario["causeReason"],
  evidence: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(error).toMatchObject({
    _tag: "QuerySyncStoredStateCorruptError",
    operation: "completeQueryEvaluation",
    commitCertainty: "notCommitted",
    reason: "storedAggregateInvalid",
  });
  if (!(error instanceof Error)) {
    throw new Error("Expected a deployment query-sync Error value.");
  }
  expect(error.cause).toMatchObject({
    _tag: "DeploymentQuerySyncStoredStateIssue",
    reason: causeReason,
    evidence,
  });
}
