import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  FrameworkSchemaArtifactControlSessionCleanupDefect,
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  makeFrameworkSchemaArtifactControlSessionStarter,
  remainingFrameworkSchemaArtifactControlMilliseconds,
  runFrameworkSchemaArtifactControlEffect,
  startFrameworkSchemaArtifactControlDeadline,
  type FrameworkSchemaArtifactControlSessionStarter,
  type FrameworkSchemaArtifactControlSessionTransaction,
  type FrameworkSchemaArtifactControlWork,
} from "../src/frameworkSchema/artifact/controlSession";
import {
  makeFrameworkSchemaArtifactRepository,
  withFrameworkSchemaArtifactControlTransactionEffect,
  withFrameworkSchemaArtifactRawControlTransactionEffect,
  type FrameworkSchemaArtifactControlTransaction,
  type FrameworkSchemaArtifactRepository,
} from "../src/frameworkSchema/artifact/repository";
import { runEffect } from "./effectTestRuntime";
import { makeScriptedControlSessionFixture } from
  "./frameworkSchemaArtifactControlSessionTestSupport";

const TIMEOUT_POLICY = Object.freeze({
  readTimeoutMilliseconds: 1_000,
  attemptTimeoutMilliseconds: 2_000,
  recoveryTimeoutMilliseconds: 3_000,
  lockTimeoutMilliseconds: 500,
});

