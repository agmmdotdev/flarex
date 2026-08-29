import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  recordEvaluationAttemptOutcome,
} from "@flarex/query-sync/internal/kernel";
import type {
  EvaluationAttemptOutcome,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryState,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  applyRecordEvaluationAttemptOutcomeTransition,
} from "../src/kernel/TransitionPlanAggregate.js";
import {
  projectRecordEvaluationAttemptOutcomeReceipt,
} from "../src/state/Receipts.js";
import {
  executeNormalizedRecordEvaluationAttemptOutcome,
  normalizeQuerySyncState,
} from "../src/testing/conformance/NormalizedTransitionPlan.js";
import {
  planRecordEvaluationAttemptOutcome,
} from "../src/transition-plan/RecordEvaluationAttemptOutcome.js";
import type {
  EvaluationAttemptOutcomeQueryFacts,
} from "../src/transition-plan/RecordEvaluationAttemptOutcome.js";
import {
  projectActiveScalarFacts,
} from "../src/transition-plan/Facts.js";
import type {
  QuerySyncScopeFacts,
} from "../src/transition-plan/Model.js";

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
} from "./fixtures.js";

function getFailure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) throw new Error("Expected a failed Result");
  return result.failure;
}

function emptyState(): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor()));
}

function beginFor(
  state: QuerySyncState,
  queryDescriptor: QueryDescriptor,
): Readonly<{
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
}> {
  const decision = getSuccess(beginQueryEvaluation(
    state,
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  return Object.freeze({
    state: decision.state,
    attempt: getEvaluationAttempt(decision),
  });
}

function invalidate(
  state: QuerySyncState,
  dependency: string,
  sequence: bigint,
): QuerySyncState {
  const decision = getSuccess(applyAdmittedInvalidations(
    state,
    batch({ sequence, dependencies: [dependency] }),
  ));
  if (decision._tag !== "applied") {
    throw new Error(`Expected an applied invalidation, got ${decision._tag}`);
  }
  return decision.state;
}

function beginDirty(
  state: QuerySyncState,
  queryDescriptor: QueryDescriptor,
): Readonly<{
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
}> {
  const query = requireQuery(state, queryDescriptor.queryKey);
  const active = query.active;
  if (active === null || active.dirtyThroughSequence === null) {
    throw new Error("Expected a dirty active query");
  }
  const decision = getSuccess(beginQueryEvaluation(
    state,
    rerunEvaluationRequest({
      target: target({ descriptor: queryDescriptor }),
      activeGeneration: active.generation,
      dirtyThroughSequence: active.dirtyThroughSequence,
    }),
  ));
  return Object.freeze({
    state: decision.state,
    attempt: getEvaluationAttempt(decision),
  });
}

function completeAttempt(input: {
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
  readonly dependencies: readonly string[];
  readonly publicationContent: string;
}): QuerySyncState {
  const evidence = evaluation({
    descriptor: input.attempt.descriptor,
    generation: input.attempt.generation,
    snapshot: input.state.cursor.appliedThroughSequence,
    dependencies: input.dependencies,
    resultSeed: 80 + Number(input.attempt.generation),
    witnessSeed: 90 + Number(input.attempt.generation),
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    evidence,
    input.state.cursor,
    [],
    evidence.authorityWitness,
  ));
  const decision = getSuccess(completeQueryEvaluation(
    input.state,
    input.attempt,
    evidence,
    refresh,
    publicationArtifact(input.publicationContent),
  ));
  if (decision._tag !== "completed") {
    throw new Error(`Expected a completed evaluation, got ${decision._tag}`);
  }
  return decision.state;
}

function requireQuery(
  state: QuerySyncState,
  queryKey: QueryDescriptor["queryKey"],
): QueryState {
  const query = state.queries.find(
    (candidate) => candidate.descriptor.queryKey === queryKey,
  );
  if (query === undefined) throw new Error("Expected a retained query");
  return query;
}

function scopeFacts(state: QuerySyncState): QuerySyncScopeFacts {
  return {
    cursor: state.cursor,
    evaluationWork: state.evaluationWork,
    metrics: state.metrics,
  };
}

function outcomeQueryFacts(
  state: QuerySyncState,
  queryKey: QueryDescriptor["queryKey"],
): EvaluationAttemptOutcomeQueryFacts | null {
  const query = state.queries.find(
    (candidate) => candidate.descriptor.queryKey === queryKey,
  );
  if (query === undefined) return null;
  const completion = query.currentCompletion;
  return {
    descriptor: query.descriptor,
    active: query.active === null
      ? null
      : projectActiveScalarFacts(query.active),
    provisional: query.provisional,
    currentCompletion: completion === null
      ? null
      : {
        identity: completion.identity,
        queryIdentity: completion.queryIdentity,
        expectedActiveGeneration: completion.expectedActiveGeneration,
        registrationCursor: completion.registrationCursor,
        requestedDirtyThroughSequence:
          completion.requestedDirtyThroughSequence,
      },
    precedingCompletionIdentity: query.precedingCompletionIdentity,
  };
}

function expectOutcomeConformance(
  state: QuerySyncState,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
) {
  const direct = getSuccess(planRecordEvaluationAttemptOutcome({
    scope: scopeFacts(state),
    query: outcomeQueryFacts(state, attempt.descriptor.queryKey),
    attempt,
    outcome,
  }));
  const aggregate = getSuccess(
    applyRecordEvaluationAttemptOutcomeTransition(state, attempt, outcome),
  );
  const normalized = getSuccess(
    executeNormalizedRecordEvaluationAttemptOutcome(
      normalizeQuerySyncState(state),
      attempt,
      outcome,
    ),
  );
  const facade = getSuccess(recordEvaluationAttemptOutcome(
    state,
    attempt,
    outcome,
  ));

  expect(direct).toEqual(aggregate.plan);
  expect(normalized.plan).toEqual(aggregate.plan);
  expect(normalized.receipt).toEqual(
    projectRecordEvaluationAttemptOutcomeReceipt(aggregate.decision),
  );
  expect(normalized.receipt).toBe(normalized.plan.receipt);
  expect(aggregate.plan.receipt).toEqual(normalized.receipt);
  expect(normalized.disposition).toBe(aggregate.disposition);
  expect(normalized.state).toEqual(aggregate.decision.state);
  expect(facade).toEqual(aggregate.decision);

  return Object.freeze({ direct, aggregate, normalized, facade });
}

function throwingAttemptForgery(onRead: () => void): QueryEvaluationAttempt {
  return new Proxy({}, {
    get: () => {
      onRead();
      throw new Error("Unauthenticated attempt field was read");
    },
  }) as unknown as QueryEvaluationAttempt;
}

describe("QSYNC01-D3 evaluation-attempt outcome transition plans", () => {
  it("authenticates the nominal attempt before any field read", () => {
    const begun = beginFor(emptyState(), descriptor());
    let fieldReads = 0;
    const forgery = throwingAttemptForgery(() => {
      fieldReads += 1;
    });

    const directFailure = getFailure(planRecordEvaluationAttemptOutcome({
      scope: scopeFacts(begun.state),
      query: outcomeQueryFacts(
        begun.state,
        begun.attempt.descriptor.queryKey,
      ),
      attempt: forgery,
      outcome: "transientExhausted",
    }));
    const aggregateFailure = getFailure(
      applyRecordEvaluationAttemptOutcomeTransition(
        begun.state,
        forgery,
        "terminalRefusal",
      ),
    );

    for (const failure of [directFailure, aggregateFailure]) {
      expect(failure).toMatchObject({
        _tag: "InvalidEvaluationAttemptError",
        operation: "recordEvaluationAttemptOutcome",
        reason: "notStateIssued",
        queryKey: "",
        generation: 0n,
      });
    }
    expect(fieldReads).toBe(0);
  });

  it("conforms for eligible, first block, and both exact blocked replays", () => {
    const firstDescriptor = descriptor({ keySeed: 10, identity: "first" });
    const secondDescriptor = descriptor({ keySeed: 20, identity: "second" });
    const first = beginFor(emptyState(), firstDescriptor);
    const second = beginFor(first.state, secondDescriptor);
    const before = second.state;

    const eligible = expectOutcomeConformance(
      before,
      first.attempt,
      "transientExhausted",
    );
    expect(eligible.aggregate.disposition).toBe("noWrite");
    expect(eligible.aggregate.decision.state).toBe(before);
    expect(Object.keys(eligible.direct)).toEqual(["_tag", "receipt"]);
    expect(Object.keys(eligible.direct.receipt)).toEqual([
      "_tag",
      "queryKey",
      "generation",
    ]);
    expect(eligible.direct.receipt).toEqual({
      _tag: "eligible",
      queryKey: firstDescriptor.queryKey,
      generation: 1n,
    });
    expect(Object.isFrozen(eligible.direct)).toBe(true);
    expect(Object.isFrozen(eligible.direct.receipt)).toBe(true);

    const terminal = expectOutcomeConformance(
      before,
      first.attempt,
      "terminalRefusal",
    );
    expect(terminal.aggregate.disposition).toBe("write");
    const plan = terminal.aggregate.plan;
    const decision = terminal.aggregate.decision;
    if (
      plan._tag !== "write"
      || plan.receipt._tag !== "blocked"
      || decision._tag !== "blocked"
    ) {
      throw new Error("Expected the first terminal outcome to write a block");
    }

    expect(Object.keys(plan)).toEqual([
      "_tag",
      "receipt",
      "expected",
      "nextScope",
      "change",
    ]);
    expect(Object.keys(plan.receipt)).toEqual(["_tag", "blockedWork"]);
    expect(Object.keys(plan.receipt.blockedWork)).toEqual([
      "queryKey",
      "generation",
      "reason",
      "resetRequired",
    ]);
    expect(Object.keys(plan.expected)).toEqual(["scope", "query"]);
    expect(Object.keys(plan.change)).toEqual([
      "_tag",
      "queryKey",
      "provisional",
    ]);
    expect(Object.keys(decision)).toEqual(["_tag", "state", "blockedWork"]);
    expect(decision.blockedWork).toBe(plan.receipt.blockedWork);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.receipt)).toBe(true);
    expect(Object.isFrozen(plan.receipt.blockedWork)).toBe(true);
    expect(Object.isFrozen(plan.expected)).toBe(true);
    expect(Object.isFrozen(plan.expected.scope)).toBe(true);
    expect(Object.isFrozen(plan.expected.query)).toBe(true);
    expect(Object.isFrozen(plan.change)).toBe(true);
    expect(Object.isFrozen(plan.change.provisional)).toBe(true);
    expect(Object.isFrozen(plan.change.provisional.evaluationDisposition))
      .toBe(true);

    const after = decision.state;
    expect(after.evaluationWork).toEqual({
      revision: before.evaluationWork.revision + 1n,
      fairnessAnchor: before.evaluationWork.fairnessAnchor,
    });
    expect(after.metrics).toEqual({
      ...before.metrics,
      countedCanonicalBytes: before.metrics.countedCanonicalBytes + 2,
    });
    expect(after.cursor).toEqual(before.cursor);
    expect(after.publicationWork).toEqual(before.publicationWork);
    expect(after.dependencyDirectory).toEqual(before.dependencyDirectory);
    expect(after.queries.map((query) => query.descriptor.queryKey)).toEqual(
      before.queries.map((query) => query.descriptor.queryKey),
    );
    expect(requireQuery(after, secondDescriptor.queryKey)).toEqual(
      requireQuery(before, secondDescriptor.queryKey),
    );
    expect(requireQuery(before, firstDescriptor.queryKey).provisional)
      .toMatchObject({ evaluationDisposition: { _tag: "ready" } });
    expect(requireQuery(after, firstDescriptor.queryKey).provisional)
      .toMatchObject({
        evaluationDisposition: {
          _tag: "blocked",
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      });

    for (const replayOutcome of [
      "terminalRefusal",
      "transientExhausted",
    ] as const) {
      const replay = expectOutcomeConformance(
        after,
        first.attempt,
        replayOutcome,
      );
      expect(replay.aggregate.disposition).toBe("noWrite");
      expect(replay.aggregate.decision.state).toBe(after);
      expect(replay.aggregate.plan).toEqual({
        _tag: "noWrite",
        receipt: plan.receipt,
      });
      expect(Object.isFrozen(replay.aggregate.plan)).toBe(true);
      expect(Object.isFrozen(replay.aggregate.plan.receipt)).toBe(true);
    }
  });

  it("conforms for current, preceding, and expired recovery evidence", () => {
    const dependency = canonicalText("d3-outcome-history");
    const queryDescriptor = descriptor({ keySeed: 30, identity: "history" });
    const generationOne = beginFor(emptyState(), queryDescriptor);
    let state = completeAttempt({
      state: generationOne.state,
      attempt: generationOne.attempt,
      dependencies: [dependency],
      publicationContent: "d3-generation-one",
    });

    const current = expectOutcomeConformance(
      state,
      generationOne.attempt,
      "terminalRefusal",
    );
    expect(current.aggregate.disposition).toBe("noWrite");
    expect(current.aggregate.decision).toMatchObject({
      _tag: "superseded",
      state,
      queryKey: queryDescriptor.queryKey,
      generation: 1n,
      activeGeneration: 1n,
    });

    state = invalidate(state, dependency, 1n);
    const generationTwo = beginDirty(state, queryDescriptor);
    state = completeAttempt({
      state: generationTwo.state,
      attempt: generationTwo.attempt,
      dependencies: [dependency],
      publicationContent: "d3-generation-two",
    });
    const preceding = expectOutcomeConformance(
      state,
      generationOne.attempt,
      "transientExhausted",
    );
    expect(preceding.aggregate.disposition).toBe("noWrite");
    expect(preceding.aggregate.decision).toMatchObject({
      _tag: "superseded",
      state,
      generation: 1n,
      activeGeneration: 2n,
    });

    state = invalidate(state, dependency, 2n);
    const generationThree = beginDirty(state, queryDescriptor);
    state = completeAttempt({
      state: generationThree.state,
      attempt: generationThree.attempt,
      dependencies: [dependency],
      publicationContent: "d3-generation-three",
    });
    const expired = expectOutcomeConformance(
      state,
      generationOne.attempt,
      "terminalRefusal",
    );
    expect(expired.aggregate.disposition).toBe("noWrite");
    expect(expired.aggregate.decision).toMatchObject({
      _tag: "recoveryEvidenceExpired",
      state,
      generation: 1n,
      activeGeneration: 3n,
    });
    expect(Object.keys(expired.aggregate.plan.receipt)).toEqual([
      "_tag",
      "queryKey",
      "generation",
      "activeGeneration",
    ]);
    expect(Object.isFrozen(expired.aggregate.plan.receipt)).toBe(true);
  });
});
