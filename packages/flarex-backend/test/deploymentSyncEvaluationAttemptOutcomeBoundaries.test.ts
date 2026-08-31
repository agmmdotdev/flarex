import {
  captureQueryDescriptor,
  captureQueryGeneration,
  captureSyncEpoch,
  captureSyncModelId,
  captureSyncNamespaceId,
  captureSyncSequence,
  type InvalidEvaluationAttemptError,
  type QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Encoding, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  ATTEMPT_OUTCOME_COMMON_READ_STAGES,
  type AttemptOutcomeFixture,
  type AttemptOutcomeSqlStage,
  makeAttemptOutcomeSqlProbe,
  prepareCompletedAttemptOutcomeFixture,
  prepareReadyAttemptOutcomeFixture,
  recordEvaluationOutcome,
  reissueEvaluationAttemptForTesting,
} from "./deploymentSyncEvaluationAttemptOutcomeTestSupport";
import {
  beginEvaluation,
  canonicalKey,
  prepareEvaluationState,
  queryDescriptor,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const foreignNamespaceId = success(captureSyncNamespaceId(
  "attempt-outcome-boundary-foreign-namespace",
));
const foreignSyncModelId = success(captureSyncModelId(
  "attempt-outcome-boundary-foreign-model",
));
const foreignSourceEpoch = success(captureSyncEpoch(
  "attempt-outcome-boundary-foreign-epoch",
));
const generationTwo = success(captureQueryGeneration(2n));
const generationThree = success(captureQueryGeneration(3n));

interface MutableAttemptOutcomeCall {
  attempt: QueryEvaluationAttempt;
}

interface AttemptOutcomeBoundaryFixture extends AttemptOutcomeFixture {
  readonly call: MutableAttemptOutcomeCall;
}

interface AttemptOutcomeFailureScenario {
  readonly name: string;
  readonly prepare?: () => Promise<AttemptOutcomeBoundaryFixture>;
  readonly arrange: (
    fixture: AttemptOutcomeBoundaryFixture,
  ) => void | Promise<void>;
  readonly expected: (
    fixture: AttemptOutcomeBoundaryFixture,
  ) => Readonly<Record<string, unknown>>;
  readonly stages?: readonly AttemptOutcomeSqlStage[];
}

const authorityScenarios: readonly AttemptOutcomeFailureScenario[] = [
  {
    name: "attempt namespace authority mismatch",
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { namespaceId: foreignNamespaceId },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QuerySyncNamespaceMismatchError",
      operation: "recordEvaluationAttemptOutcome",
      expectedNamespaceId: fixture.prepared.binding.namespaceId,
      observedNamespaceId: foreignNamespaceId,
    }),
  },
  {
    name: "attempt model authority mismatch",
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { syncModelId: foreignSyncModelId },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QuerySyncModelMismatchError",
      operation: "recordEvaluationAttemptOutcome",
      expectedSyncModelId: fixture.prepared.binding.syncModelId,
      observedSyncModelId: foreignSyncModelId,
    }),
  },
  {
    name: "attempt epoch authority mismatch",
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { sourceEpoch: foreignSourceEpoch },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QuerySyncEpochMismatchError",
      operation: "recordEvaluationAttemptOutcome",
      expectedSourceEpoch: fixture.prepared.binding.sourceEpoch,
      observedSourceEpoch: foreignSourceEpoch,
      resetRequired: true,
    }),
  },
];

const queryStateScenarios: readonly AttemptOutcomeFailureScenario[] = [
  {
    name: "missing query state",
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      const descriptor = success(captureQueryDescriptor({
        queryKey: canonicalKey(231),
        queryIdentity: fixture.call.attempt.descriptor.queryIdentity,
      }));
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { descriptor },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QueryStateNotFoundError",
      operation: "recordEvaluationAttemptOutcome",
      queryKey: fixture.call.attempt.descriptor.queryKey,
    }),
  },
  {
    name: "same-key query identity collision",
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      const descriptor = success(captureQueryDescriptor({
        queryKey: fixture.call.attempt.descriptor.queryKey,
        queryIdentity: Encoding.encodeBase64Url(
          "attempt-outcome-boundary-collision",
        ),
      }));
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { descriptor },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QueryKeyCollisionError",
      operation: "recordEvaluationAttemptOutcome",
      queryKey: fixture.call.attempt.descriptor.queryKey,
    }),
  },
  {
    name: "future generation against provisional-only state",
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { generation: generationTwo },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QueryGenerationMismatchError",
      operation: "recordEvaluationAttemptOutcome",
      queryKey: fixture.call.attempt.descriptor.queryKey,
      expectedGeneration: 1n,
      observedGeneration: generationTwo,
    }),
  },
  {
    name: "future generation against active-plus-provisional state",
    prepare: prepareActiveProvisionalBoundaryFixture,
    arrange: (fixture: AttemptOutcomeBoundaryFixture) => {
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        { generation: generationThree },
      );
    },
    expected: (fixture: AttemptOutcomeBoundaryFixture) => ({
      _tag: "QueryGenerationMismatchError",
      operation: "recordEvaluationAttemptOutcome",
      queryKey: fixture.call.attempt.descriptor.queryKey,
      expectedGeneration: generationTwo,
      observedGeneration: generationThree,
    }),
  },
];