describe("private framework schema artifact control-session lifecycle", () => {
  it("uses one absolute Effect-clock deadline and expires sub-millisecond residue", async () => {
    const observations = await runEffect(Effect.gen(function* () {
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "read",
        10,
      );
      const atStart = yield*
        remainingFrameworkSchemaArtifactControlMilliseconds(deadline, "read");
      yield* TestClock.adjust("9 millis");
      const atLastMillisecond = yield*
        remainingFrameworkSchemaArtifactControlMilliseconds(deadline, "read");
      yield* TestClock.adjust("999 micros");
      const expired = yield* Effect.exit(
        remainingFrameworkSchemaArtifactControlMilliseconds(deadline, "read"),
      );
      return { atStart, atLastMillisecond, expired };
    }).pipe(Effect.provide(TestClock.layer())));

    expect(observations.atStart).toBe(10);
    expect(observations.atLastMillisecond).toBe(1);
    expect(Exit.isFailure(observations.expired)).toBe(true);
    if (Exit.isFailure(observations.expired)) {
      expect(typedFailures(observations.expired.cause)[0]).toMatchObject({
        _tag: "FrameworkSchemaArtifactControlSessionDeadlineIssue",
        deadlineKind: "read",
        phase: "read",
      } satisfies Partial<FrameworkSchemaArtifactControlSessionDeadlineIssue>);
    }
  });

  it("commits a created decision once without recovery or resolution", async () => {
    const fixture = makeScriptedControlSessionFixture({ initial: "commit" });
    const result = await runControl(fixture, {
      runLockedEffect: (_transaction, attempt) => Effect.succeed({
        kind: "created",
        value: attempt,
      }),
      resolveExistingEffect: () => Effect.die("unexpected resolution"),
    });

    expect(result).toEqual({ status: "created", value: "initial" });
    expect(fixture.events).toEqual([
      "initial:begin",
      "initial:isolation",
      "initial:budget",
      "initial:callback",
      "initial:commit",
      "initial:release",
    ]);
  });

  it("re-emits the full callback Cause after confirmed rollback", async () => {
    const fixture = makeScriptedControlSessionFixture({ initial: "commit" });
    const domainFailure = Object.freeze({ kind: "domainFailure" as const });
    const callbackDefect = new Error("callback defect");
    const callbackCause = Cause.combine(
      Cause.fail(domainFailure),
      Cause.die(callbackDefect),
    );
    const exit = await runControlExit(fixture, {
      runLockedEffect: () => Effect.failCause(callbackCause),
      resolveExistingEffect: () => Effect.die("unexpected resolution"),
    });

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(typedFailures(exit.cause)).toContain(domainFailure);
      expect(defects(exit.cause)).toContain(callbackDefect);
    }
    expect(fixture.events.at(-1)).toBe("initial:rollback");
  });

  it("re-emits one callback interrupt after confirmed rollback", async () => {
    const result = await runEffect(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const fixture = makeScriptedControlSessionFixture({ initial: "commit" });
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "initial",
        TIMEOUT_POLICY.attemptTimeoutMilliseconds,
      );
      const worker = yield* Effect.forkChild(
        runFrameworkSchemaArtifactControlEffect(
          starterFor(fixture),
          {
            initialDeadline: deadline,
            lockTimeoutMilliseconds:
              TIMEOUT_POLICY.lockTimeoutMilliseconds,
            recoveryTimeoutMilliseconds:
              TIMEOUT_POLICY.recoveryTimeoutMilliseconds,
          },
          {
            runLockedEffect: () => Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
            resolveExistingEffect: () =>
              Effect.die("unexpected resolution"),
          },
        ),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(worker);
      const exit = yield* Fiber.await(worker);
      return { exit, events: fixture.events };
    }));

    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit)) {
      expect(result.exit.cause.reasons.filter(Cause.isInterruptReason))
        .toHaveLength(1);
    }
    expect(result.events.at(-1)).toBe("initial:rollback");
  });

  it.each(["rollback", "release", "quarantine"] as const)(
    "combines callback failure with its %s cleanup defect",
    async (cleanupPhase) => {
      const cleanupCause = new Error(`${cleanupPhase} failed`);
      const domainFailure = Object.freeze({ kind: "domainFailure" as const });
      const fixture = makeScriptedControlSessionFixture({
        initial: "cleanupFailure",
        cleanupPhase,
        cleanupCause,
      });
      const exit = await runControlExit(fixture, {
        runLockedEffect: () => Effect.fail(domainFailure),
        resolveExistingEffect: () => Effect.die("unexpected resolution"),
      });

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(typedFailures(exit.cause)).toContain(domainFailure);
        const cleanupDefect = defects(exit.cause).find(
          (value): value is
            FrameworkSchemaArtifactControlSessionCleanupDefect =>
            value instanceof
              FrameworkSchemaArtifactControlSessionCleanupDefect,
        );
        expect(cleanupDefect).toMatchObject({
          phase: cleanupPhase,
          cause: cleanupCause,
        });
      }
    },
  );

  it("quarantines uncertainty before one distinct recovery attempt", async () => {
    const initialSettlementCause = new Error("commit response lost");
    const fixture = makeScriptedControlSessionFixture({
      initial: "uncertainConfirmed",
      initialSettlementCause,
      recovery: "commit",
    });
    const result = await runControl(fixture, {
      runLockedEffect: (_transaction, attempt) => Effect.succeed(attempt ===
          "initial"
        ? { kind: "created", value: "first" }
        : { kind: "existing", value: "recovered" }),
      resolveExistingEffect: () => Effect.die("unexpected resolution"),
    });

    expect(result).toEqual({ status: "existing", value: "recovered" });
    expect(fixture.events).toEqual([
      "initial:begin",
      "initial:isolation",
      "initial:budget",
      "initial:callback",
      "initial:commitUncertain",
      "recovery:deadline",
      "initial:quarantine",
      "recovery:begin",
      "recovery:isolation",
      "recovery:budget",
      "recovery:callback",
      "recovery:commit",
      "recovery:release",
    ]);
  });

  it("resolves uncertain non-writing decisions out of lock without recovery", async () => {
    const fixture = makeScriptedControlSessionFixture({
      initial: "uncertainConfirmed",
      initialSettlementCause: new Error("read-only settlement lost"),
    });
    const result = await runControl(fixture, {
      runLockedEffect: () => Effect.succeed({
        kind: "existing",
        value: "locked evidence",
      }),
      resolveExistingEffect: () => Effect.succeed("reconstructed"),
    });

    expect(result).toEqual({ status: "existing", value: "reconstructed" });
    expect(fixture.events.at(-1)).toBe("read");
    expect(fixture.events.some(event => event.startsWith("recovery:begin")))
      .toBe(false);
  });

  it("stops at settle uncertainty when quarantine cannot be confirmed", async () => {
    const initialSettlementCause = new Error("commit response lost");
    const quarantineCause = new Error("discard failed");
    const fixture = makeScriptedControlSessionFixture({
      initial: "uncertainQuarantineFailed",
      initialSettlementCause,
      quarantineCause,
    });
    const exit = await runControlExit(fixture, createdWork());

    expectDecisionUncertain(
      exit,
      "settle",
      initialSettlementCause,
      quarantineCause,
    );
    expect(fixture.events.some(event => event.startsWith("recovery:begin")))
      .toBe(false);
  });

  it("stops after one unresolved recovery and retains both causes", async () => {
    const initialSettlementCause = new Error("initial commit uncertain");
    const resolutionDefect = new Error("recovery commit uncertain");
    const resolutionCause = Cause.die(resolutionDefect);
    const fixture = makeScriptedControlSessionFixture({
      initial: "uncertainConfirmed",
      recovery: "unresolvedLifecycle",
      initialSettlementCause,
      resolutionCause,
    });
    const exit = await runControlExit(fixture, createdWork());

    expectDecisionUncertain(
      exit,
      "recover",
      initialSettlementCause,
      resolutionCause,
    );
    expect(fixture.events.filter(event => event === "recovery:begin"))
      .toHaveLength(1);
    if (Exit.isFailure(exit)) {
      expect(defects(exit.cause)).toContain(resolutionDefect);
    }
  });

  it("retains a pending interrupt alongside recovery uncertainty", async () => {
    const result = await runEffect(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const fixture = makeScriptedControlSessionFixture({
        initial: "uncertainConfirmed",
        recovery: "unresolvedLifecycle",
        initialSettlementCause: new Error("initial uncertain"),
        resolutionCause: Cause.die(new Error("recovery uncertain")),
        beforeRecoveryEffect: Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      });
      const starter = starterFor(fixture);
      const deadline = yield* startFrameworkSchemaArtifactControlDeadline(
        "initial",
        TIMEOUT_POLICY.attemptTimeoutMilliseconds,
      );
      const worker = yield* Effect.forkChild(
        runFrameworkSchemaArtifactControlEffect(
          starter,
          {
            initialDeadline: deadline,
            lockTimeoutMilliseconds: TIMEOUT_POLICY.lockTimeoutMilliseconds,
            recoveryTimeoutMilliseconds:
              TIMEOUT_POLICY.recoveryTimeoutMilliseconds,
          },
          createdWork(),
        ),
      );
      yield* Deferred.await(entered);
      const interrupter = yield* Effect.forkChild(Fiber.interrupt(worker));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      const exit = yield* Fiber.await(worker);
      yield* Fiber.join(interrupter);
      return { exit, events: fixture.events };
    }));

    expect(Exit.isFailure(result.exit)).toBe(true);
    if (Exit.isFailure(result.exit)) {
      expect(Cause.hasInterrupts(result.exit.cause)).toBe(true);
      expect(typedFailures(result.exit.cause).filter(
        value => value instanceof
          FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
      )).toHaveLength(1);
    }
    expect(result.events.at(-1)).toBe("recovery:quarantine");
  });
});

