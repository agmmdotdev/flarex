import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import type {
  PointMutationMultiScopeRedeliveryContinuationV1,
  PointMutationMultiScopeRedeliveryResultV1,
  PointMutationMultiScopeRedeliveryV1,
} from "../src/pointMutationMultiScopeRedelivery";
import { PointMutationMultiScopeRedeliveryInputV1Error } from
  "../src/pointMutationMultiScopeRedelivery";
import {
  type EncodedPointMutationMultiScopeRedeliveryContinuationV1,
  encodePointMutationMultiScopeRedeliveryContinuationV1,
} from "../src/pointMutationMultiScopeRedeliveryContinuationCodec";
import {
  type PointMutationRedeliverySchedulerCheckpointPortV1,
  PointMutationRedeliverySchedulerInvocationTimeoutV1Error,
  createPointMutationRedeliverySchedulerRunV1,
} from "../src/pointMutationRedeliverySchedulerRun";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

class TestConfigurationError extends Data.TaggedError(
  "TestConfigurationError",
)<{ readonly reason: "invalid" }> {}

class TestSchedulerError extends Data.TaggedError("TestSchedulerError")<{
  readonly operation: "acquire" | "renew" | "checkpoint" | "release";
  readonly reason: "stale" | "uncertain" | "sql";
}> {}

class TestConfirmedRollback extends Data.TaggedError(
  "TestConfirmedRollback",
)<{
  readonly operation: "acquire" | "renew" | "checkpoint" | "release";
}> {}

type TestOperationError = TestSchedulerError | TestConfirmedRollback;
type TestStructuralAcquireRollback = Readonly<{
  readonly _tag: "TestConfirmedRollback";
  readonly operation: "acquire";
}>;
type TestAcquireError = TestOperationError | TestStructuralAcquireRollback;
type TestRun = Readonly<{ readonly id: "run" }>;

type IsExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

const RUN = Object.freeze({ id: "run" as const });
const NOW = new Date("2026-07-21T00:00:00.000Z");
const LATER = new Date("2026-07-21T00:01:00.000Z");
const CONTINUATION = Object.freeze({
  codecVersion: 1,
  directory: Object.freeze({ kind: "unstarted" as const }),
  scopes: Object.freeze([]),
}) satisfies PointMutationMultiScopeRedeliveryContinuationV1;

