import {
  captureQueryDescriptor,
  captureQueryGeneration,
  captureSyncEpoch,
  captureSyncModelId,
  captureSyncNamespaceId,
  captureSyncSequence,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_QUERY_SYNC_WORK_REVISION,
  type InvalidQueryEvidenceError,
  type QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import {
  makeQueryEvaluationAttemptForTesting,
} from "@flarex/query-sync/testing/conformance";
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
  beginRequest,
  canonicalKey,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const MATERIAL_READ_STAGES = Object.freeze([
  ...COMPLETION_COMMON_READ_STAGES,
  "active-dependencies-read",
  "completion-dependencies-read",
  "pending-publication-read",
  "in-flight-publication-read",
  "publication-state-read",
] as const satisfies readonly CompletionSqlStage[]);

const foreignNamespaceId = success(captureSyncNamespaceId(
  "completion-boundary-foreign-namespace",
));
const foreignSyncModelId = success(captureSyncModelId(
  "completion-boundary-foreign-model",
));
const foreignSourceEpoch = success(captureSyncEpoch(
  "completion-boundary-foreign-epoch",
));
const generationTwo = success(captureQueryGeneration(2n));
const sequenceEleven = success(captureSyncSequence(11n));

type QueryEvaluationAttemptInput = Parameters<
  typeof makeQueryEvaluationAttemptForTesting
>[0];

interface MutableCompletionCall {
  attempt: QueryEvaluationAttempt;
  input: CompletionEvidenceInput;
}

interface CompletionBoundaryFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: CompletionSqlProbe;
  readonly call: MutableCompletionCall;
}

interface CompletionFailureScenario {
  readonly name: string;
  readonly prepare?: () => Promise<CompletionBoundaryFixture>;
  readonly arrange?: (
    fixture: CompletionBoundaryFixture,
  ) => void | Promise<void>;
  readonly expected: (
    fixture: CompletionBoundaryFixture,
  ) => Readonly<Record<string, unknown>>;
  readonly stages?: readonly CompletionSqlStage[];
}

const authorityScenarios = [
  {
    name: "attempt namespace authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      reissueAttempt(fixture.call, "namespaceId", foreignNamespaceId);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncNamespaceMismatchError",
      operation: "completeQueryEvaluation",
      expectedNamespaceId: fixture.prepared.binding.namespaceId,
      observedNamespaceId: foreignNamespaceId,
    }),
  },
  {
    name: "attempt model authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      reissueAttempt(fixture.call, "syncModelId", foreignSyncModelId);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncModelMismatchError",
      operation: "completeQueryEvaluation",
      expectedSyncModelId: fixture.prepared.binding.syncModelId,
      observedSyncModelId: foreignSyncModelId,
    }),
  },
  {
    name: "attempt epoch authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      reissueAttempt(fixture.call, "sourceEpoch", foreignSourceEpoch);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncEpochMismatchError",
      operation: "completeQueryEvaluation",
      expectedSourceEpoch: fixture.prepared.binding.sourceEpoch,
      observedSourceEpoch: foreignSourceEpoch,
      resetRequired: true,
    }),
  },
  {
    name: "evaluation namespace authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(
        fixture.call.input.evaluation,
        "namespaceId",
        foreignNamespaceId,
      );
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncNamespaceMismatchError",
      operation: "completeQueryEvaluation",
      expectedNamespaceId: fixture.prepared.binding.namespaceId,
      observedNamespaceId: foreignNamespaceId,
    }),
  },
  {
    name: "evaluation model authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.evaluation, "syncModelId", foreignSyncModelId);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncModelMismatchError",
      operation: "completeQueryEvaluation",
      expectedSyncModelId: fixture.prepared.binding.syncModelId,
      observedSyncModelId: foreignSyncModelId,
    }),
  },
  {
    name: "evaluation epoch authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.evaluation, "sourceEpoch", foreignSourceEpoch);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncEpochMismatchError",
      operation: "completeQueryEvaluation",
      expectedSourceEpoch: fixture.prepared.binding.sourceEpoch,
      observedSourceEpoch: foreignSourceEpoch,
      resetRequired: true,
    }),
  },
  {
    name: "refresh namespace authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.refresh, "namespaceId", foreignNamespaceId);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncNamespaceMismatchError",
      operation: "completeQueryEvaluation",
      expectedNamespaceId: fixture.prepared.binding.namespaceId,
      observedNamespaceId: foreignNamespaceId,
    }),
  },
  {
    name: "refresh model authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.refresh, "syncModelId", foreignSyncModelId);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncModelMismatchError",
      operation: "completeQueryEvaluation",
      expectedSyncModelId: fixture.prepared.binding.syncModelId,
      observedSyncModelId: foreignSyncModelId,
    }),
  },
  {
    name: "refresh epoch authority mismatch",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.refresh, "sourceEpoch", foreignSourceEpoch);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QuerySyncEpochMismatchError",
      operation: "completeQueryEvaluation",
      expectedSourceEpoch: fixture.prepared.binding.sourceEpoch,
      observedSourceEpoch: foreignSourceEpoch,
      resetRequired: true,
    }),
  },
] as const satisfies readonly CompletionFailureScenario[];

