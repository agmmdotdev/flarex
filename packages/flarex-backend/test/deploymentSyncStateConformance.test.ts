import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
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
  completePublication,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  recordEvaluationAttemptOutcome,
  recordPublicationAttemptOutcome,
  type QuerySyncState,
  type SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
  runStateConformanceCommands,
  type QuerySyncStateConformanceTarget,
  type StateConformanceCommand,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Effect, Encoding, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  captureCompletionBatch,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginRequest,
  canonicalKey,
  completionInput,
  prepareUninitializedEvaluationState,
  queryDescriptor,
  success,
  type PreparedEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";
import {
  type DeploymentQuerySyncPublicationOperations,
  makeDeterministicPublicationOperations,
} from "./deploymentSyncPublicationTestSupport";
import {
  normalizedDeploymentQuerySyncState,
} from "./deploymentSyncStateConformanceTestSupport";

const SEEDED_HISTORY_CLOCK_MILLISECONDS = 50_000;
const SEEDED_HISTORY_SEEDS = Object.freeze([
  0x0102_0304,
  0x1020_3040,
  0x5f37_59df,
  0x89ab_cdef,
  0xfedc_ba98,
  0x7fff_ffff,
] as const);
const ALL_OPERATION_TAGS = Object.freeze([
  "applyAdmittedBatchAndAdvance",
  "beginQueryEvaluation",
  "claimEvaluationWork",
  "claimPublication",
  "completePublication",
  "completeQueryEvaluation",
  "initializeOrInspectNamespace",
  "recordEvaluationAttemptOutcome",
  "recordPublicationAttemptOutcome",
] as const satisfies readonly StateConformanceCommand["_tag"][]);

interface SeededHistoryFeatures {
  readonly distinctTailBatchCount: number;
  readonly hasMixedTailDependencyRelevance: boolean;
  readonly successorTrailsFinalCursor: boolean;
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
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [instant, instant],
      );
      const target = makeConformanceTarget(
        prepared,
        deterministic.operations,
      );

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
      expect(deterministic.clockReads()).toBe(2);
    } finally {
      prepared.database.close();
    }
  });

  it("matches repeated seeded nine-operation histories after every command", async () => {
    const featureCoverage: SeededHistoryFeatures[] = [];
    for (const seed of SEEDED_HISTORY_SEEDS) {
      const prepared = await prepareUninitializedEvaluationState();
      try {
        const commands = makeSeededCommands(prepared, seed);
        expect(makeSeededCommands(prepared, seed)).toEqual(commands);
        featureCoverage.push(seededHistoryFeatures(commands));
        expect(Array.from(new Set(commands.map(command => command._tag))).sort())
          .toEqual(ALL_OPERATION_TAGS);
        const instant = success(capturePublicationAttemptInstant(
          SEEDED_HISTORY_CLOCK_MILLISECONDS,
        ));
        const deterministic = makeDeterministicPublicationOperations(
          prepared,
          [instant, instant],
        );
        const target = makeConformanceTarget(
          prepared,
          deterministic.operations,
        );

        const steps = await Effect.runPromise(Effect.gen(function* () {
          yield* TestClock.setTime(SEEDED_HISTORY_CLOCK_MILLISECONDS);
          return yield* runStateConformanceCommands(target, {
            initialExpectedState: null,
            commands,
          });
        }).pipe(Effect.provide(TestClock.layer())));

        expect(steps).toHaveLength(commands.length);
        for (const step of steps) {
          expect(step.outcome).toEqual(step.expectedOutcome);
          expect(step.snapshot).toEqual(step.expectedSnapshot);
        }
        expect(deterministic.clockReads()).toBe(2);
      } finally {
        prepared.database.close();
      }
    }
    expect(featureCoverage.some(
      features => features.distinctTailBatchCount === 3,
    )).toBe(true);
    expect(featureCoverage.some(
      features => features.hasMixedTailDependencyRelevance,
    )).toBe(true);
    expect(featureCoverage.some(
      features => features.successorTrailsFinalCursor,
    )).toBe(true);
  }, 120_000);
});