describe("private framework schema artifact control-transaction authority", () => {
  it("binds one token to one repository and revokes it after the callback", async () => {
    const fixture = makeScriptedControlSessionFixture({ initial: "commit" });
    const starter = starterFor(fixture);
    const first = makeRepository(fixture.controlDb, starter);
    let retained: FrameworkSchemaArtifactControlTransaction | undefined;
    let retainedSession:
      | FrameworkSchemaArtifactControlSessionTransaction
      | undefined;

    const observed = await runControl(fixture, {
      runLockedEffect: (sessionTransaction) => {
        retainedSession = sessionTransaction;
        return withFrameworkSchemaArtifactControlTransactionEffect(
          first,
          sessionTransaction,
          (token) => {
            retained = token;
            return withFrameworkSchemaArtifactRawControlTransactionEffect(
              first,
              token,
              transaction => Effect.succeed(Object.freeze({
                kind: "created" as const,
                value: transaction === fixture.initialTransaction,
              })),
            );
          },
        );
      },
      resolveExistingEffect: () => Effect.die("unexpected resolution"),
    }, starter);
    expect(observed).toEqual({ status: "created", value: true });
    if (retained === undefined) {
      throw new Error("Expected retained control transaction.");
    }

    if (retainedSession === undefined) {
      throw new Error("Expected retained session transaction.");
    }
    const closedSession = await runEffect(Effect.exit(
      withFrameworkSchemaArtifactControlTransactionEffect(
        first,
        retainedSession,
        () => Effect.succeed("unexpected"),
      ),
    ));
    expectInvariantDefect(closedSession, "closedTransaction");

    const closed = await runEffect(Effect.exit(
      withFrameworkSchemaArtifactRawControlTransactionEffect(
        first,
        retained,
        () => Effect.succeed("unexpected"),
      ),
    ));
    expectInvariantDefect(closed, "closedControlTransaction");

    const crossFixture = makeScriptedControlSessionFixture({
      initial: "commit",
    });
    const crossStarter = starterFor(crossFixture);
    const crossFirst = makeRepository(crossFixture.controlDb, crossStarter);
    const crossSecond = makeRepository(crossFixture.controlDb, crossStarter);
    const crossResult = await runControl(crossFixture, {
      runLockedEffect: sessionTransaction =>
        withFrameworkSchemaArtifactControlTransactionEffect(
          crossFirst,
          sessionTransaction,
          token => Effect.exit(
            withFrameworkSchemaArtifactRawControlTransactionEffect(
              crossSecond,
              token,
              () => Effect.succeed("unexpected"),
            ),
          ).pipe(Effect.map(exit => Object.freeze({
            kind: "created" as const,
            value: exit,
          }))),
        ),
      resolveExistingEffect: () => Effect.die("unexpected resolution"),
    }, crossStarter);
    expectInvariantDefect(
      crossResult.value,
      "crossRepositoryControlTransaction",
    );
  });

  it("rejects an active session issued by another repository starter", async () => {
    const firstFixture = makeScriptedControlSessionFixture({
      initial: "commit",
    });
    const firstStarter = starterFor(firstFixture);
    const secondFixture = makeScriptedControlSessionFixture({
      initial: "commit",
    });
    const secondStarter = starterFor(secondFixture);
    const secondRepository = makeRepository(
      secondFixture.controlDb,
      secondStarter,
    );
    let workCalls = 0;

    const result = await runControl(firstFixture, {
      runLockedEffect: sessionTransaction => Effect.exit(
        withFrameworkSchemaArtifactControlTransactionEffect(
          secondRepository,
          sessionTransaction,
          () => {
            workCalls += 1;
            return Effect.succeed("unexpected");
          },
        ),
      ).pipe(Effect.map(exit => Object.freeze({
        kind: "created" as const,
        value: exit,
      }))),
      resolveExistingEffect: () => Effect.die("unexpected resolution"),
    }, firstStarter);

    expectInvariantDefect(result.value, "crossStarterTransaction");
    expect(workCalls).toBe(0);
  });

  it("rejects transaction-token minting outside an active driver callback", async () => {
    const fixture = makeScriptedControlSessionFixture({ initial: "commit" });
    const starter = starterFor(fixture);
    const repository = makeRepository(fixture.controlDb, starter);
    const forged = Object.freeze({}) as
      FrameworkSchemaArtifactControlSessionTransaction;
    const exit = await runEffect(Effect.exit(
      withFrameworkSchemaArtifactControlTransactionEffect(
        repository,
        forged,
        () => Effect.succeed("unexpected"),
      ),
    ));

    expectInvariantDefect(exit, "invalidTransaction");
  });

  it("rejects a structural token before invoking locked work", async () => {
    const fixture = makeScriptedControlSessionFixture({ initial: "commit" });
    const starter = starterFor(fixture);
    const repository = makeRepository(fixture.controlDb, starter);
    let workCalls = 0;
    const forged = Object.freeze({}) as
      FrameworkSchemaArtifactControlTransaction;
    const exit = await runEffect(Effect.exit(
      withFrameworkSchemaArtifactRawControlTransactionEffect(
        repository,
        forged,
        () => {
          workCalls += 1;
          return Effect.succeed("unexpected");
        },
      ),
    ));

    expectInvariantDefect(exit, "invalidControlTransaction");
    expect(workCalls).toBe(0);
  });
});