const evidenceScenarios = [
  evidenceScenario("attempt/evaluation descriptor mismatch", (
    fixture,
  ) => {
    const alternate = queryDescriptor(302);
    setOwned(fixture.call.input.evaluation, "descriptor", alternate);
    setOwned(fixture.call.input.refresh, "descriptor", alternate);
  }, "attemptEvaluationDescriptorMismatch"),
  evidenceScenario("attempt/evaluation generation mismatch", fixture => {
    setOwned(fixture.call.input.evaluation, "generation", generationTwo);
    setOwned(fixture.call.input.refresh, "generation", generationTwo);
  }, "attemptEvaluationGenerationMismatch"),
  evidenceScenario("evaluation/refresh descriptor mismatch", fixture => {
    setOwned(fixture.call.input.refresh, "descriptor", queryDescriptor(303));
  }, "evaluationRefreshDescriptorMismatch"),
  evidenceScenario("evaluation/refresh generation mismatch", fixture => {
    setOwned(fixture.call.input.refresh, "generation", generationTwo);
  }, "evaluationRefreshGenerationMismatch"),
  evidenceScenario("evaluation/refresh snapshot mismatch", fixture => {
    setOwned(fixture.call.input.refresh, "evaluationSnapshotSequence", 12n);
  }, "evaluationRefreshSnapshotMismatch"),
  evidenceScenario("attempt expected-active mismatch", fixture => {
    reissueAttempt(
      fixture.call,
      "expectedActiveGeneration",
      fixture.call.attempt.generation,
    );
  }, "attemptExpectedActiveMismatch"),
  evidenceScenario("attempt registration cursor mismatch", fixture => {
    const cursor = structuredClone(fixture.call.attempt.registrationCursor);
    setOwned(cursor, "appliedThroughSequence", 10n);
    reissueAttempt(fixture.call, "registrationCursor", cursor);
  }, "attemptRegistrationCursorMismatch"),
  evidenceScenario("attempt dirty frontier mismatch", fixture => {
    reissueAttempt(
      fixture.call,
      "requestedDirtyThroughSequence",
      sequenceEleven,
    );
  }, "attemptDirtyFrontierMismatch"),
  evidenceScenario("snapshot before registration", fixture => {
    setOwned(fixture.call.input.evaluation, "snapshotSequence", 10n);
    setOwned(fixture.call.input.refresh, "evaluationSnapshotSequence", 10n);
  }, "snapshotBeforeRegistration"),
  {
    ...evidenceScenario(
      "snapshot before requested dirty frontier",
      () => undefined,
      "snapshotBeforeRequestedDirtyFrontier",
    ),
    prepare: prepareDirtyFrontierFixture,
  },
  evidenceScenario("snapshot after refresh", fixture => {
    setOwned(fixture.call.input.evaluation, "snapshotSequence", 12n);
    setOwned(fixture.call.input.refresh, "evaluationSnapshotSequence", 12n);
  }, "snapshotAfterRefresh"),
  evidenceScenario("refresh ahead of cursor", fixture => {
    setOwned(fixture.call.input.refresh, "refreshedThroughSequence", 12n);
  }, "refreshAheadOfCursor"),
  evidenceScenario("relevant sequence not after snapshot", fixture => {
    setOwned(fixture.call.input.refresh, "relevantThroughSequence", 11n);
  }, "relevantNotAfterSnapshot"),
  evidenceScenario("relevant sequence after refresh", fixture => {
    setOwned(fixture.call.input.refresh, "relevantThroughSequence", 12n);
  }, "relevantAfterRefresh"),
] as const satisfies readonly CompletionFailureScenario[];