function makeSeededCommands(
  prepared: PreparedEvaluationState,
  seed: number,
): readonly StateConformanceCommand[] {
  let randomState = seed >>> 0;
  const nextRandom = (): number => {
    randomState = (
      Math.imul(randomState, 1_664_525) + 1_013_904_223
    ) >>> 0;
    return randomState;
  };
  const nextChoice = (choiceCount: number): number =>
    (nextRandom() >>> 16) % choiceCount;

  const bootstrapCursor = prepared.binding.bootstrapCursor;
  const descriptor = queryDescriptor(nextRandom());
  const dependencyLabel = `seeded-conformance-${seed}`;
  let expectedState: QuerySyncState = success(createEmptyQuerySyncState(
    bootstrapCursor,
  ));
  const commands: StateConformanceCommand[] = [{
    _tag: "initializeOrInspectNamespace",
    bootstrapCursor,
  }];
  let sourceOffset = 0n;

  const prefixCount = 1 + nextChoice(3);
  for (let index = 0; index < prefixCount; index += 1) {
    sourceOffset += 1n;
    const batch = captureCompletionBatch(
      prepared.binding,
      bootstrapCursor.appliedThroughSequence + sourceOffset,
      nextChoice(2) === 0 ? [dependencyLabel] : [],
    );
    commands.push({ _tag: "applyAdmittedBatchAndAdvance", batch });
    expectedState = success(applyAdmittedInvalidations(
      expectedState,
      batch,
    )).state;
    if (nextChoice(2) === 0) {
      commands.push({ _tag: "applyAdmittedBatchAndAdvance", batch });
      expectedState = success(applyAdmittedInvalidations(
        expectedState,
        batch,
      )).state;
    }
  }

  const firstRequest = beginRequest(prepared.binding, descriptor);
  commands.push({ _tag: "beginQueryEvaluation", request: firstRequest });
  const begun = success(beginQueryEvaluation(expectedState, firstRequest));
  if (begun._tag !== "created") {
    throw new Error(`Expected seeded creation, received ${begun._tag}.`);
  }
  expectedState = begun.state;
  if (nextChoice(2) === 0) {
    commands.push({ _tag: "beginQueryEvaluation", request: firstRequest });
    expectedState = success(beginQueryEvaluation(
      expectedState,
      firstRequest,
    )).state;
  }

  const evaluationRequest = Object.freeze({
    maximumQueryInspections: 1,
    continuation: null,
  });
  const evaluationClaim = success(claimEvaluationWork(
    expectedState,
    evaluationRequest,
  ));
  if (evaluationClaim._tag !== "claimed") {
    throw new Error("Expected deterministic seeded evaluation work.");
  }
  commands.push({
    _tag: "claimEvaluationWork",
    request: evaluationRequest,
  });
  expectedState = evaluationClaim.state;
  commands.push({
    _tag: "recordEvaluationAttemptOutcome",
    attempt: evaluationClaim.attempt,
    outcome: "transientExhausted",
  });
  expectedState = success(recordEvaluationAttemptOutcome(
    expectedState,
    evaluationClaim.attempt,
    "transientExhausted",
  )).state;

  const firstCompletion = completionInput(
    prepared,
    evaluationClaim.attempt,
    dependencyLabel,
  );
  commands.push({
    _tag: "completeQueryEvaluation",
    attempt: evaluationClaim.attempt,
    ...firstCompletion,
  });
  expectedState = success(completeQueryEvaluation(
    expectedState,
    evaluationClaim.attempt,
    firstCompletion.evaluation,
    firstCompletion.refresh,
    firstCompletion.publication,
  )).state;

  const instant = success(capturePublicationAttemptInstant(
    SEEDED_HISTORY_CLOCK_MILLISECONDS,
  ));
  const publicationClaim = success(claimPublication(expectedState, instant));
  if (publicationClaim._tag !== "claimed") {
    throw new Error("Expected deterministic seeded publication work.");
  }
  commands.push({ _tag: "claimPublication" });
  expectedState = publicationClaim.state;
  commands.push({
    _tag: "recordPublicationAttemptOutcome",
    attempt: publicationClaim.attempt,
    outcome: "knownNotAppended",
  });
  expectedState = success(recordPublicationAttemptOutcome(
    expectedState,
    publicationClaim.attempt,
    "knownNotAppended",
    instant,
  )).state;
  const acceptance = makeAcceptedQueryPublicationEvidenceForTesting({
    identity: publicationClaim.attempt.publication.identity,
    resultDigest: publicationClaim.attempt.publication.resultDigest,
  });
  commands.push({ _tag: "completePublication", evidence: acceptance });
  expectedState = success(completePublication(
    expectedState,
    acceptance,
  )).state;

  const tailCount = 1 + nextChoice(3);
  let requestedDirtyThroughSequence: SyncSequence | null = null;
  for (let index = 0; index < tailCount; index += 1) {
    sourceOffset += 1n;
    const includesDependency = nextChoice(2) === 0;
    const batch = captureCompletionBatch(
      prepared.binding,
      bootstrapCursor.appliedThroughSequence + sourceOffset,
      includesDependency ? [dependencyLabel] : [],
    );
    if (includesDependency) {
      requestedDirtyThroughSequence = batch.sourceSequence;
    }
    commands.push({ _tag: "applyAdmittedBatchAndAdvance", batch });
    expectedState = success(applyAdmittedInvalidations(
      expectedState,
      batch,
    )).state;
    if (nextChoice(3) === 0) {
      commands.push({ _tag: "applyAdmittedBatchAndAdvance", batch });
      expectedState = success(applyAdmittedInvalidations(
        expectedState,
        batch,
      )).state;
    }
  }

  if (requestedDirtyThroughSequence !== null) {
    const secondRequest = beginRequest(prepared.binding, descriptor, {
      expectedActiveGeneration: evaluationClaim.attempt.generation,
      requestedDirtyThroughSequence,
    });
    const secondBegin = success(beginQueryEvaluation(
      expectedState,
      secondRequest,
    ));
    if (secondBegin._tag !== "created") {
      throw new Error(
        `Expected seeded successor creation, received ${secondBegin._tag}.`,
      );
    }
    commands.push({ _tag: "beginQueryEvaluation", request: secondRequest });
    expectedState = secondBegin.state;
    const secondCompletion = completionInput(
      prepared,
      secondBegin.attempt,
      `${dependencyLabel}-successor`,
    );
    commands.push({
      _tag: "completeQueryEvaluation",
      attempt: secondBegin.attempt,
      ...secondCompletion,
    });
  }

  return Object.freeze(commands);
}

