import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { TaskSystemRunAttemptUnavailableError } from "../src/runAttempt/Errors.js";
import { RunAttemptLifecycleLive } from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { RunAttemptLifecycle } from "../src/runAttempt/Services/RunAttemptLifecycle.js";
import { JITTER, NOW, RUN_ID, RUN_VERSION_1, createDeterministicRunAttemptStore, readyAggregate } from "./support.js";

describe("RunAttemptLifecycle", () => {
  it("uses the scope-bound store transaction and returns persisted receipt data", async () => {
    const store = createDeterministicRunAttemptStore({ initial: readyAggregate() });
    const program = Effect.gen(function* () {
      const lifecycle = yield* RunAttemptLifecycle;
      const accepted = yield* lifecycle.startAttempt({
        type: "start_attempt", runId: RUN_ID, expectedRunVersion: RUN_VERSION_1, retryJitter: JITTER,
      });
      const replay = yield* lifecycle.startAttempt({
        type: "start_attempt", runId: RUN_ID, expectedRunVersion: RUN_VERSION_1, retryJitter: JITTER,
      });
      const inspection = yield* lifecycle.inspectCurrentAttempt({ type: "inspect_current_attempt", runId: RUN_ID });
      return { accepted, replay, inspection };
    }).pipe(
      Effect.provide(RunAttemptLifecycleLive),
      Effect.provide(store.layer),
    );
    const result = await Effect.runPromise(program);
    expect(result.accepted.disposition).toBe("accepted");
    expect(result.accepted.requestedEffects.map((effect) => effect.effect.kind)).toEqual([
      "dispatch_attempt", "wake_lease_expiry", "publish_lifecycle_event", "notify_current_state",
    ]);
    expect(result.replay).toEqual({ ...result.accepted, disposition: "idempotent" });
    expect(result.inspection.state.phase).toBe("attempt_granted");
    expect(store.writeCount()).toBe(1);
  });

  it("keeps identical run ids isolated by the dynamically supplied store Layer", async () => {
    const first = createDeterministicRunAttemptStore({ initial: readyAggregate() });
    const second = createDeterministicRunAttemptStore({ initial: readyAggregate() });
    const start = Effect.gen(function* () {
      const lifecycle = yield* RunAttemptLifecycle;
      return yield* lifecycle.startAttempt({
        type: "start_attempt", runId: RUN_ID, expectedRunVersion: RUN_VERSION_1, retryJitter: JITTER,
      });
    }).pipe(Effect.provide(RunAttemptLifecycleLive));
    await Effect.runPromise(start.pipe(Effect.provide(first.layer)));
    expect(first.current().phase).toBe("attempt_granted");
    expect(second.current().phase).toBe("ready");
    expect(second.writeCount()).toBe(0);
  });

  it("preserves closed store failures without invoking or mutating the decision state", async () => {
    const failure = new TaskSystemRunAttemptUnavailableError({
      operation: "start_attempt", runId: RUN_ID, reason: "unavailable",
    });
    const store = createDeterministicRunAttemptStore({ initial: readyAggregate(), transactionFailure: failure });
    const error = await Effect.runPromise(Effect.gen(function* () {
      const lifecycle = yield* RunAttemptLifecycle;
      return yield* lifecycle.startAttempt({
        type: "start_attempt", runId: RUN_ID, expectedRunVersion: RUN_VERSION_1, retryJitter: JITTER,
      });
    }).pipe(Effect.provide(RunAttemptLifecycleLive), Effect.provide(store.layer), Effect.flip));
    expect(error._tag).toBe("TaskSystemRunAttemptUnavailableError");
    expect(store.current().phase).toBe("ready");
    expect(store.writeCount()).toBe(0);
  });
});