const otherStartScenarios = [
  {
    name: "invalid publication content type",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.publication, "content", 42);
    },
    expected: () => ({
      _tag: "QuerySyncCanonicalValueError",
      field: "publicationContent",
      reason: "invalidType",
      maximum: null,
      observed: null,
    }),
  },
  {
    name: "invalid publication syntax",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.publication, "content", "***");
    },
    expected: () => ({
      _tag: "QuerySyncCanonicalValueError",
      field: "publicationContent",
      reason: "invalidSyntax",
      maximum: null,
      observed: null,
    }),
  },
  {
    name: "noncanonical publication content",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(fixture.call.input.publication, "content", "AB");
    },
    expected: () => ({
      _tag: "QuerySyncCanonicalValueError",
      field: "publicationContent",
      reason: "nonCanonical",
      maximum: null,
      observed: null,
    }),
  },
  {
    name: "oversized publication content",
    arrange: (fixture: CompletionBoundaryFixture) => {
      setOwned(
        fixture.call.input.publication,
        "content",
        Encoding.encodeBase64Url(
          new Uint8Array(MAX_INLINE_PUBLICATION_CONTENT_BYTES + 1),
        ),
      );
    },
    expected: () => ({
      _tag: "QuerySyncCanonicalValueError",
      field: "publicationContent",
      reason: "tooLarge",
      maximum: MAX_INLINE_PUBLICATION_CONTENT_BYTES,
      observed: MAX_INLINE_PUBLICATION_CONTENT_BYTES + 1,
    }),
  },
  {
    name: "missing query state",
    arrange: (fixture: CompletionBoundaryFixture) => {
      replaceCallDescriptor(fixture.call, queryDescriptor(304));
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QueryStateNotFoundError",
      operation: "completeQueryEvaluation",
      queryKey: fixture.call.attempt.descriptor.queryKey,
    }),
  },
  {
    name: "same-key query identity collision",
    arrange: (fixture: CompletionBoundaryFixture) => {
      const descriptor = success(captureQueryDescriptor({
        queryKey: fixture.call.attempt.descriptor.queryKey,
        queryIdentity: Encoding.encodeBase64Url(
          "completion-boundary-collision",
        ),
      }));
      replaceCallDescriptor(fixture.call, descriptor);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QueryKeyCollisionError",
      operation: "completeQueryEvaluation",
      queryKey: fixture.call.attempt.descriptor.queryKey,
    }),
  },
  {
    name: "future provisional generation",
    arrange: (fixture: CompletionBoundaryFixture) => {
      reissueAttempt(fixture.call, "generation", generationTwo);
      setOwned(fixture.call.input.evaluation, "generation", generationTwo);
      setOwned(fixture.call.input.refresh, "generation", generationTwo);
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QueryGenerationMismatchError",
      operation: "completeQueryEvaluation",
      queryKey: fixture.call.attempt.descriptor.queryKey,
      expectedGeneration: 1n,
      observedGeneration: generationTwo,
    }),
  },
  {
    name: "blocked provisional evaluation",
    arrange: async (fixture: CompletionBoundaryFixture) => {
      await Effect.runPromise(
        fixture.prepared.state.recordEvaluationAttemptOutcome(
          fixture.call.attempt,
          "terminalRefusal",
        ),
      );
    },
    expected: (fixture: CompletionBoundaryFixture) => ({
      _tag: "QueryEvaluationWorkBlockedError",
      operation: "completeQueryEvaluation",
      queryKey: fixture.call.attempt.descriptor.queryKey,
      generation: fixture.call.attempt.generation,
      reason: "terminalEvaluatorRefusal",
      resetRequired: true,
    }),
  },
] as const satisfies readonly CompletionFailureScenario[];

const materialScenarios = [
  {
    name: "completion work revision exhaustion",
    arrange: (fixture: CompletionBoundaryFixture) => {
      fixture.prepared.database.prepare(`UPDATE deployment_sync_scope_state
        SET evaluation_work_revision = ?`).run(
        MAX_QUERY_SYNC_WORK_REVISION.toString(),
      );
    },
    expected: () => ({
      _tag: "QuerySyncWorkRevisionExhaustedError",
      operation: "completeQueryEvaluation",
      currentRevision: MAX_QUERY_SYNC_WORK_REVISION,
    }),
    stages: MATERIAL_READ_STAGES,
  },
] as const satisfies readonly CompletionFailureScenario[];

const scenarios: readonly CompletionFailureScenario[] = [
  ...authorityScenarios,
  ...evidenceScenarios,
  ...otherStartScenarios,
  ...materialScenarios,
];

describe("deployment query-sync completion typed boundaries", () => {
  it.each(scenarios)("rejects $name without writes", async scenario => {
    const fixture = await (scenario.prepare?.() ?? prepareBoundaryFixture());
    try {
      await scenario.arrange?.(fixture);
      const before = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.start();

      const exit = await runCompletionExit(fixture);

      expectTypedFailure(exit, scenario.expected(fixture));
      expect(fixture.probe.stop()).toEqual(
        scenario.stages ?? COMPLETION_COMMON_READ_STAGES,
      );
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(before);
    } finally {
      fixture.prepared.database.close();
    }
  }, 30_000);
});