async function runControl<Value, Failure>(
  fixture: ReturnType<typeof makeScriptedControlSessionFixture>,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
  starter = starterFor(fixture),
): Promise<Readonly<{ status: "created" | "existing"; value: Value }>> {
  const deadline = await runEffect(
    startFrameworkSchemaArtifactControlDeadline(
      "initial",
      TIMEOUT_POLICY.attemptTimeoutMilliseconds,
    ),
  );
  return runEffect(runFrameworkSchemaArtifactControlEffect(
    starter,
    {
      initialDeadline: deadline,
      lockTimeoutMilliseconds: TIMEOUT_POLICY.lockTimeoutMilliseconds,
      recoveryTimeoutMilliseconds: TIMEOUT_POLICY.recoveryTimeoutMilliseconds,
    },
    work,
  ));
}

async function runControlExit<Value, Failure>(
  fixture: ReturnType<typeof makeScriptedControlSessionFixture>,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
) {
  const deadline = await runEffect(
    startFrameworkSchemaArtifactControlDeadline(
      "initial",
      TIMEOUT_POLICY.attemptTimeoutMilliseconds,
    ),
  );
  return runEffect(Effect.exit(runFrameworkSchemaArtifactControlEffect(
    starterFor(fixture),
    {
      initialDeadline: deadline,
      lockTimeoutMilliseconds: TIMEOUT_POLICY.lockTimeoutMilliseconds,
      recoveryTimeoutMilliseconds: TIMEOUT_POLICY.recoveryTimeoutMilliseconds,
    },
    work,
  )));
}