describe("O08-B2b2b2b1b2b2b1 scheduler-run composition", () => {
  it("stays private and short-circuits the exact repository configuration failure", () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "createPointMutationRedeliverySchedulerRunV1"
      | "PointMutationRedeliverySchedulerCheckpointPortV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createPointMutationRedeliverySchedulerRunV1" in executorRoot)
      .toBe(false);

    const failure = new TestConfigurationError({ reason: "invalid" });
    let acquisitions = 0;
    const checkpoint = fixture({
      configuration: Result.fail(failure),
      onAcquire: () => {
        acquisitions += 1;
      },
    });
    const constructed = createPointMutationRedeliverySchedulerRunV1(
      checkpoint.port,
      sweep(() => Effect.die("must not construct work")),
      options({ maximumInvocationMilliseconds: 500 }),
    );
    expect(Result.isFailure(constructed)).toBe(true);
    if (Result.isFailure(constructed)) expect(constructed.failure).toBe(failure);
    expect(acquisitions).toBe(0);
  });

  it("binds exact A/E/R channels and consumes claim duration from the same port", () => {
    const checkpoint = fixture({ claimDurationMilliseconds: 20 });
    const invalid = createPointMutationRedeliverySchedulerRunV1(
      checkpoint.port,
      sweep(() => Effect.succeed(batch(null))),
      options({
        maximumRunMilliseconds: 20,
        maximumInvocationMilliseconds: 15,
        settlementReserveMilliseconds: 10,
      }),
    );
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({
        _tag: "PointMutationRedeliverySchedulerRunConfigurationV1Error",
      });
    }

    type AcquireEffect = ReturnType<typeof checkpoint.port.acquireEffect>;
    type _AcquireRequirements = Assert<
      IsExact<Effect.Services<AcquireEffect>, never>
    >;
    type _AcquireError = Assert<
      IsExact<Effect.Error<AcquireEffect>, TestAcquireError>
    >;
    expectTypeOf<_AcquireRequirements>().toEqualTypeOf<true>();
    expectTypeOf<_AcquireError>().toEqualTypeOf<true>();
  });

  it.each([
    { maximumInvocations: 0 },
    { maximumAttemptPages: 101 },
    { maximumCandidateAttempts: 2, maximumAttemptPages: 1 },
    { scopeLimitPerInvocation: 101 },
    { maximumRunMilliseconds: Number.MAX_SAFE_INTEGER + 1 },
    { maximumInvocationMilliseconds: 91, settlementReserveMilliseconds: 10 },
  ])("rejects invalid bounded policy %# before acquisition", (overrides) => {
    let acquisitions = 0;
    const checkpoint = fixture({ onAcquire: () => acquisitions += 1 });
    const constructed = createPointMutationRedeliverySchedulerRunV1(
      checkpoint.port,
      sweep(() => Effect.succeed(batch(null))),
      options(overrides),
    );
    expect(Result.isFailure(constructed)).toBe(true);
    expect(acquisitions).toBe(0);
  });

  it("distinguishes persisted null from returned null and releases only after checkpoint", async () => {
    const checkpoint = fixture();
    let sweepInput: unknown;
    const runner = makeRunner(
      checkpoint,
      sweep((input) => {
        sweepInput = input;
        return Effect.succeed(batch(null));
      }),
    );

    const result = await runEffect(runner.runEffect());
    expect(sweepInput).toEqual({
      scopeLimit: 100,
      maxAttemptPages: 100,
      maxCandidateAttempts: 100,
    });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:null",
      "release",
    ]);
    expect(result).toMatchObject({
      kind: "completed",
      reason: "continuationExhausted",
      invocations: 1,
    });
  });

  it.each([
    ["notDue", { kind: "notDue" as const, nextRunAt: NOW }],
    ["busy", { kind: "busy" as const, claimExpiresAt: LATER }],
  ])("closes the %s acquisition branch without scope work or release", async (
    expectedKind,
    acquiredResult,
  ) => {
    const checkpoint = fixture({
      acquireSteps: [Effect.succeed(Object.freeze(acquiredResult))],
    });
    let invocations = 0;
    const result = await runEffect(makeRunner(checkpoint, sweep(() => {
      invocations += 1;
      return Effect.succeed(batch(null));
    })).runEffect());

    expect(result.kind).toBe(expectedKind);
    expect(invocations).toBe(0);
    expect(checkpoint.events).toEqual(["acquire"]);
  });

  it("releases without work when acquisition consumed scheduler-lease headroom", async () => {
    const checkpoint = fixture({
      acquireSteps: [Effect.gen(function* () {
        yield* TestClock.adjust("95 millis");
        return acquired(null);
      })],
    });
    let invocations = 0;
    const result = await runEffect(makeRunner(
      checkpoint,
      sweep(() => {
        invocations += 1;
        return Effect.succeed(batch(null));
      }),
      { maximumRunMilliseconds: 500 },
    ).runEffect().pipe(Effect.provide(TestClock.layer())));

    expect(result).toMatchObject({ kind: "completed", reason: "noTimeToStart" });
    expect(invocations).toBe(0);
    expect(checkpoint.events).toEqual(["acquire", "release"]);
  });

  it("durably checkpoints once and releases at the count budget", async () => {
    const checkpoint = fixture();
    const runner = makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(batch(CONTINUATION))),
      { maximumInvocations: 1 },
    );
    const result = await runEffect(runner.runEffect());

    expect(result).toMatchObject({
      kind: "completed",
      reason: "countBudget",
      invocations: 1,
    });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "release",
    ]);
  });

  it("checkpoints every invocation before renew and preserves restart-equivalent continuation", async () => {
    const persisted = await runEffect(
      encodePointMutationMultiScopeRedeliveryContinuationV1(CONTINUATION),
    );
    const checkpoint = fixture({ persistedContinuation: persisted });
    const inputs: unknown[] = [];
    let calls = 0;
    const runner = makeRunner(checkpoint, sweep((input) => {
      inputs.push(input);
      calls += 1;
      return Effect.succeed(batch(calls === 1 ? CONTINUATION : null));
    }));

    const result = await runEffect(runner.runEffect());
    expect(result).toMatchObject({ invocations: 2, reason: "continuationExhausted" });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "renew",
      "checkpoint:null",
      "release",
    ]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveProperty("continuation", CONTINUATION);
    expect(inputs[1]).toHaveProperty("continuation", CONTINUATION);
  });

  it("retries only direct-class confirmed rollback without resetting budgets", async () => {
    const acquireRollback = new TestConfirmedRollback({ operation: "acquire" });
    const checkpointRollback = new TestConfirmedRollback({
      operation: "checkpoint",
    });
    const checkpoint = fixture({
      acquireSteps: [Effect.fail(acquireRollback), Effect.succeed(acquired(null))],
      checkpointSteps: [
        Effect.fail(checkpointRollback),
        Effect.succeed(Object.freeze({
          kind: "checkpointed" as const,
          checkpointSequence: 1n,
        })),
      ],
    });
    const runner = makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(batch(null, 1, 1))),
    );

    const result = await runEffect(runner.runEffect());
    expect(result).toMatchObject({ invocations: 1, attemptPagesCharged: 1 });
    expect(checkpoint.events).toEqual([
      "acquire",
      "acquire",
      "checkpoint:null",
      "checkpoint:null",
      "release",
    ]);
    expect(checkpoint.checkpointInputs[0]).toBe(
      checkpoint.checkpointInputs[1],
    );

    const structural = Object.freeze({
      _tag: "TestConfirmedRollback" as const,
      operation: "acquire" as const,
    });
    const adversarial = fixture({
      acquireSteps: [Effect.fail(structural)],
    });
    const failure = await runEffectFailure(makeRunner(
      adversarial,
      sweep(() => Effect.succeed(batch(null))),
    ).runEffect());
    expect(failure).toBe(structural);
    expect(adversarial.events).toEqual(["acquire"]);
  });

  it("retries direct-class renewal and release rollback exactly once", async () => {
    const renewRollback = new TestConfirmedRollback({ operation: "renew" });
    const releaseRollback = new TestConfirmedRollback({ operation: "release" });
    const checkpoint = fixture({
      renewSteps: [
        Effect.fail(renewRollback),
        Effect.succeed(Object.freeze({ kind: "renewed" as const, claimExpiresAt: LATER })),
      ],
      releaseSteps: [
        Effect.fail(releaseRollback),
        Effect.succeed(Object.freeze({ kind: "released" as const, nextRunAt: NOW })),
      ],
    });
    let calls = 0;
    const result = await runEffect(makeRunner(checkpoint, sweep(() => {
      calls += 1;
      return Effect.succeed(batch(calls === 1 ? CONTINUATION : null));
    })).runEffect());

    expect(result).toMatchObject({ kind: "completed", invocations: 2 });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "renew",
      "renew",
      "checkpoint:null",
      "release",
      "release",
    ]);
  });

  it("does not release when a pending exact checkpoint retry loses deadline admission", async () => {
    const rollback = new TestConfirmedRollback({ operation: "checkpoint" });
    const checkpoint = fixture({
      checkpointSteps: [Effect.gen(function* () {
        yield* TestClock.adjust("95 millis");
        return yield* Effect.fail(rollback);
      })],
    });
    const runner = makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(batch(null))),
    );
    const failure = await runEffectFailure(
      runner.runEffect().pipe(Effect.provide(TestClock.layer())),
    );
    expect(failure).toBe(rollback);
    expect(checkpoint.events).toEqual(["acquire", "checkpoint:null"]);
  });

  it("lets checkpoint settlement cross the soft deadline but admits no later work", async () => {
    const checkpoint = fixture({
      checkpointSteps: [Effect.gen(function* () {
        yield* TestClock.adjust("95 millis");
        return Object.freeze({
          kind: "checkpointed" as const,
          checkpointSequence: 1n,
        });
      })],
    });
    let calls = 0;
    const result = await runEffect(makeRunner(checkpoint, sweep(() => {
      calls += 1;
      return Effect.succeed(batch(CONTINUATION));
    })).runEffect().pipe(Effect.provide(TestClock.layer())));

    expect(result).toMatchObject({ kind: "completed", reason: "timeBudget" });
    expect(calls).toBe(1);
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "release",
    ]);
  });

  it("rechecks renewed lease headroom and stops before a second invocation", async () => {
    const checkpoint = fixture({
      renewSteps: [Effect.gen(function* () {
        yield* TestClock.adjust("95 millis");
        return Object.freeze({ kind: "renewed" as const, claimExpiresAt: LATER });
      })],
    });
    let calls = 0;
    const runner = makeRunner(
      checkpoint,
      sweep(() => {
        calls += 1;
        return Effect.succeed(batch(CONTINUATION));
      }),
      { maximumRunMilliseconds: 500 },
    );
    const result = await runEffect(
      runner.runEffect().pipe(Effect.provide(TestClock.layer())),
    );
    expect(calls).toBe(1);
    expect(result).toMatchObject({ kind: "completed", reason: "timeBudget" });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "renew",
      "release",
    ]);
  });

  it("times out one invocation, conditionally releases, and preserves typed identity", async () => {
    const checkpoint = fixture();
    const started = await runEffect(Deferred.make<void>());
    const runner = makeRunner(checkpoint, sweep(() =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
    ));
    const program = Effect.gen(function* () {
      const fiber = yield* runner.runEffect().pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("50 millis");
      return yield* Fiber.join(fiber);
    });
    const failure = await runEffectFailure(
      program.pipe(Effect.provide(TestClock.layer())),
    );
    expect(failure).toBeInstanceOf(
      PointMutationRedeliverySchedulerInvocationTimeoutV1Error,
    );
    expect(checkpoint.events).toEqual(["acquire", "release"]);
  });

  it("preserves an invocation failure by identity and orders cleanup Cause second", async () => {
    const invocationFailure = new PointMutationMultiScopeRedeliveryInputV1Error({
      reason: "invalidInput",
    });
    const cleanupFailure = new TestSchedulerError({
      operation: "release",
      reason: "sql",
    });
    const checkpoint = fixture({ releaseSteps: [Effect.fail(cleanupFailure)] });
    const runner = makeRunner(
      checkpoint,
      sweep(() => Effect.fail(invocationFailure)),
    );
    const exit = await runEffect(Effect.exit(runner.runEffect()));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures = exit.cause.reasons.filter(Cause.isFailReason).map(
        ({ error }) => error,
      );
      expect(failures).toEqual([invocationFailure, cleanupFailure]);
    }
    expect(checkpoint.events).toEqual(["acquire", "release"]);

    const successfulCleanup = fixture();
    const sameFailure = await runEffectFailure(makeRunner(
      successfulCleanup,
      sweep(() => Effect.fail(invocationFailure)),
    ).runEffect());
    expect(sameFailure).toBe(invocationFailure);
  });

  it("releases after persisted continuation corruption without starting work", async () => {
    const checkpoint = fixture({
      persistedContinuation: Object.freeze({
        codecVersion: 1,
        canonicalBytes: new TextEncoder().encode("not-json"),
        sha256: new Uint8Array(32),
      }),
    });
    let invocations = 0;
    const failure = await runEffectFailure(makeRunner(
      checkpoint,
      sweep(() => {
        invocations += 1;
        return Effect.succeed(batch(null));
      }),
    ).runEffect());
    expect(failure).toMatchObject({
      _tag: "PointMutationMultiScopeRedeliveryContinuationCodecV1Error",
      operation: "decode",
    });
    expect(invocations).toBe(0);
    expect(checkpoint.events).toEqual(["acquire", "release"]);
  });

  it("does not release or continue after checkpoint uncertainty", async () => {
    const uncertain = new TestSchedulerError({
      operation: "checkpoint",
      reason: "uncertain",
    });
    const checkpoint = fixture({ checkpointSteps: [Effect.fail(uncertain)] });
    const failure = await runEffectFailure(makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(batch(CONTINUATION))),
    ).runEffect());
    expect(failure).toBe(uncertain);
    expect(checkpoint.events).toEqual(["acquire", "checkpoint:evidence"]);
  });

  it("does not release after renewal uncertainty or retry an uncertain release", async () => {
    const renewUncertain = new TestSchedulerError({
      operation: "renew",
      reason: "uncertain",
    });
    const renewing = fixture({ renewSteps: [Effect.fail(renewUncertain)] });
    const renewFailure = await runEffectFailure(makeRunner(
      renewing,
      sweep(() => Effect.succeed(batch(CONTINUATION))),
    ).runEffect());
    expect(renewFailure).toBe(renewUncertain);
    expect(renewing.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "renew",
    ]);

    const releaseUncertain = new TestSchedulerError({
      operation: "release",
      reason: "uncertain",
    });
    const releasing = fixture({ releaseSteps: [Effect.fail(releaseUncertain)] });
    const releaseFailure = await runEffectFailure(makeRunner(
      releasing,
      sweep(() => Effect.succeed(batch(null))),
    ).runEffect());
    expect(releaseFailure).toBe(releaseUncertain);
    expect(releasing.events).toEqual([
      "acquire",
      "checkpoint:null",
      "release",
    ]);
  });

  it("preserves defects and interruption while conditionally releasing once", async () => {
    const defect = new Error("runner defect");
    const defectCheckpoint = fixture();
    const defectExit = await runEffect(Effect.exit(makeRunner(
      defectCheckpoint,
      sweep(() => Effect.die(defect)),
    ).runEffect()));
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      expect(defectExit.cause.reasons.some((reason) =>
        Cause.isDieReason(reason) && reason.defect === defect
      )).toBe(true);
    }
    expect(defectCheckpoint.events).toEqual(["acquire", "release"]);

    const interruptedCheckpoint = fixture();
    const started = await runEffect(Deferred.make<void>());
    const interrupted = await runEffect(Effect.gen(function* () {
      const fiber = yield* makeRunner(
        interruptedCheckpoint,
        sweep(() => Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
        )),
      ).runEffect().pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(interrupted)).toBe(true);
    if (Exit.isFailure(interrupted)) {
      expect(interrupted.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    }
    expect(interruptedCheckpoint.events).toEqual(["acquire", "release"]);
  });
});