function evidenceScenario(
  name: string,
  arrange: (fixture: CompletionBoundaryFixture) => void,
  reason: InvalidQueryEvidenceError["reason"],
): CompletionFailureScenario {
  return {
    name,
    arrange,
    expected: () => ({
      _tag: "InvalidQueryEvidenceError",
      operation: "completeQueryEvaluation",
      reason,
    }),
  };
}

async function prepareBoundaryFixture(): Promise<CompletionBoundaryFixture> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const attempt = await beginEvaluation(prepared, queryDescriptor(301));
  return Object.freeze({
    prepared,
    probe,
    call: ownCompletionCall(
      attempt,
      makeCompletionEvidence(prepared, attempt),
    ),
  });
}

async function prepareDirtyFrontierFixture(): Promise<
  CompletionBoundaryFixture
> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(305);
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  await completeEvaluation(
    prepared,
    firstAttempt,
    makeCompletionEvidence(prepared, firstAttempt, {
      dependencyLabels: ["dirty-frontier"],
    }),
  );
  const firstBatch = captureCompletionBatch(
    prepared.binding,
    12n,
    ["dirty-frontier"],
  );
  await applyCompletionBatch(prepared, firstBatch);
  await beginEvaluation(prepared, descriptor, {
    expectedActiveGeneration: firstAttempt.generation,
    requestedDirtyThroughSequence: firstBatch.sourceSequence,
  });
  const secondBatch = captureCompletionBatch(
    prepared.binding,
    13n,
    ["dirty-frontier"],
  );
  await applyCompletionBatch(prepared, secondBatch);
  const receipt = await Effect.runPromise(prepared.state.beginQueryEvaluation(
    beginRequest(prepared.binding, descriptor, {
      expectedActiveGeneration: firstAttempt.generation,
      requestedDirtyThroughSequence: secondBatch.sourceSequence,
    }),
  ));
  if (receipt._tag !== "replayed") {
    prepared.database.close();
    throw new Error(`Expected replayed evaluation, received ${receipt._tag}.`);
  }
  return Object.freeze({
    prepared,
    probe,
    call: ownCompletionCall(
      receipt.attempt,
      makeCompletionEvidence(prepared, receipt.attempt),
    ),
  });
}

function ownCompletionCall(
  attempt: QueryEvaluationAttempt,
  input: CompletionEvidenceInput,
): MutableCompletionCall {
  // The relation tests need owned copies of captured frozen inputs so that each
  // case can cross exactly one boundary without mutating a shared value.
  return {
    attempt,
    input: {
      evaluation: structuredClone(input.evaluation),
      refresh: structuredClone(input.refresh),
      publication: structuredClone(input.publication),
    },
  };
}

function replaceCallDescriptor(
  call: MutableCompletionCall,
  descriptor: QueryEvaluationAttempt["descriptor"],
): void {
  reissueAttempt(call, "descriptor", descriptor);
  setOwned(call.input.evaluation, "descriptor", descriptor);
  setOwned(call.input.refresh, "descriptor", descriptor);
}

function reissueAttempt<Property extends keyof QueryEvaluationAttemptInput>(
  call: MutableCompletionCall,
  property: Property,
  value: QueryEvaluationAttemptInput[Property],
): void {
  const input = {
    namespaceId: call.attempt.namespaceId,
    syncModelId: call.attempt.syncModelId,
    sourceEpoch: call.attempt.sourceEpoch,
    descriptor: { ...call.attempt.descriptor },
    generation: call.attempt.generation,
    expectedActiveGeneration: call.attempt.expectedActiveGeneration,
    registrationCursor: { ...call.attempt.registrationCursor },
    requestedDirtyThroughSequence:
      call.attempt.requestedDirtyThroughSequence,
  };
  setOwned(input, property, value);
  call.attempt = makeQueryEvaluationAttemptForTesting(input);
}

function setOwned(target: object, property: string, value: unknown): void {
  if (!Reflect.set(target, property, value)) {
    throw new Error(`Could not set owned completion field ${property}.`);
  }
}

function runCompletionExit(fixture: CompletionBoundaryFixture) {
  return Effect.runPromiseExit(fixture.prepared.state.completeQueryEvaluation(
    fixture.call.attempt,
    fixture.call.input.evaluation,
    fixture.call.input.refresh,
    fixture.call.input.publication,
  ));
}

function expectTypedFailure(
  exit: Exit.Exit<unknown, unknown>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}