function starterFor(
  fixture: ReturnType<typeof makeScriptedControlSessionFixture>,
): FrameworkSchemaArtifactControlSessionStarter {
  return makeFrameworkSchemaArtifactControlSessionStarter({
    controlDb: fixture.controlDb,
    driver: fixture.driver,
  });
}

function createdWork(): FrameworkSchemaArtifactControlWork<string, never> {
  const work: FrameworkSchemaArtifactControlWork<string, never> = {
    runLockedEffect: (_transaction, attempt) => Effect.succeed(
      Object.freeze({ kind: "created" as const, value: attempt }),
    ),
    resolveExistingEffect: () => Effect.die("unexpected resolution"),
  };
  return Object.freeze(work);
}

function typedFailures<Failure>(cause: Cause.Cause<Failure>): Failure[] {
  return cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
}

function defects(cause: Cause.Cause<unknown>): unknown[] {
  return cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect);
}

function expectDecisionUncertain(
  exit: Exit.Exit<unknown, unknown>,
  stage: "settle" | "recover",
  initialSettlementCause: unknown,
  resolutionCause: unknown,
): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = typedFailures(exit.cause).find(
      value => value instanceof
        FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
    );
    expect(failure).toMatchObject({
      stage,
      initialSettlementCause,
      resolutionCause,
    });
  }
}

function makeRepository(
  controlDb: FlarexMetadataDatabase,
  starter: FrameworkSchemaArtifactControlSessionStarter,
): FrameworkSchemaArtifactRepository {
  return Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: starter,
    ...TIMEOUT_POLICY,
  }));
}

function expectInvariantDefect(
  exit: Exit.Exit<unknown, unknown>,
  reason: string,
): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(defects(exit.cause)[0]).toMatchObject({ reason });
  }
}