function options(
  overrides: Partial<
    Readonly<{
      maximumInvocations: number;
      maximumAttemptPages: number;
      maximumCandidateAttempts: number;
      scopeLimitPerInvocation: number;
      maximumRunMilliseconds: number;
      maximumInvocationMilliseconds: number;
      settlementReserveMilliseconds: number;
    }>
  > = {},
) {
  return Object.freeze({
    maximumInvocations: overrides.maximumInvocations ?? 100,
    maximumAttemptPages: overrides.maximumAttemptPages ?? 100,
    maximumCandidateAttempts: overrides.maximumCandidateAttempts ?? 100,
    scopeLimitPerInvocation: overrides.scopeLimitPerInvocation ?? 100,
    maximumRunMilliseconds: overrides.maximumRunMilliseconds ?? 100,
    maximumInvocationMilliseconds:
      overrides.maximumInvocationMilliseconds ?? 50,
    settlementReserveMilliseconds:
      overrides.settlementReserveMilliseconds ?? 10,
  });
}

function makeRunner(
  checkpoint: ReturnType<typeof fixture>,
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
  overrides: Parameters<typeof options>[0] = {},
) {
  return Result.getOrThrow(createPointMutationRedeliverySchedulerRunV1(
    checkpoint.port,
    multiScope,
    options(overrides),
  ));
}