const mismatchScenarios: readonly AttemptOutcomeFailureScenario[] = [
  ...attemptMismatchScenarios(
    "live provisional",
    prepareBoundaryFixture,
  ),
  ...attemptMismatchScenarios(
    "blocked provisional",
    prepareBlockedBoundaryFixture,
  ),
  ...attemptMismatchScenarios(
    "current completion",
    prepareCompletedBoundaryFixture,
  ),
];

const scenarios: readonly AttemptOutcomeFailureScenario[] = [
  ...authorityScenarios,
  ...queryStateScenarios,
  ...mismatchScenarios,
];

describe("deployment query-sync attempt-outcome typed boundaries", () => {
  it.each(scenarios)("rejects $name without writes", async scenario => {
    const fixture = await (scenario.prepare?.() ?? prepareBoundaryFixture());
    try {
      await scenario.arrange(fixture);
      const before = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.start();

      const exit = await Effect.runPromiseExit(
        fixture.prepared.state.recordEvaluationAttemptOutcome(
          fixture.call.attempt,
          "terminalRefusal",
        ),
      );

      expectTypedFailure(exit, scenario.expected(fixture));
      expect(fixture.probe.stop()).toEqual(
        scenario.stages ?? ATTEMPT_OUTCOME_COMMON_READ_STAGES,
      );
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        before,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });
});

function attemptMismatchScenarios(
  phase: string,
  prepare: () => Promise<AttemptOutcomeBoundaryFixture>,
): readonly AttemptOutcomeFailureScenario[] {
  return [
    attemptMismatchScenario(
      `${phase} expected-active fence mismatch`,
      prepare,
      (attempt) => ({ expectedActiveGeneration: attempt.generation }),
      "expectedActiveMismatch",
    ),
    attemptMismatchScenario(
      `${phase} registration cursor mismatch`,
      prepare,
      (attempt) => ({
        registrationCursor: {
          ...attempt.registrationCursor,
          appliedThroughSequence: differentSequence(
            attempt.registrationCursor.appliedThroughSequence,
          ),
        },
      }),
      "registrationCursorMismatch",
    ),
    attemptMismatchScenario(
      `${phase} requested dirty frontier mismatch`,
      prepare,
      (attempt) => ({
        requestedDirtyThroughSequence:
          attempt.registrationCursor.appliedThroughSequence,
      }),
      "requestedDirtyFrontierMismatch",
    ),
  ];
}

function attemptMismatchScenario(
  name: string,
  prepare: () => Promise<AttemptOutcomeBoundaryFixture>,
  overrides: (
    attempt: QueryEvaluationAttempt,
  ) => Parameters<typeof reissueEvaluationAttemptForTesting>[1],
  reason: Exclude<
    InvalidEvaluationAttemptError["reason"],
    "notStateIssued" | "descriptorMismatch" | "generationMismatch"
  >,
): AttemptOutcomeFailureScenario {
  return {
    name,
    prepare,
    arrange: (fixture) => {
      fixture.call.attempt = reissueEvaluationAttemptForTesting(
        fixture.call.attempt,
        overrides(fixture.call.attempt),
      );
    },
    expected: (fixture) => ({
      _tag: "InvalidEvaluationAttemptError",
      operation: "recordEvaluationAttemptOutcome",
      reason,
      queryKey: fixture.call.attempt.descriptor.queryKey,
      generation: fixture.call.attempt.generation,
    }),
  };
}

async function prepareBoundaryFixture(): Promise<
  AttemptOutcomeBoundaryFixture
> {
  return withMutableCall(await prepareReadyAttemptOutcomeFixture(331));
}

async function prepareCompletedBoundaryFixture(): Promise<
  AttemptOutcomeBoundaryFixture
> {
  return withMutableCall(await prepareCompletedAttemptOutcomeFixture(332));
}

async function prepareBlockedBoundaryFixture(): Promise<
  AttemptOutcomeBoundaryFixture
> {
  const fixture = await prepareReadyAttemptOutcomeFixture(333);
  await recordEvaluationOutcome(
    fixture.prepared,
    fixture.attempt,
    "terminalRefusal",
  );
  return withMutableCall(fixture);
}

async function prepareActiveProvisionalBoundaryFixture(): Promise<
  AttemptOutcomeBoundaryFixture
> {
  const probe = makeAttemptOutcomeSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(334);
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  const completion = await completeEvaluation(
    prepared,
    firstAttempt,
    makeCompletionEvidence(prepared, firstAttempt, {
      dependencyLabels: ["attempt-outcome-generation"],
    }),
  );
  if (completion._tag !== "completed") {
    prepared.database.close();
    throw new Error(`Expected completed evaluation, received ${completion._tag}.`);
  }
  const invalidation = captureCompletionBatch(
    prepared.binding,
    12n,
    ["attempt-outcome-generation"],
  );
  await applyCompletionBatch(prepared, invalidation);
  const attempt = await beginEvaluation(prepared, descriptor, {
    expectedActiveGeneration: firstAttempt.generation,
    requestedDirtyThroughSequence: invalidation.sourceSequence,
  });
  return withMutableCall(Object.freeze({
    prepared,
    probe,
    descriptor,
    attempt,
  }));
}

function withMutableCall(
  fixture: AttemptOutcomeFixture,
): AttemptOutcomeBoundaryFixture {
  return Object.freeze({
    ...fixture,
    call: { attempt: fixture.attempt },
  });
}

function differentSequence(current: bigint) {
  return success(captureSyncSequence(current === 0n ? 1n : current - 1n));
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}
