import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import {
  advanceCheckpointState, CheckpointError, runCheckpointTurn,
  type CheckpointBudget, type CheckpointCertificate, type CheckpointSource,
  type CheckpointState, type CheckpointStore,
} from "../src/checkpoint/index";

const namespaceId = "namespace-a";
const sourceId = "source-a";
const budget: CheckpointBudget = { sourceReads: 1, stateTransitions: 2, maximumElapsedMilliseconds: 10_000 };
const ready = (position: bigint, identity = sourceId): CheckpointState => ({
  kind: "ready", checkpoint: { sourceId: identity, position },
});
const certificate = (after: bigint | null, through: bigint): CheckpointCertificate => ({
  namespaceId, sourceId, after, through, retainedFrom: 0n,
});

/** Minimal adapter executes the actual pure transition owner atomically. */
function memoryStore(initial: CheckpointState | null = null) {
  let state = initial;
  let transitions = 0;
  const store: CheckpointStore = {
    inspect: Effect.sync(() => state),
    initialize: Effect.sync(() => { transitions++; return state ??= { kind: "initialized" }; }),
    advance: (expected, proof) => Effect.sync(() => {
      const verdict = advanceCheckpointState(namespaceId, state, expected, proof);
      return Result.map(verdict, next => { transitions++; state = next; return next; });
    }).pipe(Effect.flatMap(Effect.fromResult)),
  };
  return { store, inspect: () => state, transitions: () => transitions };
}

const turn = (store: CheckpointStore, source: CheckpointSource, options: Partial<{
  budget: CheckpointBudget; authorizeFreshInitialization: boolean;
}> = {}) => runCheckpointTurn({ namespaceId, store, source, budget,
  authorizeFreshInitialization: false, ...options });