function seededHistoryFeatures(
  commands: readonly StateConformanceCommand[],
): SeededHistoryFeatures {
  const publicationCompletionIndex = commands.findIndex(
    command => command._tag === "completePublication",
  );
  if (publicationCompletionIndex < 0) {
    throw new Error("Expected seeded publication completion.");
  }
  const tailCommands = commands.slice(publicationCompletionIndex + 1);
  const tailBatches = tailCommands.filter(
    (command): command is Extract<
      StateConformanceCommand,
      { readonly _tag: "applyAdmittedBatchAndAdvance" }
    > => command._tag === "applyAdmittedBatchAndAdvance",
  );
  const distinctTailBatches = new Map<string, typeof tailBatches[number]>();
  for (const command of tailBatches) {
    distinctTailBatches.set(command.batch.sourceSequence.toString(), command);
  }
  const distinctBatches = Array.from(distinctTailBatches.values());
  const finalBatch = distinctBatches.at(-1);
  if (finalBatch === undefined) {
    throw new Error("Expected at least one seeded tail batch.");
  }
  const dependencyRelevance = distinctBatches.map(
    command => command.batch.dependencyKeys.length > 0,
  );
  const successor = tailCommands.find(
    (command): command is Extract<
      StateConformanceCommand,
      { readonly _tag: "beginQueryEvaluation" }
    > => command._tag === "beginQueryEvaluation",
  );
  const requestedDirtyThroughSequence = successor?.request
    .requestedDirtyThroughSequence ?? null;
  return Object.freeze({
    distinctTailBatchCount: distinctBatches.length,
    hasMixedTailDependencyRelevance:
      new Set(dependencyRelevance).size > 1,
    successorTrailsFinalCursor: requestedDirtyThroughSequence !== null
      && requestedDirtyThroughSequence < finalBatch.batch.sourceSequence,
  });
}

function makeConformanceTarget(
  prepared: PreparedEvaluationState,
  publicationOperations: DeploymentQuerySyncPublicationOperations,
): QuerySyncStateConformanceTarget {
  return Object.freeze({
    ...prepared.state,
    ...publicationOperations,
    bindingForConformance: Object.freeze({
      namespaceId: prepared.binding.namespaceId,
      syncModelId: prepared.binding.syncModelId,
      sourceEpoch: prepared.binding.sourceEpoch,
    }),
    snapshotForConformance: () => Effect.sync(() =>
      normalizedDeploymentQuerySyncState(prepared)
    ),
  });
}
