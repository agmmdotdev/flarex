import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  buildQuerySyncState,
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  capturePublicationAttemptInstant,
  captureQueryAuthorityWitness,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
  captureQueryPublicationArtifact,
  captureQueryResultDigest,
  claimEvaluationWork,
  claimPublication,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  recordEvaluationAttemptOutcome,
  type QueryState,
  type QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  CompleteQueryScalarFacts,
} from "@flarex/query-sync/internal/transition-plan";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
  runStateConformanceCommands,
  type QuerySyncStateConformanceTarget,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Effect, Encoding, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  decodeDeploymentQuerySyncDependencyRowsResult,
  type DeploymentQuerySyncDependencyRole,
} from "../src/deploymentSync/DependencyRowCodec";
import {
  decodeDeploymentQuerySyncCompleteQueryRowResult,
} from "../src/deploymentSync/EvaluationRowCodec";
import {
  makeDeploymentQuerySyncPublicationOperations,
} from "../src/deploymentSync/PublicationState";
import {
  decodeDeploymentQuerySyncPendingPublicationRowResult,
} from "../src/deploymentSync/PublicationRowCodec";
import {
  readDeploymentQuerySyncPublicationLifecycle,
} from "../src/deploymentSync/PublicationStorage";
import {
  decodeDeploymentQuerySyncScopeRowResult,
} from "../src/deploymentSync/RowCodec";
import {
  bindDeploymentQuerySyncStorage,
} from "../src/deploymentSync/StateStorage";
import {
  canonicalKey,
  prepareUninitializedEvaluationState,
  queryDescriptor,
  success,
  type PreparedEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

function dependencyKeys(
  prepared: PreparedEvaluationState,
  queryKey: CompleteQueryScalarFacts["descriptor"]["queryKey"],
  generation: NonNullable<CompleteQueryScalarFacts["active"]>["generation"],
  role: DeploymentQuerySyncDependencyRole,
) {
  const rows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_query_dependencies
    WHERE role = ? AND query_key = ? AND generation = ?
    ORDER BY dependency_key COLLATE BINARY`).all(
    role,
    queryKey,
    generation.toString(),
  );
  return success(decodeDeploymentQuerySyncDependencyRowsResult(rows, {
    role,
    queryKey,
    generation,
  })).dependencyKeys;
}

function queryState(
  prepared: PreparedEvaluationState,
  query: CompleteQueryScalarFacts,
): QueryState {
  const active = query.active === null
    ? null
    : Object.freeze({
      ...query.active,
      dependencyKeys: dependencyKeys(
        prepared,
        query.descriptor.queryKey,
        query.active.generation,
        "active",
      ),
    });
  const currentCompletion = query.currentCompletion === null
    ? null
    : Object.freeze({
      ...query.currentCompletion,
      evaluationDependencyKeys: dependencyKeys(
        prepared,
        query.descriptor.queryKey,
        query.currentCompletion.identity.generation,
        "completion",
      ),
    });
  return Object.freeze({
    descriptor: query.descriptor,
    active,
    provisional: query.provisional,
    currentCompletion,
    precedingCompletionIdentity: query.precedingCompletionIdentity,
  });
}

function metricsEqual(
  left: QuerySyncState["metrics"],
  right: QuerySyncState["metrics"],
): boolean {
  return left.queryCount === right.queryCount
    && left.retainedIdentityBytes === right.retainedIdentityBytes
    && left.dependencyMemberships === right.dependencyMemberships
    && left.pendingPublicationCount === right.pendingPublicationCount
    && left.inFlightPublicationCount === right.inFlightPublicationCount
    && left.retainedPublicationContentBytes
      === right.retainedPublicationContentBytes
    && left.settlementEnvelopeBytes === right.settlementEnvelopeBytes
    && left.countedCanonicalBytes === right.countedCanonicalBytes;
}

function normalizedSnapshot(
  prepared: PreparedEvaluationState,
): QuerySyncState | null {
  const scopeRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_scope_state
    ORDER BY singleton`).all();
  if (scopeRows.length === 0) return null;
  if (scopeRows.length !== 1 || scopeRows[0] === undefined) {
    throw new Error("Expected one conformance scope row.");
  }
  const scope = success(decodeDeploymentQuerySyncScopeRowResult(scopeRows[0]));
  const queryRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_queries
    ORDER BY query_key COLLATE BINARY`).all();
  const scalarQueries = queryRows.map(row => success(
    decodeDeploymentQuerySyncCompleteQueryRowResult(row, scope.facts),
  ));
  const queries = scalarQueries.map(query => queryState(prepared, query));
  const pendingRows = prepared.database.prepare(`SELECT *
    FROM deployment_sync_pending_publications
    ORDER BY query_key COLLATE BINARY`).all();
  const pending = pendingRows.map(row => {
    const rawQueryKey = row.query_key;
    const owner = scalarQueries.find(
      query => query.descriptor.queryKey === rawQueryKey,
    );
    if (owner === undefined) {
      throw new Error("Expected a conformance pending-publication owner.");
    }
    return success(decodeDeploymentQuerySyncPendingPublicationRowResult(
      row,
      scope.facts,
      owner,
    ));
  });
  const lifecycle = success(readDeploymentQuerySyncPublicationLifecycle(
    prepared.storage.sql,
    scope,
    "claimPublication",
  ));
  const state = success(buildQuerySyncState({
    cursor: scope.facts.cursor,
    queries,
    evaluationWork: scope.facts.evaluationWork,
    publicationWork: Object.freeze({ pending: Object.freeze(pending), ...lifecycle }),
  }));
  if (!metricsEqual(state.metrics, scope.facts.metrics)) {
    throw new Error("Stored and normalized conformance metrics differ.");
  }
  return state;
}

describe("deployment query-sync shared state conformance", () => {
  it("matches one mixed nine-operation portable history", async () => {
    const prepared = await prepareUninitializedEvaluationState();
    try {
      const cursor = prepared.binding.bootstrapCursor;
      const descriptor = queryDescriptor(51);
      const beginRequest = Object.freeze({
        target: success(captureQueryOperationTarget({
          namespaceId: cursor.namespaceId,
          syncModelId: cursor.syncModelId,
          sourceEpoch: cursor.sourceEpoch,
          descriptor,
        })),
        expectedActiveGeneration: null,
        requestedDirtyThroughSequence: null,
      });
      const initial = success(createEmptyQuerySyncState(cursor));
      const begun = success(beginQueryEvaluation(initial, beginRequest));
      const dependencyKey = success(captureCanonicalDependencyKey(
        Encoding.encodeBase64Url("conformance-dependency"),
      ));
      const batch = success(captureAdmittedInvalidationBatch({
        namespaceId: cursor.namespaceId,
        syncModelId: cursor.syncModelId,
        sourceEpoch: cursor.sourceEpoch,
        sourceSequence: cursor.appliedThroughSequence + 1n,
        dependencyKeys: [dependencyKey],
      }));
      const applied = success(applyAdmittedInvalidations(begun.state, batch));
      const evaluationClaim = success(claimEvaluationWork(applied.state, {
        maximumQueryInspections: 1,
        continuation: null,
      }));
      if (evaluationClaim._tag !== "claimed") {
        throw new Error("Expected the preparatory evaluation claim.");
      }
      const transient = success(recordEvaluationAttemptOutcome(
        evaluationClaim.state,
        evaluationClaim.attempt,
        "transientExhausted",
      ));
      const evaluation = success(captureQueryEvaluationEvidence({
        namespaceId: cursor.namespaceId,
        syncModelId: cursor.syncModelId,
        sourceEpoch: cursor.sourceEpoch,
        descriptor,
        generation: evaluationClaim.attempt.generation,
        snapshotSequence: applied.state.cursor.appliedThroughSequence,
        resultDigest: success(captureQueryResultDigest(canonicalKey(52))),
        authorityWitness: success(captureQueryAuthorityWitness(
          canonicalKey(53),
        )),
        dependencyKeys: [dependencyKey],
      }));
      const refresh = success(deriveGenerationRefreshEvidence(
        evaluation,
        applied.state.cursor,
        [],
        evaluation.authorityWitness,
      ));
      const publication = success(captureQueryPublicationArtifact({
        content: Encoding.encodeBase64Url("conformance-publication"),
      }));
      const completed = success(completeQueryEvaluation(
        transient.state,
        evaluationClaim.attempt,
        evaluation,
        refresh,
        publication,
      ));
      const instant = success(capturePublicationAttemptInstant(1_000));
      const publicationClaim = success(claimPublication(
        completed.state,
        instant,
      ));
      if (publicationClaim._tag !== "claimed") {
        throw new Error("Expected the preparatory publication claim.");
      }
      const accepted = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: publicationClaim.attempt.publication.identity,
        resultDigest: publicationClaim.attempt.publication.resultDigest,
      });
      let clockReads = 0;
      const publicationOperations = makeDeploymentQuerySyncPublicationOperations(
        bindDeploymentQuerySyncStorage(prepared.storage),
        prepared.binding,
        () => {
          clockReads += 1;
          return instant;
        },
      );
      const target = Object.freeze({
        ...prepared.state,
        ...publicationOperations,
        bindingForConformance: Object.freeze({
          namespaceId: prepared.binding.namespaceId,
          syncModelId: prepared.binding.syncModelId,
          sourceEpoch: prepared.binding.sourceEpoch,
        }),
        snapshotForConformance: () => Effect.sync(() =>
          normalizedSnapshot(prepared)
        ),
      } satisfies QuerySyncStateConformanceTarget);

      const steps = await Effect.runPromise(Effect.gen(function* () {
        yield* TestClock.setTime(1_000);
        return yield* runStateConformanceCommands(target, {
          initialExpectedState: null,
          commands: [
            { _tag: "initializeOrInspectNamespace", bootstrapCursor: cursor },
            { _tag: "beginQueryEvaluation", request: beginRequest },
            { _tag: "applyAdmittedBatchAndAdvance", batch },
            {
              _tag: "claimEvaluationWork",
              request: { maximumQueryInspections: 1, continuation: null },
            },
            {
              _tag: "recordEvaluationAttemptOutcome",
              attempt: evaluationClaim.attempt,
              outcome: "transientExhausted",
            },
            {
              _tag: "completeQueryEvaluation",
              attempt: evaluationClaim.attempt,
              evaluation,
              refresh,
              publication,
            },
            { _tag: "claimPublication" },
            {
              _tag: "recordPublicationAttemptOutcome",
              attempt: publicationClaim.attempt,
              outcome: "knownNotAppended",
            },
            { _tag: "completePublication", evidence: accepted },
          ],
        });
      }).pipe(Effect.provide(TestClock.layer())));

      expect(steps.map(step => Result.getOrThrow(step.outcome)._tag)).toEqual([
        "initialized",
        "created",
        "applied",
        "claimed",
        "eligible",
        "completed",
        "claimed",
        "recorded",
        "completed",
      ]);
      for (const step of steps) {
        expect(step.outcome).toEqual(step.expectedOutcome);
        expect(step.snapshot).toEqual(step.expectedSnapshot);
      }
      expect(clockReads).toBe(2);
    } finally {
      prepared.database.close();
    }
  });
});