describe("fixed-target checkpoint consumer", () => {
  it("requires explicit initialization and resumes without counting sparse positions", async () => {
    const fixture = memoryStore();
    let reads = 0;
    const source: CheckpointSource = { certify: request => Effect.sync(() => {
      reads++;
      return { kind: "certified", certificate: certificate(request.checkpoint?.position ?? null, 9_000_000n) };
    }) };
    await expect(Effect.runPromise(turn(fixture.store, source))).rejects.toMatchObject({ reason: "initializationRequired" });
    expect(fixture.inspect()).toBeNull();
    const first = await Effect.runPromise(turn(fixture.store, source, { authorizeFreshInitialization: true,
      budget: { ...budget, stateTransitions: 1 } }));
    expect(first).toMatchObject({ kind: "continuationRequired", reason: "stateTransitionLimitReached",
      progress: { sourceReads: 0, stateTransitions: 1, lastCheckpoint: null } });
    expect(reads).toBe(0);
    const resumed = await Effect.runPromise(turn(fixture.store, source));
    expect(resumed).toMatchObject({ kind: "caughtUp", target: { position: 9_000_000n },
      checkpoint: { position: 9_000_000n }, progress: { sourceReads: 1, stateTransitions: 1 } });
    await Effect.runPromise(turn(fixture.store, source));
    expect(reads).toBe(2);
    expect(fixture.inspect()).toEqual(ready(9_000_000n));
  });

  it("keeps one selected target while the synthetic source keeps publishing", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const fixture = memoryStore(ready(101n));
      let published = 10_001n;
      let reads = 0;
      const source: CheckpointSource = { certify: request => Effect.gen(function* () {
        const selected = published;
        reads++;
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return { kind: "certified", certificate: certificate(request.checkpoint?.position ?? null, selected) };
      }) };
      const running = yield* Effect.forkChild(turn(fixture.store, source));
      yield* Deferred.await(entered);
      published = 10_000_001n;
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(running);
      expect(result).toMatchObject({ kind: "caughtUp", target: { position: 10_001n } });
      expect(fixture.inspect()).toEqual(ready(10_001n));
      expect(reads).toBe(1);
      expect(published).toBeGreaterThan(10_001n);
    }));
  });

  it("preserves the newer checkpoint when source replies settle out of order", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const fixture = memoryStore(ready(101n));
      let reads = 0;
      const source: CheckpointSource = { certify: request => Effect.gen(function* () {
        const first = reads++ === 0;
        const through = first ? 6_000n : 40_000n;
        yield* Deferred.succeed(first ? firstEntered : secondEntered, undefined);
        yield* Deferred.await(first ? releaseFirst : releaseSecond);
        return { kind: "certified", certificate: certificate(request.checkpoint?.position ?? null, through) };
      }) };
      const first = yield* Effect.forkChild(turn(fixture.store, source));
      yield* Deferred.await(firstEntered);
      const second = yield* Effect.forkChild(turn(fixture.store, source));
      yield* Deferred.await(secondEntered);
      yield* Deferred.succeed(releaseSecond, undefined);
      expect(yield* Fiber.join(second)).toMatchObject({ kind: "caughtUp", target: { position: 40_000n } });
      yield* Deferred.succeed(releaseFirst, undefined);
      expect(yield* Fiber.join(first)).toMatchObject({ kind: "caughtUp", target: { position: 6_000n },
        checkpoint: { position: 40_000n } });
      // Independent schedule oracle: only the two emitted source targets can advance state.
      expect(fixture.inspect()).toEqual(ready(40_000n));
      expect(reads).toBe(2);
    }));
  });

  it.each(["historyUnavailable", "sourceReplaced"] as const)("preserves state on %s", async reason => {
    const fixture = memoryStore(ready(101n));
    const result = await Effect.runPromise(turn(fixture.store, {
      certify: () => Effect.succeed({ kind: "resetRequired", reason }),
    }));
    expect(result).toMatchObject({ kind: "resetRequired", reason });
    expect(fixture.inspect()).toEqual(ready(101n));
    expect(fixture.transitions()).toBe(0);
  });

  it("does not advance for partial, foreign or mismatched source evidence", async () => {
    const proofs = [
      { ...certificate(101n, 1_001n), namespaceId: "other" },
      { ...certificate(101n, 1_001n), sourceId: "other" },
      certificate(100n, 1_001n), certificate(101n, 100n),
      { ...certificate(101n, 1_001n), retainedFrom: 102n },
      { ...certificate(101n, 1_001n), retainedFrom: -1n },
    ];
    for (const proof of proofs) {
      const fixture = memoryStore(ready(101n));
      await expect(Effect.runPromise(turn(fixture.store, { certify: () => Effect.succeed({
        kind: "certified", certificate: proof,
      }) }))).rejects.toMatchObject({ reason: "invalidEvidence" });
      expect(fixture.transitions()).toBe(0);
    }
  });

  it("refuses changed durable source identity and local state rollback", () => {
    for (const current of [null, { kind: "initialized" } as const, ready(100n), ready(2_000n, "replacement")]) {
      expect(advanceCheckpointState(namespaceId, current, ready(101n), certificate(101n, 1_001n)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "stateConflict" } });
    }
  });

  it("does not skip newly established progress with a fresh certificate from a cold source", () => {
    const result = advanceCheckpointState(namespaceId, ready(10n), { kind: "initialized" }, {
      ...certificate(null, 30n), retainedFrom: 20n,
    });
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "stateConflict" } });
  });

  it("stops before source work when write or source budget is exhausted", async () => {
    let reads = 0;
    const source: CheckpointSource = { certify: () => Effect.sync(() => {
      reads++; return { kind: "certified", certificate: certificate(101n, 1_001n) };
    }) };
    for (const limits of [{ sourceReads: 0, stateTransitions: 1 }, { sourceReads: 1, stateTransitions: 0 }]) {
      const fixture = memoryStore(ready(101n));
      expect(await Effect.runPromise(turn(fixture.store, source, { budget: { ...budget, ...limits } })))
        .toMatchObject({ kind: "continuationRequired", progress: { sourceReads: 0, stateTransitions: 0 } });
      expect(fixture.transitions()).toBe(0);
    }
    expect(reads).toBe(0);
  });

  it("times out a blocked read and waits for cancellation cleanup", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const fixture = memoryStore(ready(101n));
      let cleaned = false;
      const source: CheckpointSource = { certify: () => Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { cleaned = true; })),
      ) };
      const running = yield* Effect.forkChild(turn(fixture.store, source, {
        budget: { ...budget, maximumElapsedMilliseconds: 10 },
      }));
      yield* Deferred.await(entered);
      yield* TestClock.adjust("10 millis");
      expect(yield* Fiber.join(running)).toMatchObject({ kind: "continuationRequired", reason: "deadlineReached" });
      expect(cleaned).toBe(true);
      expect(fixture.transitions()).toBe(0);
    }).pipe(Effect.provide(TestClock.layer())));
  });

  it("preserves source failures and defects instead of treating them as reset", async () => {
    const failure = new CheckpointError({ reason: "sourceUnavailable" });
    const defect = new Error("source defect");
    const fixture = memoryStore(ready(101n));
    const result = await Effect.runPromiseExit(turn(fixture.store, {
      certify: () => Effect.failCause(Cause.combine(Cause.fail(failure), Cause.die(defect))),
    }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons).toHaveLength(2);
      expect(result.cause.reasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ error: failure }), expect.objectContaining({ defect }),
      ]));
    }
    expect(fixture.transitions()).toBe(0);
  });

  it("reinspects settled progress after a lost acknowledgement without automatic replay", async () => {
    const fixture = memoryStore(ready(101n));
    let calls = 0;
    const observedAfter: Array<bigint | undefined> = [];
    const source: CheckpointSource = { certify: request => Effect.sync(() => {
      observedAfter.push(request.checkpoint?.position);
      return { kind: "certified", certificate: certificate(request.checkpoint?.position ?? null, 10_001n) };
    }) };
    const uncertain: CheckpointStore = { ...fixture.store,
      advance: (expected, proof) => fixture.store.advance(expected, proof).pipe(
        Effect.tap(() => Effect.sync(() => { calls++; })),
        Effect.andThen(Effect.fail(new CheckpointError({ reason: "storageUnavailable" }))),
      ),
    };
    await expect(Effect.runPromise(turn(uncertain, source))).rejects.toMatchObject({ reason: "storageUnavailable" });
    expect(calls).toBe(1);
    expect(fixture.inspect()).toEqual(ready(10_001n));
    expect(await Effect.runPromise(turn(fixture.store, source))).toMatchObject({ kind: "caughtUp" });
    expect(observedAfter).toEqual([101n, 10_001n]);
  });

  it("preserves source cleanup failure together with external interruption", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const cleanup = new CheckpointError({ reason: "sourceUnavailable" });
      const fixture = memoryStore(ready(101n));
      const source: CheckpointSource = { certify: () => Effect.acquireUseRelease(
        Effect.void,
        () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        () => Effect.fail(cleanup),
      ) };
      const running = yield* Effect.forkChild(turn(fixture.store, source));
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(running);
      const result = yield* Fiber.await(running);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(Cause.hasInterrupts(result.cause)).toBe(true);
        expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === cleanup)).toBe(true);
      }
      expect(fixture.transitions()).toBe(0);
    }));
  });

  it("preserves an unrelated interruption in source cleanup at the deadline", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const fixture = memoryStore(ready(101n));
      const source: CheckpointSource = { certify: () => Effect.acquireUseRelease(
        Effect.void,
        () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        () => Effect.failCause(Cause.interrupt(999999)),
      ) };
      const running = yield* Effect.forkChild(turn(fixture.store, source, {
        budget: { ...budget, maximumElapsedMilliseconds: 10 },
      }));
      yield* Deferred.await(entered);
      yield* TestClock.adjust("10 millis");
      const result = yield* Fiber.await(running);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) expect(result.cause.reasons.some(reason =>
        Cause.isInterruptReason(reason) && reason.fiberId === 999999)).toBe(true);
      expect(fixture.transitions()).toBe(0);
    }).pipe(Effect.provide(TestClock.layer())));
  });
});
