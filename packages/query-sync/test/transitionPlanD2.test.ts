import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  GenerationRefreshEvidence,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryPublicationArtifact,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import { buildQuerySyncState } from "../src/kernel/Model.js";
import {
  applyCompleteQueryEvaluationTransition,
} from "../src/kernel/TransitionPlanAggregate.js";
import { projectCompleteReceipt } from "../src/state/Receipts.js";
import {
  executeNormalizedCompleteQueryEvaluation,
  normalizeQuerySyncState,
} from "../src/testing/conformance/NormalizedTransitionPlan.js";
import {
  resumeCompleteQueryEvaluationMaterial,
  resumeCompleteQueryEvaluationReplay,
  startCompleteQueryEvaluation,
} from "../src/transition-plan/CompleteQueryEvaluation.js";
import type {
  CompleteQueryEvaluationStart,
} from "../src/transition-plan/CompleteQueryEvaluation.js";
import { QuerySyncTransitionResumeDefect } from
  "../src/transition-plan/Errors.js";
import {
  freezeCompleteQueryMaterialFactsRead,
  freezeCompleteQueryReplayFactsRead,
  freezeCompleteQueryScalarFacts,
} from "../src/transition-plan/Facts.js";
import type {
  CompleteQueryMaterialFactsRead,
  CompleteQueryReplayFactsRead,
  CompleteQueryScalarFacts,
} from "../src/transition-plan/Facts.js";
import {
  MAX_QUERY_DEPENDENCY_KEYS,
  MAX_QUERY_DEPENDENCY_SENTINEL,
} from "../src/transition-plan/Limits.js";

import {
  batch,
  canonicalText,
  cursor,
  descriptor,
  evaluation,
  firstEvaluationRequest,
  getEvaluationAttempt,
  getSuccess,
  publicationArtifact,
  rerunEvaluationRequest,
  target,
  witness,
} from "./fixtures.js";

interface CompletionInput {
  readonly attempt: QueryEvaluationAttempt;
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}

function beginFirst(
  state: QuerySyncState,
  queryTarget = target(),
): Readonly<{
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
}> {
  const decision = getSuccess(beginQueryEvaluation(
    state,
    firstEvaluationRequest(queryTarget),
  ));
  return Object.freeze({
    state: decision.state,
    attempt: getEvaluationAttempt(decision),
  });
}

function completionInput(input: {
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
  readonly dependencies?: readonly string[];
  readonly resultSeed?: number;
  readonly witnessSeed?: number;
  readonly refreshWitnessSeed?: number;
  readonly refreshBatches?: readonly ReturnType<typeof batch>[];
  readonly publicationContent?: string;
}): CompletionInput {
  const queryEvaluation = evaluation({
    descriptor: input.attempt.descriptor,
    generation: input.attempt.generation,
    snapshot: input.attempt.registrationCursor.appliedThroughSequence,
    ...(input.dependencies === undefined
      ? {}
      : { dependencies: input.dependencies }),
    ...(input.resultSeed === undefined
      ? {}
      : { resultSeed: input.resultSeed }),
    ...(input.witnessSeed === undefined
      ? {}
      : { witnessSeed: input.witnessSeed }),
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    input.state.cursor,
    input.refreshBatches ?? [],
    input.refreshWitnessSeed === undefined
      ? queryEvaluation.authorityWitness
      : witness(input.refreshWitnessSeed),
  ));
  return Object.freeze({
    attempt: input.attempt,
    evaluation: queryEvaluation,
    refresh,
    publication: publicationArtifact(
      input.publicationContent ?? "d2-publication",
    ),
  });
}

function expectCompletionConformance(
  state: QuerySyncState,
  input: CompletionInput,
) {
  const normalized = getSuccess(
    executeNormalizedCompleteQueryEvaluation(
      normalizeQuerySyncState(state),
      input.attempt,
      input.evaluation,
      input.refresh,
      input.publication,
    ),
  );
  const aggregate = getSuccess(applyCompleteQueryEvaluationTransition(
    state,
    input.attempt,
    input.evaluation,
    input.refresh,
    input.publication,
  ));
  expect(normalized.receipt).toEqual(
    projectCompleteReceipt(aggregate.decision),
  );
  expect(normalized.plan).toEqual(aggregate.plan);
  expect(normalized.disposition).toBe(aggregate.disposition);
  expect(normalized.state).toEqual(aggregate.decision.state);
  return Object.freeze({ normalized, aggregate });
}

