import type {
  EvaluationAttemptOutcome,
  QueryDescriptor,
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeploymentQuerySyncAdapterInvariantDefect,
} from "../src/deploymentSync/StateStorage";
import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  type CompletionEvidenceInput,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  ATTEMPT_OUTCOME_COMMON_READ_STAGES,
  ATTEMPT_OUTCOME_WRITE_STAGES,
  claimEvaluationAttempt,
  makeAttemptOutcomeSqlProbe,
  type AttemptOutcomeSqlProbe,
  recordEvaluationOutcome,
} from "./deploymentSyncEvaluationAttemptOutcomeTestSupport";
import {
  beginEvaluation,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  readEvaluationScope,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const HISTORY_DEPENDENCY = "outcome-history";

describe("deployment query-sync evaluation attempt outcomes", () => {
  it("authenticates an attempt before field access or SQL", async () => {
    const probe = makeAttemptOutcomeSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      let fieldReads = 0;
      const getterFailure = new Error("attempt fields must not be read");
      const unissued = new Proxy({}, {
        get: () => {
          fieldReads += 1;
          throw getterFailure;
        },
      });
      const before = snapshotEvaluationState(prepared.database);
      probe.start();

      const exit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          // SAFETY: this deliberately unissued object crosses the nominal
          // boundary to prove authentication precedes every field read.
          unissued as unknown as QueryEvaluationAttempt,
          "terminalRefusal",
        ),
      );

      expectTypedFailure(exit, {
        _tag: "InvalidEvaluationAttemptError",
        operation: "recordEvaluationAttemptOutcome",
        reason: "notStateIssued",
        queryKey: "",
        generation: 0n,
      });
      expect(fieldReads).toBe(0);
      expect(probe.stop()).toEqual([]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("returns a transient attempt to the eligible pool without writing", async () => {
    const fixture = await prepareReadyOutcomeFixture(81);
    try {
      const before = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.start();

      const receipt = await recordEvaluationOutcome(
        fixture.prepared,
        fixture.attempt,
        "transientExhausted",
      );

      expect(receipt).toEqual({
        _tag: "eligible",
        queryKey: fixture.descriptor.queryKey,
        generation: fixture.attempt.generation,
      });
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(fixture.probe.stop()).toEqual(
        ATTEMPT_OUTCOME_COMMON_READ_STAGES,
      );
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        before,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });

  it("blocks once, preserves fairness and the C2 counter vector, and replays both outcomes", async () => {
    const fixture = await prepareReadyOutcomeFixture(82);
    try {
      const beforeScope = readEvaluationScope(fixture.prepared.database);
      expect(beforeScope.metrics).toMatchObject({
        queryCount: 2,
        dependencyMemberships: 1,
        pendingPublicationCount: 1,
        inFlightPublicationCount: 0,
        settlementEnvelopeBytes: 0,
      });
      expect(beforeScope.metrics.retainedIdentityBytes).toBeGreaterThan(0);
      expect(
        beforeScope.metrics.retainedPublicationContentBytes,
      ).toBeGreaterThan(0);
      expect(beforeScope.metrics.countedCanonicalBytes).toBeGreaterThan(0);
      fixture.probe.start();

      const blocked = await recordEvaluationOutcome(
        fixture.prepared,
        fixture.attempt,
        "terminalRefusal",
      );

      expect(blocked).toEqual({
        _tag: "blocked",
        blockedWork: {
          queryKey: fixture.descriptor.queryKey,
          generation: fixture.attempt.generation,
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      });
      expect(Object.isFrozen(blocked)).toBe(true);
      expect(blocked._tag).toBe("blocked");
      if (blocked._tag === "blocked") {
        expect(Object.isFrozen(blocked.blockedWork)).toBe(true);
      }
      expect(fixture.probe.stop()).toEqual(ATTEMPT_OUTCOME_WRITE_STAGES);
      expect(readEvaluationScope(fixture.prepared.database)).toEqual({
        ...beforeScope,
        evaluationWorkRevision:
          (BigInt(beforeScope.evaluationWorkRevision) + 1n).toString(),
        metrics: {
          ...beforeScope.metrics,
          countedCanonicalBytes:
            beforeScope.metrics.countedCanonicalBytes + 2,
        },
      });
      const afterBlock = snapshotEvaluationState(fixture.prepared.database);

      for (const outcome of [
        "terminalRefusal",
        "transientExhausted",
      ] as const) {
        fixture.probe.start();
        const replayed = await recordEvaluationOutcome(
          fixture.prepared,
          fixture.attempt,
          outcome,
        );
        expect(replayed).toEqual(blocked);
        expect(Object.isFrozen(replayed)).toBe(true);
        expect(fixture.probe.stop()).toEqual(
          ATTEMPT_OUTCOME_COMMON_READ_STAGES,
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          afterBlock,
        );
      }
    } finally {
      fixture.prepared.database.close();
    }
  });

  it("replays a committed terminal block after caller-side response loss", async () => {
    const fixture = await prepareReadyOutcomeFixture(83);
    try {
      const responseLoss = new Error(
        "forced committed attempt-outcome response loss",
      );
      let lostReceipt: unknown;
      fixture.probe.start();

      const lostExit = await Effect.runPromiseExit(
        fixture.prepared.state.recordEvaluationAttemptOutcome(
          fixture.attempt,
          "terminalRefusal",
        ).pipe(Effect.flatMap(receipt => {
          lostReceipt = receipt;
          return Effect.die(responseLoss);
        })),
      );

      expectDefect(lostExit, responseLoss);
      expect(fixture.probe.stop()).toEqual(ATTEMPT_OUTCOME_WRITE_STAGES);
      const afterCommit = snapshotEvaluationState(fixture.prepared.database);

      fixture.probe.start();
      const replayed = await recordEvaluationOutcome(
        fixture.prepared,
        fixture.attempt,
        "terminalRefusal",
      );
      expect(replayed).toEqual(lostReceipt);
      expect(replayed._tag).toBe("blocked");
      expect(fixture.probe.stop()).toEqual(
        ATTEMPT_OUTCOME_COMMON_READ_STAGES,
      );
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        afterCommit,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });

  it("classifies current, preceding, and expired genuine attempts without writing", async () => {
    const probe = makeAttemptOutcomeSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const descriptor = queryDescriptor(84);
      const first = await beginClaimAndCompleteGeneration(
        prepared,
        descriptor,
      );
      await expectNoWriteOutcome(
        prepared,
        probe,
        first,
        "terminalRefusal",
        {
          _tag: "superseded",
          queryKey: descriptor.queryKey,
          generation: first.generation,
          activeGeneration: first.generation,
        },
      );

      const sequence12 = captureCompletionBatch(
        prepared.binding,
        12n,
        [HISTORY_DEPENDENCY],
      );
      await applyCompletionBatch(prepared, sequence12);
      const second = await beginClaimAndCompleteGeneration(
        prepared,
        descriptor,
        {
          expectedActiveGeneration: first.generation,
          requestedDirtyThroughSequence: sequence12.sourceSequence,
        },
      );
      await expectNoWriteOutcome(
        prepared,
        probe,
        first,
        "transientExhausted",
        {
          _tag: "superseded",
          queryKey: descriptor.queryKey,
          generation: first.generation,
          activeGeneration: second.generation,
        },
      );

      const sequence13 = captureCompletionBatch(
        prepared.binding,
        13n,
        [HISTORY_DEPENDENCY],
      );
      await applyCompletionBatch(prepared, sequence13);
      const third = await beginClaimAndCompleteGeneration(
        prepared,
        descriptor,
        {
          expectedActiveGeneration: second.generation,
          requestedDirtyThroughSequence: sequence13.sourceSequence,
        },
      );
      await expectNoWriteOutcome(
        prepared,
        probe,
        first,
        "terminalRefusal",
        {
          _tag: "recoveryEvidenceExpired",
          queryKey: descriptor.queryKey,
          generation: first.generation,
          activeGeneration: third.generation,
        },
      );
    } finally {
      prepared.database.close();
    }
  });

  it("rejects a genuinely issued future attempt after the exact one-shot read", async () => {
    const firstProbe = makeAttemptOutcomeSqlProbe();
    const secondProbe = makeAttemptOutcomeSqlProbe();
    const first = await prepareEvaluationState(firstProbe.hooks);
    const second = await prepareEvaluationState(secondProbe.hooks);
    try {
      const descriptor = queryDescriptor(85);
      const firstGeneration = await beginClaimAndCompleteGeneration(
        first,
        descriptor,
      );
      const secondFirstGeneration = await beginClaimAndCompleteGeneration(
        second,
        descriptor,
      );
      expect(secondFirstGeneration.generation).toBe(firstGeneration.generation);

      const sequence12 = captureCompletionBatch(
        second.binding,
        12n,
        [HISTORY_DEPENDENCY],
      );
      await applyCompletionBatch(second, sequence12);
      await beginEvaluation(second, descriptor, {
        expectedActiveGeneration: secondFirstGeneration.generation,
        requestedDirtyThroughSequence: sequence12.sourceSequence,
      });
      const futureAttempt = await claimEvaluationAttempt(second);
      const before = snapshotEvaluationState(first.database);
      firstProbe.start();

      const exit = await Effect.runPromiseExit(
        first.state.recordEvaluationAttemptOutcome(
          futureAttempt,
          "terminalRefusal",
        ),
      );

      expectTypedFailure(exit, {
        _tag: "QueryGenerationMismatchError",
        operation: "recordEvaluationAttemptOutcome",
        queryKey: descriptor.queryKey,
        expectedGeneration: firstGeneration.generation,
        observedGeneration: futureAttempt.generation,
      });
      expect(firstProbe.stop()).toEqual(
        ATTEMPT_OUTCOME_COMMON_READ_STAGES,
      );
      expect(snapshotEvaluationState(first.database)).toEqual(before);
    } finally {
      first.database.close();
      second.database.close();
    }
  });

  it.each([
    { name: "before query CAS", phase: "before", writeOrdinal: 1 },
    { name: "after query CAS", phase: "after", writeOrdinal: 1 },
    { name: "before scope CAS", phase: "before", writeOrdinal: 2 },
    { name: "after scope CAS", phase: "after", writeOrdinal: 2 },
  ] as const)(
    "rolls back a foreign defect $name and succeeds on retry",
    async ({ phase, writeOrdinal }) => {
      const fixture = await prepareReadyOutcomeFixture(86 + writeOrdinal);
      try {
        const cause = new Error(`forced ${phase} write ${writeOrdinal}`);
        const before = snapshotEvaluationState(fixture.prepared.database);
        fixture.probe.start({ phase, writeOrdinal, cause });

        const exit = await Effect.runPromiseExit(
          fixture.prepared.state.recordEvaluationAttemptOutcome(
            fixture.attempt,
            "terminalRefusal",
          ),
        );

        expectDefect(exit, cause);
        expect(fixture.probe.stop()).toEqual(
          expectedWriteTrace(writeOrdinal),
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          before,
        );

        fixture.probe.start();
        await expect(recordEvaluationOutcome(
          fixture.prepared,
          fixture.attempt,
          "terminalRefusal",
        )).resolves.toMatchObject({ _tag: "blocked" });
        expect(fixture.probe.stop()).toEqual(ATTEMPT_OUTCOME_WRITE_STAGES);
      } finally {
        fixture.prepared.database.close();
      }
    },
  );

  it.each([
    { name: "query CAS", writeOrdinal: 1 },
    { name: "scope CAS", writeOrdinal: 2 },
  ] as const)(
    "refuses zero affected-row evidence for the $name and succeeds on retry",
    async ({ writeOrdinal }) => {
      const fixture = await prepareReadyOutcomeFixture(89 + writeOrdinal);
      try {
        const before = snapshotEvaluationState(fixture.prepared.database);
        fixture.probe.startAffectedRowRefusal(writeOrdinal, "skip");

        const exit = await Effect.runPromiseExit(
          fixture.prepared.state.recordEvaluationAttemptOutcome(
            fixture.attempt,
            "terminalRefusal",
          ),
        );

        expectAdapterInvariantDefect(exit);
        expect(fixture.probe.stop()).toEqual(
          expectedWriteTrace(writeOrdinal),
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          before,
        );

        fixture.probe.start();
        await expect(recordEvaluationOutcome(
          fixture.prepared,
          fixture.attempt,
          "terminalRefusal",
        )).resolves.toMatchObject({ _tag: "blocked" });
        expect(fixture.probe.stop()).toEqual(ATTEMPT_OUTCOME_WRITE_STAGES);
      } finally {
        fixture.prepared.database.close();
      }
    },
  );

  it.each(["terminal-first", "completion-first"] as const)(
    "serializes terminal outcome and completion in $0 order",
    async order => {
      const fixture = await prepareReadyOutcomeFixture(92);
      try {
        if (order === "terminal-first") {
          fixture.probe.start();
          const blocked = await recordEvaluationOutcome(
            fixture.prepared,
            fixture.attempt,
            "terminalRefusal",
          );
          expect(blocked._tag).toBe("blocked");
          expect(fixture.probe.stop()).toEqual(ATTEMPT_OUTCOME_WRITE_STAGES);
          const afterBlock = snapshotEvaluationState(
            fixture.prepared.database,
          );

          const exit = await Effect.runPromiseExit(
            fixture.prepared.state.completeQueryEvaluation(
              fixture.attempt,
              fixture.input.evaluation,
              fixture.input.refresh,
              fixture.input.publication,
            ),
          );
          expectTypedFailure(exit, {
            _tag: "QueryEvaluationWorkBlockedError",
            operation: "completeQueryEvaluation",
            queryKey: fixture.descriptor.queryKey,
            generation: fixture.attempt.generation,
            reason: "terminalEvaluatorRefusal",
            resetRequired: true,
          });
          expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
            afterBlock,
          );
          return;
        }

        await expect(completeEvaluation(
          fixture.prepared,
          fixture.attempt,
          fixture.input,
        )).resolves.toMatchObject({ _tag: "completed" });
        const afterCompletion = snapshotEvaluationState(
          fixture.prepared.database,
        );
        fixture.probe.start();

        const superseded = await recordEvaluationOutcome(
          fixture.prepared,
          fixture.attempt,
          "terminalRefusal",
        );

        expect(superseded).toEqual({
          _tag: "superseded",
          queryKey: fixture.descriptor.queryKey,
          generation: fixture.attempt.generation,
          activeGeneration: fixture.attempt.generation,
        });
        expect(fixture.probe.stop()).toEqual(
          ATTEMPT_OUTCOME_COMMON_READ_STAGES,
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          afterCompletion,
        );
      } finally {
        fixture.prepared.database.close();
      }
    },
  );
});

interface ReadyOutcomeFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: AttemptOutcomeSqlProbe;
  readonly descriptor: QueryDescriptor;
  readonly attempt: QueryEvaluationAttempt;
  readonly input: CompletionEvidenceInput;
}

async function prepareReadyOutcomeFixture(
  seed: number,
): Promise<ReadyOutcomeFixture> {
  const probe = makeAttemptOutcomeSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  // Keep an unrelated completed publication pending so the terminal update
  // must preserve every counter that C2 can legitimately make nonzero.
  // In-flight publication and settlement-envelope counters stay zero because
  // their C3 lifecycle operations are intentionally absent at this boundary.
  await beginClaimAndCompleteGeneration(prepared, queryDescriptor(1));
  const descriptor = queryDescriptor(seed);
  await beginEvaluation(prepared, descriptor);
  const attempt = await claimEvaluationAttempt(prepared);
  return Object.freeze({
    prepared,
    probe,
    descriptor,
    attempt,
    input: makeCompletionEvidence(prepared, attempt, {
      dependencyLabels: [HISTORY_DEPENDENCY],
      resultSeed: 180 + seed,
      publicationLabel: `outcome-${seed}`,
    }),
  });
}

async function beginClaimAndCompleteGeneration(
  prepared: PreparedEvaluationState,
  descriptor: QueryDescriptor,
  options: Parameters<typeof beginEvaluation>[2] = {},
): Promise<QueryEvaluationAttempt> {
  await beginEvaluation(prepared, descriptor, options);
  const attempt = await claimEvaluationAttempt(prepared);
  const completion = await completeEvaluation(
    prepared,
    attempt,
    makeCompletionEvidence(prepared, attempt, {
      dependencyLabels: [HISTORY_DEPENDENCY],
      resultSeed: 184 + Number(attempt.generation),
      publicationLabel: `history-${attempt.generation}`,
    }),
  );
  if (
    completion._tag !== "completed"
    || completion.publicationDisposition._tag !== "pending"
  ) {
    throw new Error("Expected a completed generation with pending content.");
  }
  return attempt;
}

async function expectNoWriteOutcome(
  prepared: PreparedEvaluationState,
  probe: AttemptOutcomeSqlProbe,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> {
  const before = snapshotEvaluationState(prepared.database);
  probe.start();
  const receipt = await recordEvaluationOutcome(prepared, attempt, outcome);
  expect(receipt).toEqual(expected);
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(probe.stop()).toEqual(ATTEMPT_OUTCOME_COMMON_READ_STAGES);
  expect(snapshotEvaluationState(prepared.database)).toEqual(before);
}

function expectedWriteTrace(writeOrdinal: number) {
  return ATTEMPT_OUTCOME_WRITE_STAGES.slice(
    0,
    ATTEMPT_OUTCOME_COMMON_READ_STAGES.length + writeOrdinal,
  );
}

function expectAdapterInvariantDefect<A, E>(exit: Exit.Exit<A, E>): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  const defect = success(Cause.findDefect(exit.cause));
  expect(defect).toBeInstanceOf(DeploymentQuerySyncAdapterInvariantDefect);
  expect(defect).toMatchObject({
    operation: "recordEvaluationAttemptOutcome",
    stage: "write",
  });
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

function expectDefect<A, E>(
  exit: Exit.Exit<A, E>,
  expected: Error,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(success(Cause.findDefect(exit.cause))).toBe(expected);
}