function fixture(options: Readonly<{
  configuration?: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    TestConfigurationError
  >;
  claimDurationMilliseconds?: number;
  persistedContinuation?: EncodedPointMutationMultiScopeRedeliveryContinuationV1;
  acquireSteps?: Array<Effect.Effect<
    ReturnType<typeof acquired> | Readonly<{
      readonly kind: "notDue";
      readonly nextRunAt: Date;
    }> | Readonly<{
      readonly kind: "busy";
      readonly claimExpiresAt: Date;
    }>,
    TestOperationError | Readonly<{
      readonly _tag: "TestConfirmedRollback";
      readonly operation: "acquire";
    }>
  >>;
  renewSteps?: Array<Effect.Effect<
    Readonly<{ readonly kind: "renewed"; readonly claimExpiresAt: Date }>,
    TestOperationError
  >>;
  checkpointSteps?: Array<Effect.Effect<
    Readonly<{ readonly kind: "checkpointed"; readonly checkpointSequence: bigint }>,
    TestOperationError
  >>;
  releaseSteps?: Array<Effect.Effect<
    Readonly<{ readonly kind: "released"; readonly nextRunAt: Date }>,
    TestOperationError
  >>;
  onAcquire?: () => void;
}> = {}) {
  const events: string[] = [];
  const checkpointInputs: Array<unknown> = [];
  const acquireSteps = [...(options.acquireSteps ?? [
    Effect.succeed(acquired(options.persistedContinuation ?? null)),
  ])];
  const renewSteps = [...(options.renewSteps ?? [Effect.succeed(Object.freeze({
    kind: "renewed" as const,
    claimExpiresAt: LATER,
  }))])];
  const checkpointSteps = [...(options.checkpointSteps ?? [Effect.succeed(
    Object.freeze({ kind: "checkpointed" as const, checkpointSequence: 1n }),
  )])];
  const releaseSteps = [...(options.releaseSteps ?? [Effect.succeed(
    Object.freeze({ kind: "released" as const, nextRunAt: NOW }),
  )])];

  const port = Object.freeze({
    configuration: options.configuration ?? Result.succeed(Object.freeze({
      claimDurationMilliseconds: options.claimDurationMilliseconds ?? 100,
    })),
    acquireEffect: () => Effect.suspend(() => {
      events.push("acquire");
      options.onAcquire?.();
      return take(acquireSteps);
    }),
    renewEffect: (_run: TestRun) => Effect.suspend(() => {
      events.push("renew");
      return take(renewSteps);
    }),
    checkpointEffect: (_run: TestRun, evidence: unknown) =>
      Effect.suspend(() => {
        events.push(evidence === null
          ? "checkpoint:null"
          : "checkpoint:evidence");
        checkpointInputs.push(evidence);
        return take(checkpointSteps);
      }),
    releaseEffect: (_run: TestRun) => Effect.suspend(() => {
      events.push("release");
      return take(releaseSteps);
    }),
    isAcquireConfirmedRollback: (
      error: TestAcquireError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "acquire",
    isRenewConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "renew",
    isCheckpointConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "checkpoint",
    isReleaseConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "release",
  }) satisfies PointMutationRedeliverySchedulerCheckpointPortV1<
    TestRun,
    TestConfigurationError,
    TestAcquireError,
    TestOperationError,
    TestOperationError,
    TestOperationError,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback
  >;
  return Object.freeze({ port, events, checkpointInputs });
}

function take<A, E>(steps: Array<Effect.Effect<A, E>>): Effect.Effect<A, E> {
  const step = steps.length > 1 ? steps.shift() : steps[0];
  return step ?? Effect.die(new Error("Missing fixture step."));
}

function acquired(
  continuation: EncodedPointMutationMultiScopeRedeliveryContinuationV1 | null,
) {
  return Object.freeze({
    kind: "acquired" as const,
    run: RUN,
    claimExpiresAt: LATER,
    continuation,
  });
}

function batch(
  continuation: PointMutationMultiScopeRedeliveryContinuationV1 | null,
  attemptPagesCharged = 1,
  candidateAttemptsCharged = 1,
): PointMutationMultiScopeRedeliveryResultV1 {
  return Object.freeze({
    scopeDirectoryQueries: 1,
    attemptPagesCharged,
    candidateAttemptsCharged,
    scopes: Object.freeze([]),
    continuation,
  });
}

function sweep(
  operation: PointMutationMultiScopeRedeliveryV1["sweepEffect"],
): Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect"> {
  return Object.freeze({ sweepEffect: operation });
}