function installInitial(input: {
  readonly state?: QuerySyncState;
  readonly dependency?: string;
  readonly resultSeed?: number;
  readonly publicationContent?: string;
  readonly queryTarget?: ReturnType<typeof target>;
} = {}) {
  const initial = input.state
    ?? getSuccess(createEmptyQuerySyncState(cursor()));
  const begun = beginFirst(initial, input.queryTarget);
  const completion = completionInput({
    state: begun.state,
    attempt: begun.attempt,
    dependencies: input.dependency === undefined
      ? []
      : [input.dependency],
    ...(input.resultSeed === undefined
      ? {}
      : { resultSeed: input.resultSeed }),
    ...(input.publicationContent === undefined
      ? {}
      : { publicationContent: input.publicationContent }),
  });
  const completed = getSuccess(completeQueryEvaluation(
    begun.state,
    completion.attempt,
    completion.evaluation,
    completion.refresh,
    completion.publication,
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected an installed query fixture.");
  }
  return Object.freeze({
    state: completed.state,
    completion,
    queryTarget: input.queryTarget ?? target(),
  });
}

function prepareRerun(input: {
  readonly state: QuerySyncState;
  readonly dependency: string;
  readonly sequence: bigint;
  readonly resultSeed: number;
  readonly publicationContent: string;
  readonly queryTarget?: ReturnType<typeof target>;
}) {
  const queryTarget = input.queryTarget ?? target();
  const admitted = batch({
    sequence: input.sequence,
    dependencies: [input.dependency],
  });
  const invalidated = getSuccess(applyAdmittedInvalidations(
    input.state,
    admitted,
  ));
  const active = invalidated.state.queries.find((query) => (
    query.descriptor.queryKey === queryTarget.descriptor.queryKey
  ))?.active;
  if (
    active === null
    || active === undefined
    || active.dirtyThroughSequence === null
  ) {
    throw new Error("Expected a dirty active query.");
  }
  const begun = getSuccess(beginQueryEvaluation(
    invalidated.state,
    rerunEvaluationRequest({
      target: queryTarget,
      activeGeneration: active.generation,
      dirtyThroughSequence: active.dirtyThroughSequence,
    }),
  ));
  const attempt = getEvaluationAttempt(begun);
  return Object.freeze({
    state: begun.state,
    completion: completionInput({
      state: begun.state,
      attempt,
      dependencies: [input.dependency],
      resultSeed: input.resultSeed,
      publicationContent: input.publicationContent,
    }),
    queryTarget,
  });
}

function scalarFacts(
  state: QuerySyncState,
  queryKey: ReturnType<typeof descriptor>["queryKey"],
): CompleteQueryScalarFacts {
  const normalized = normalizeQuerySyncState(state);
  const query = normalized.queries.find((candidate) => (
    candidate.descriptor.queryKey === queryKey
  ));
  if (query === undefined) throw new Error("Expected scalar query facts.");
  return freezeCompleteQueryScalarFacts({
    descriptor: query.descriptor,
    active: query.active,
    provisional: query.provisional,
    currentCompletion: query.currentCompletion,
    precedingCompletionIdentity: query.precedingCompletionIdentity,
  });
}

function startCompletion(
  state: QuerySyncState,
  input: CompletionInput,
): CompleteQueryEvaluationStart {
  const normalized = normalizeQuerySyncState(state);
  return getSuccess(startCompleteQueryEvaluation({
    scope: normalized.scope,
    query: scalarFacts(state, input.attempt.descriptor.queryKey),
    attempt: input.attempt,
    evaluation: input.evaluation,
    refresh: input.refresh,
    publication: input.publication,
  }));
}

function materialRead(
  state: QuerySyncState,
  queryKey: ReturnType<typeof descriptor>["queryKey"],
): CompleteQueryMaterialFactsRead {
  const query = state.queries.find((candidate) => (
    candidate.descriptor.queryKey === queryKey
  ));
  if (query === undefined) throw new Error("Expected a material query.");
  return freezeCompleteQueryMaterialFactsRead({
    queryKey,
    activeDependencies: query.active === null
      ? null
      : {
        queryKey,
        generation: query.active.generation,
        dependencyKeys: query.active.dependencyKeys,
      },
    completionDependencies: query.currentCompletion === null
      ? null
      : {
        queryKey,
        generation: query.currentCompletion.identity.generation,
        dependencyKeys:
          query.currentCompletion.evaluationDependencyKeys,
      },
    pendingPublication: state.publicationWork.pending.find(
      (publication) => publication.identity.queryKey === queryKey,
    ) ?? null,
    lifecycle: {
      queryKey,
      inFlight: null,
      latestDelivered: null,
      precedingAttemptOutcome: null,
    },
  });
}

function replayRead(
  state: QuerySyncState,
  queryKey: ReturnType<typeof descriptor>["queryKey"],
): CompleteQueryReplayFactsRead {
  const query = state.queries.find((candidate) => (
    candidate.descriptor.queryKey === queryKey
  ));
  const completion = query?.currentCompletion;
  if (query === undefined || completion === null || completion === undefined) {
    throw new Error("Expected completion replay facts.");
  }
  return freezeCompleteQueryReplayFactsRead({
    queryKey,
    completionDependencies: {
      queryKey,
      generation: completion.identity.generation,
      dependencyKeys: completion.evaluationDependencyKeys,
    },
    retainedPublication: state.publicationWork.pending.find(
      (publication) => publication.identity.queryKey === queryKey,
    ) ?? null,
  });
}

describe("QSYNC01-D2 completion transition plans", () => {
  it("matches aggregate pending insertion, replacement, and unchanged writes", () => {
    const dependency = canonicalText("d2:write-variants");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = beginFirst(initial);
    const first = completionInput({
      state: begun.state,
      attempt: begun.attempt,
      dependencies: [dependency],
      resultSeed: 201,
      publicationContent: "d2-insert",
    });
    const inserted = expectCompletionConformance(begun.state, first);
    expect(inserted.normalized.plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "completed",
        publicationDisposition: { _tag: "pending" },
      },
      change: {
        pendingPublication: { _tag: "replaceTargetPending" },
      },
    });
    expect(inserted.normalized.state.publicationWork.pending).toHaveLength(1);

    const replacement = prepareRerun({
      state: inserted.normalized.state,
      dependency,
      sequence: 1n,
      resultSeed: 202,
      publicationContent: "d2-replacement",
    });
    const replaced = expectCompletionConformance(
      replacement.state,
      replacement.completion,
    );
    expect(replaced.normalized.plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "completed",
        publicationDisposition: { _tag: "pending" },
      },
      change: {
        pendingPublication: {
          _tag: "replaceTargetPending",
          publication: { identity: { generation: 2n } },
        },
      },
    });
    expect(replaced.normalized.state.publicationWork.pending).toHaveLength(1);
    expect(
      replaced.normalized.state.publicationWork.pending[0]?.content,
    ).toBe(replacement.completion.publication.content);

    const unchanged = prepareRerun({
      state: inserted.normalized.state,
      dependency,
      sequence: 1n,
      resultSeed: 201,
      publicationContent: "d2-unused-unchanged",
    });
    const preserved = expectCompletionConformance(
      unchanged.state,
      unchanged.completion,
    );
    expect(preserved.normalized.plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "completed",
        publicationDisposition: { _tag: "unchanged" },
      },
      change: {
        pendingPublication: { _tag: "preserveTargetPending" },
      },
    });
    expect(preserved.normalized.state.publicationWork.pending).toEqual(
      inserted.normalized.state.publicationWork.pending,
    );
    expect(preserved.normalized.state.queries[0]?.active).toMatchObject({
      generation: 2n,
      dirtyThroughSequence: null,
    });
  });

  it("matches every no-write completion receipt", () => {
    const dependency = canonicalText("d2:no-write");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));

    const replayBegun = beginFirst(initial);
    const replayInput = completionInput({
      state: replayBegun.state,
      attempt: replayBegun.attempt,
      dependencies: [dependency],
      publicationContent: "d2-replay",
    });
    const installed = getSuccess(completeQueryEvaluation(
      replayBegun.state,
      replayInput.attempt,
      replayInput.evaluation,
      replayInput.refresh,
      replayInput.publication,
    ));
    if (installed._tag !== "completed") {
      throw new Error("Expected a completed replay fixture.");
    }
    expect(
      expectCompletionConformance(installed.state, replayInput)
        .normalized.receipt._tag,
    ).toBe("replayed");

    const refreshBegun = beginFirst(initial);
    const refreshEvaluation = evaluation({
      descriptor: refreshBegun.attempt.descriptor,
      generation: refreshBegun.attempt.generation,
      snapshot: 0n,
    });
    const staleRefresh = getSuccess(deriveGenerationRefreshEvidence(
      refreshEvaluation,
      refreshBegun.state.cursor,
      [],
      refreshEvaluation.authorityWitness,
    ));
    const advanced = getSuccess(applyAdmittedInvalidations(
      refreshBegun.state,
      batch({ sequence: 1n }),
    ));
    const refreshRequired: CompletionInput = Object.freeze({
      attempt: refreshBegun.attempt,
      evaluation: refreshEvaluation,
      refresh: staleRefresh,
      publication: publicationArtifact("d2-refresh-required"),
    });
    expect(
      expectCompletionConformance(advanced.state, refreshRequired)
        .normalized.receipt._tag,
    ).toBe("refreshRequired");

    const resnapshotBegun = beginFirst(initial);
    const resnapshotInput = completionInput({
      state: resnapshotBegun.state,
      attempt: resnapshotBegun.attempt,
      witnessSeed: 211,
      refreshWitnessSeed: 212,
      publicationContent: "d2-resnapshot",
    });
    expect(
      expectCompletionConformance(resnapshotBegun.state, resnapshotInput)
        .normalized.receipt._tag,
    ).toBe("resnapshotRequired");

    const rerunBegun = beginFirst(initial);
    const rerunEvaluation = evaluation({
      descriptor: rerunBegun.attempt.descriptor,
      generation: rerunBegun.attempt.generation,
      snapshot: 0n,
      dependencies: [dependency],
    });
    const relevantBatch = batch({
      sequence: 1n,
      dependencies: [dependency],
    });
    const rerunAdvanced = getSuccess(applyAdmittedInvalidations(
      rerunBegun.state,
      relevantBatch,
    ));
    const rerunRefresh = getSuccess(deriveGenerationRefreshEvidence(
      rerunEvaluation,
      rerunAdvanced.state.cursor,
      [relevantBatch],
      rerunEvaluation.authorityWitness,
    ));
    const rerunRequired: CompletionInput = Object.freeze({
      attempt: rerunBegun.attempt,
      evaluation: rerunEvaluation,
      refresh: rerunRefresh,
      publication: publicationArtifact("d2-rerun-required"),
    });
    expect(
      expectCompletionConformance(rerunAdvanced.state, rerunRequired)
        .normalized.receipt._tag,
    ).toBe("rerunRequired");

    const generationOne = installInitial({
      dependency,
      resultSeed: 221,
      publicationContent: "d2-generation-one",
    });
    const generationTwoPending = prepareRerun({
      state: generationOne.state,
      dependency,
      sequence: 1n,
      resultSeed: 222,
      publicationContent: "d2-generation-two",
    });
    const generationTwo = getSuccess(completeQueryEvaluation(
      generationTwoPending.state,
      generationTwoPending.completion.attempt,
      generationTwoPending.completion.evaluation,
      generationTwoPending.completion.refresh,
      generationTwoPending.completion.publication,
    ));
    if (generationTwo._tag !== "completed") {
      throw new Error("Expected generation two completion.");
    }
    expect(
      expectCompletionConformance(
        generationTwo.state,
        generationOne.completion,
      ).normalized.receipt._tag,
    ).toBe("superseded");

    const generationThreePending = prepareRerun({
      state: generationTwo.state,
      dependency,
      sequence: 2n,
      resultSeed: 223,
      publicationContent: "d2-generation-three",
    });
    const generationThree = getSuccess(completeQueryEvaluation(
      generationThreePending.state,
      generationThreePending.completion.attempt,
      generationThreePending.completion.evaluation,
      generationThreePending.completion.refresh,
      generationThreePending.completion.publication,
    ));
    if (generationThree._tag !== "completed") {
      throw new Error("Expected generation three completion.");
    }
    expect(
      expectCompletionConformance(
        generationThree.state,
        generationOne.completion,
      ).normalized.receipt._tag,
    ).toBe("recoveryEvidenceExpired");
  });

  it("reads only the exact replay fingerprint and treats retained content as optional", () => {
    const dependency = canonicalText("d2:exact-replay");
    const installed = installInitial({
      dependency,
      resultSeed: 231,
      publicationContent: "d2-retained-replay",
    });
    const started = startCompletion(installed.state, installed.completion);
    expect(started).toMatchObject({
      _tag: "read",
      stage: "replay",
      intent: {
        queryKey: installed.completion.attempt.descriptor.queryKey,
        completionGeneration: 1n,
        maximumCompletionDependencyMembers:
          MAX_QUERY_DEPENDENCY_SENTINEL,
        retainedPublicationIdentity: { generation: 1n },
      },
    });
    if (started._tag !== "read" || started.stage !== "replay") {
      throw new Error("Expected a replay read.");
    }
    const replayed = getSuccess(resumeCompleteQueryEvaluationReplay(
      started.resume,
      replayRead(
        installed.state,
        installed.completion.attempt.descriptor.queryKey,
      ),
    ));
    expect(replayed).toMatchObject({
      _tag: "noWrite",
      receipt: { _tag: "replayed", generation: 1n },
    });

    const withoutRetained = getSuccess(buildQuerySyncState({
      cursor: installed.state.cursor,
      queries: installed.state.queries,
      evaluationWork: installed.state.evaluationWork,
      publicationWork: {
        ...installed.state.publicationWork,
        pending: [],
      },
    }));
    const optional = expectCompletionConformance(
      withoutRetained,
      Object.freeze({
        ...installed.completion,
        publication: publicationArtifact("d2-content-not-retained"),
      }),
    );
    expect(optional.normalized.receipt._tag).toBe("replayed");
    expect(optional.normalized.state).toEqual(withoutRetained);
  });

  it("declares bounded material reads and stops at the limit-plus-one sentinel", () => {
    const dependency = canonicalText("d2:bounded-material");
    const installed = installInitial({ dependency, resultSeed: 241 });
    const rerun = prepareRerun({
      state: installed.state,
      dependency,
      sequence: 1n,
      resultSeed: 242,
      publicationContent: "d2-bounded-material",
    });
    const started = startCompletion(rerun.state, rerun.completion);
    expect(started).toMatchObject({
      _tag: "read",
      stage: "material",
      intent: {
        activeGeneration: 1n,
        completionGeneration: 1n,
        maximumActiveDependencyMembers: MAX_QUERY_DEPENDENCY_SENTINEL,
        maximumCompletionDependencyMembers:
          MAX_QUERY_DEPENDENCY_SENTINEL,
      },
    });

    const normalized = normalizeQuerySyncState(rerun.state);
    const queryKey = rerun.completion.attempt.descriptor.queryKey;
    const generation = rerun.state.queries.find((query) => (
      query.descriptor.queryKey === queryKey
    ))?.active?.generation;
    if (generation === undefined) throw new Error("Expected active facts.");
    const dependencyKey = normalized.activeDependencies[0]?.dependencyKey;
    if (dependencyKey === undefined) throw new Error("Expected dependency.");
    const rows = Array.from(
      { length: MAX_QUERY_DEPENDENCY_SENTINEL },
      () => Object.freeze({ queryKey, generation, dependencyKey }),
    );
    let beyondSentinelReads = 0;
    rows.push(Object.defineProperty(
      { queryKey, generation, dependencyKey },
      "queryKey",
      {
        enumerable: true,
        get: () => {
          beyondSentinelReads += 1;
          throw new Error("Read beyond dependency sentinel.");
        },
      },
    ));
    const oversized = Object.freeze({
      ...normalized,
      activeDependencies: Object.freeze(rows),
    });
    const result = executeNormalizedCompleteQueryEvaluation(
      oversized,
      rerun.completion.attempt,
      rerun.completion.evaluation,
      rerun.completion.refresh,
      rerun.completion.publication,
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "QuerySyncTransitionFactError",
        reason: "activeDependenciesInvalid",
      });
    }
    expect(beyondSentinelReads).toBe(0);
  });

  it("rejects forged and cross-stage completion resume capabilities", () => {
    const dependency = canonicalText("d2:resume-capability");
    const installed = installInitial({ dependency, resultSeed: 251 });
    const replayStart = startCompletion(
      installed.state,
      installed.completion,
    );
    if (replayStart._tag !== "read" || replayStart.stage !== "replay") {
      throw new Error("Expected replay capability.");
    }
    const rerun = prepareRerun({
      state: installed.state,
      dependency,
      sequence: 1n,
      resultSeed: 252,
      publicationContent: "d2-resume-capability",
    });
    const materialStart = startCompletion(rerun.state, rerun.completion);
    if (materialStart._tag !== "read" || materialStart.stage !== "material") {
      throw new Error("Expected material capability.");
    }
    const replayFacts = replayRead(
      installed.state,
      installed.completion.attempt.descriptor.queryKey,
    );
    const materialFacts = materialRead(
      rerun.state,
      rerun.completion.attempt.descriptor.queryKey,
    );

    expect(() => Reflect.apply(
      resumeCompleteQueryEvaluationReplay,
      undefined,
      [Object.freeze({}), replayFacts],
    )).toThrowError(QuerySyncTransitionResumeDefect);
    expect(() => Reflect.apply(
      resumeCompleteQueryEvaluationReplay,
      undefined,
      [materialStart.resume, replayFacts],
    )).toThrowError(QuerySyncTransitionResumeDefect);
    expect(() => Reflect.apply(
      resumeCompleteQueryEvaluationMaterial,
      undefined,
      [replayStart.resume, materialFacts],
    )).toThrowError(QuerySyncTransitionResumeDefect);
  });

  it("rejects dependency cardinality and crossed material facts before planning", () => {
    const dependency = canonicalText("d2:material-facts");
    const installed = installInitial({ dependency, resultSeed: 261 });
    const rerun = prepareRerun({
      state: installed.state,
      dependency,
      sequence: 1n,
      resultSeed: 262,
      publicationContent: "d2-material-facts",
    });
    const startOversized = startCompletion(rerun.state, rerun.completion);
    if (
      startOversized._tag !== "read"
      || startOversized.stage !== "material"
    ) {
      throw new Error("Expected a material read.");
    }
    const valid = materialRead(
      rerun.state,
      rerun.completion.attempt.descriptor.queryKey,
    );
    if (valid.activeDependencies === null) {
      throw new Error("Expected active dependencies.");
    }
    const dependencyKey = valid.activeDependencies.dependencyKeys[0];
    if (dependencyKey === undefined) throw new Error("Expected dependency.");
    const oversized = Object.freeze(Array.from(
      { length: MAX_QUERY_DEPENDENCY_KEYS + 1 },
      () => dependencyKey,
    ));
    const cardinality = resumeCompleteQueryEvaluationMaterial(
      startOversized.resume,
      Object.freeze({
        ...valid,
        activeDependencies: Object.freeze({
          ...valid.activeDependencies,
          dependencyKeys: oversized,
        }),
      }),
    );
    expect(Result.isFailure(cardinality)).toBe(true);
    if (Result.isFailure(cardinality)) {
      expect(cardinality.failure).toMatchObject({
        _tag: "QuerySyncTransitionFactError",
        reason: "activeDependenciesInvalid",
      });
    }

    const startCrossed = startCompletion(rerun.state, rerun.completion);
    if (startCrossed._tag !== "read" || startCrossed.stage !== "material") {
      throw new Error("Expected another material read.");
    }
    if (valid.completionDependencies === null) {
      throw new Error("Expected completion dependencies.");
    }
    const crossed = resumeCompleteQueryEvaluationMaterial(
      startCrossed.resume,
      Object.freeze({
        ...valid,
        completionDependencies: Object.freeze({
          ...valid.completionDependencies,
          queryKey: descriptor({ keySeed: 99 }).queryKey,
        }),
      }),
    );
    expect(Result.isFailure(crossed)).toBe(true);
    if (Result.isFailure(crossed)) {
      expect(crossed.failure).toMatchObject({
        _tag: "QuerySyncTransitionFactError",
        reason: "completionDependenciesInvalid",
      });
    }
  });

  it("captures caller inputs and returns owned frozen completion plans", () => {
    const dependency = canonicalText("d2:owned-input");
    const replacementDependency = evaluation({
      generation: 1n,
      snapshot: 0n,
      dependencies: [canonicalText("d2:mutated-input")],
    }).dependencyKeys[0];
    if (replacementDependency === undefined) {
      throw new Error("Expected replacement dependency.");
    }
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = beginFirst(initial);
    const capturedEvaluation = evaluation({
      descriptor: begun.attempt.descriptor,
      generation: begun.attempt.generation,
      snapshot: begun.attempt.registrationCursor.appliedThroughSequence,
      dependencies: [dependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      capturedEvaluation,
      begun.state.cursor,
      [],
      capturedEvaluation.authorityWitness,
    ));
    const mutableDependencies = [...capturedEvaluation.dependencyKeys];
    const mutableEvaluation: QueryEvaluationEvidence = {
      ...capturedEvaluation,
      dependencyKeys: mutableDependencies,
    };
    const capturedPublication = publicationArtifact("d2-owned-publication");
    const mutablePublication: QueryPublicationArtifact = {
      content: capturedPublication.content,
    };
    const normalized = normalizeQuerySyncState(begun.state);
    const started = getSuccess(startCompleteQueryEvaluation({
      scope: normalized.scope,
      query: scalarFacts(
        begun.state,
        begun.attempt.descriptor.queryKey,
      ),
      attempt: begun.attempt,
      evaluation: mutableEvaluation,
      refresh,
      publication: mutablePublication,
    }));
    expect(mutableDependencies).toEqual([dependency]);
    expect(mutablePublication).toEqual(capturedPublication);
    if (started._tag !== "read" || started.stage !== "material") {
      throw new Error("Expected material continuation.");
    }
    mutableDependencies[0] = replacementDependency;
    Reflect.set(
      mutablePublication,
      "content",
      publicationArtifact("d2-mutated-publication").content,
    );
    const read: CompleteQueryMaterialFactsRead = {
      queryKey: begun.attempt.descriptor.queryKey,
      activeDependencies: null,
      completionDependencies: null,
      pendingPublication: null,
      lifecycle: {
        queryKey: begun.attempt.descriptor.queryKey,
        inFlight: null,
        latestDelivered: null,
        precedingAttemptOutcome: null,
      },
    };
    const plan = getSuccess(resumeCompleteQueryEvaluationMaterial(
      started.resume,
      read,
    ));
    expect(plan._tag).toBe("write");
    if (plan._tag !== "write") throw new Error("Expected a write plan.");
    expect(plan.change.active.dependencyKeys).toEqual([dependency]);
    expect(plan.change.active.dependencyKeys).not.toBe(mutableDependencies);
    expect(
      plan.change.pendingPublication._tag === "replaceTargetPending"
        ? plan.change.pendingPublication.publication.content
        : null,
    ).toBe(capturedPublication.content);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.expected)).toBe(true);
    expect(Object.isFrozen(plan.expected.query)).toBe(true);
    expect(Object.isFrozen(plan.change)).toBe(true);
    expect(Object.isFrozen(plan.change.active)).toBe(true);
    expect(Object.isFrozen(plan.change.active.dependencyKeys)).toBe(true);
    expect(Object.isFrozen(plan.change.currentCompletion)).toBe(true);
    expect(Object.isFrozen(
      plan.change.currentCompletion.evaluationDependencyKeys,
    )).toBe(true);
    expect(Object.isFrozen(plan.receipt)).toBe(true);
    expect(read.activeDependencies).toBeNull();
    expect(read.completionDependencies).toBeNull();
  });

  it("accounts through the full oracle without reading equal-cost unrelated rows", () => {
    const targetDependency = canonicalText("d2:target:shared");
    const targetDescriptor = descriptor({
      keySeed: 71,
      identity: "d2-target-query",
    });
    const targetQuery = target({ descriptor: targetDescriptor });
    const buildScenario = (
      unrelatedKeySeed: number,
      unrelatedIdentity: string,
      unrelatedDependency: string,
      unrelatedPublication: string,
    ) => {
      const targetInstalled = installInitial({
        dependency: targetDependency,
        resultSeed: 271,
        publicationContent: "d2-target-initial",
        queryTarget: targetQuery,
      });
      const unrelatedTarget = target({
        descriptor: descriptor({
          keySeed: unrelatedKeySeed,
          identity: unrelatedIdentity,
        }),
      });
      const unrelatedInstalled = installInitial({
        state: targetInstalled.state,
        dependency: canonicalText(unrelatedDependency),
        resultSeed: 279,
        publicationContent: unrelatedPublication,
        queryTarget: unrelatedTarget,
      });
      return prepareRerun({
        state: unrelatedInstalled.state,
        dependency: targetDependency,
        sequence: 1n,
        resultSeed: 272,
        publicationContent: "d2-target-replacement",
        queryTarget: targetQuery,
      });
    };
    const left = buildScenario(
      72,
      "unrelated-alpha",
      "d2:other:alpha",
      "other-alpha",
    );
    const right = buildScenario(
      73,
      "unrelated-bravo",
      "d2:other:bravo",
      "other-bravo",
    );
    expect(left.state.metrics).toEqual(right.state.metrics);

    const leftAggregate = getSuccess(applyCompleteQueryEvaluationTransition(
      left.state,
      left.completion.attempt,
      left.completion.evaluation,
      left.completion.refresh,
      left.completion.publication,
    ));
    const rightAggregate = getSuccess(applyCompleteQueryEvaluationTransition(
      right.state,
      right.completion.attempt,
      right.completion.evaluation,
      right.completion.refresh,
      right.completion.publication,
    ));
    expect(leftAggregate.plan).toEqual(rightAggregate.plan);

    const conformance = expectCompletionConformance(
      left.state,
      left.completion,
    );
    expect(conformance.normalized.state.metrics).toEqual(
      conformance.normalized.plan._tag === "write"
        ? conformance.normalized.plan.nextScope.metrics
        : left.state.metrics,
    );
    const unrelatedBefore = left.state.queries.find((query) => (
      query.descriptor.queryKey !== targetDescriptor.queryKey
    ));
    const unrelatedAfter = conformance.normalized.state.queries.find(
      (query) => query.descriptor.queryKey !== targetDescriptor.queryKey,
    );
    expect(unrelatedAfter).toEqual(unrelatedBefore);
  });

  it("preserves authority and evidence error order ahead of query absence", () => {
    const empty = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = beginFirst(empty);
    const wrongDescriptor = descriptor({
      keySeed: 81,
      identity: "d2-wrong-descriptor",
    });
    const mismatchedEvaluation = evaluation({
      descriptor: wrongDescriptor,
      generation: begun.attempt.generation,
      snapshot: 0n,
    });
    const mismatchedRefresh = getSuccess(deriveGenerationRefreshEvidence(
      mismatchedEvaluation,
      begun.state.cursor,
      [],
      mismatchedEvaluation.authorityWitness,
    ));
    const evidenceBeforeAbsence = executeNormalizedCompleteQueryEvaluation(
      normalizeQuerySyncState(empty),
      begun.attempt,
      mismatchedEvaluation,
      mismatchedRefresh,
      publicationArtifact("d2-error-order"),
    );
    expect(Result.isFailure(evidenceBeforeAbsence)).toBe(true);
    if (Result.isFailure(evidenceBeforeAbsence)) {
      expect(evidenceBeforeAbsence.failure).toMatchObject({
        _tag: "InvalidQueryEvidenceError",
        reason: "attemptEvaluationDescriptorMismatch",
      });
    }

    const foreignEvaluation = evaluation({
      namespaceId: "tenant-b",
      descriptor: wrongDescriptor,
      generation: begun.attempt.generation,
      snapshot: 0n,
    });
    const foreignRefresh = getSuccess(deriveGenerationRefreshEvidence(
      foreignEvaluation,
      cursor({ namespaceId: "tenant-b" }),
      [],
      foreignEvaluation.authorityWitness,
    ));
    const authorityFirst = executeNormalizedCompleteQueryEvaluation(
      normalizeQuerySyncState(begun.state),
      begun.attempt,
      foreignEvaluation,
      foreignRefresh,
      publicationArtifact("d2-authority-first"),
    );
    expect(Result.isFailure(authorityFirst)).toBe(true);
    if (Result.isFailure(authorityFirst)) {
      expect(authorityFirst.failure).toMatchObject({
        _tag: "QuerySyncNamespaceMismatchError",
        operation: "completeQueryEvaluation",
      });
    }
  });
});
