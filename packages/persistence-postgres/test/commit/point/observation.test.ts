import { Cause, Effect, Exit, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import {
  PointCommitPublicationObservation,
  observePointCommitPublicationEffect,
  observePointCommitPublicationPromise,
  type PointCommitPublicationEvent,
} from "../../../src/commit/point/observation";

describe("point-commit publication diagnostic isolation", () => {
  it("lets trusted composition replace Effect phase events without changing failure or channels", async () => {
    const cause = Cause.combine(Cause.fail({ _tag: "BusinessRefusal" }), Cause.die(new Error("business defect")));
    const events: PointCommitPublicationEvent[] = [];
    const spans: Tracer.NativeSpan[] = [];
    const observation = new PointCommitPublicationObservation({ detail: true, record: event => events.push(event),
      traceEffect: (phase, work) => Effect.useSpan(`publication.${phase}`, span =>
        Effect.provideService(work, Tracer.ParentSpan, span)) });
    const tracer = Tracer.make({ span: options => {
      const span = new Tracer.NativeSpan(options); spans.push(span); return span;
    } });
    const exit = await Effect.runPromiseExit(observePointCommitPublicationEffect(observation, "transaction",
      Effect.failCause(cause)).pipe(Effect.provideService(Tracer.Tracer, tracer)));
    expect(Exit.isFailure(exit) && exit.cause).toBe(cause);
    expect(events).toEqual([]);
    expect(spans.map(span => span.name)).toEqual(["publication.transaction"]);
    expect(spans[0]?.status._tag).toBe("Ended");
    const broken = new PointCommitPublicationObservation({ detail: true, record: () => undefined,
      traceEffect: () => { throw new Error("diagnostic construction failure"); } });
    const work = Effect.failCause(cause);
    expect(observePointCommitPublicationEffect(broken, "transaction", work)).toBe(work);
    const unchanged = await Effect.runPromiseExit(observePointCommitPublicationEffect(broken, "transaction", work));
    expect(Exit.isFailure(unchanged) && unchanged.cause).toBe(cause);
    expect(broken.status().failureCount).toBe(2);
  });
  it("delivers detached frozen scalars and retains only bounded failure status", () => {
    const events: PointCommitPublicationEvent[] = [];
    const observation = new PointCommitPublicationObservation({ detail: true, record: event => { events.push(event); } });
    const counts = { rows: 3 };
    observation.record({ kind: "counts", owner: "plan", counts });
    counts.rows = 99;
    expect(events).toEqual([{ kind: "counts", owner: "plan", counts: { rows: 3 } }]);
    const event = events[0];
    expect(Object.isFrozen(event)).toBe(true);
    expect(event?.kind !== "phase" && Object.isFrozen(event?.counts)).toBe(true);
    const firstFailure = new Error("diagnostic first");
    let calls = 0;
    const broken = new PointCommitPublicationObservation({ detail: true, record: () => {
      throw calls++ === 0 ? firstFailure : new Error("diagnostic later");
    } });
    broken.record({ kind: "phase", phase: "transaction", edge: "begin" });
    broken.record({ kind: "phase", phase: "transaction", edge: "end" });
    expect(broken.status()).toEqual({ failureCount: 2 });
    expect(Object.keys(broken.status())).toEqual(["failureCount"]);
    expect(() => broken.assertHealthy()).toThrow(expect.objectContaining({ cause: firstFailure }));
  });

  it("keeps the exact absent Effect and Promise and suppresses detailed events in quiet mode", async () => {
    const work = Effect.succeed(7);
    expect(observePointCommitPublicationEffect(undefined, "transaction", work)).toBe(work);
    const promise = Promise.resolve(7);
    let evaluations = 0;
    expect(observePointCommitPublicationPromise(undefined, "transaction", () => { evaluations++; return promise; })).toBe(promise);
    expect(evaluations).toBe(1);
    const events: PointCommitPublicationEvent[] = [];
    const quiet = new PointCommitPublicationObservation({ detail: false, record: event => { events.push(event); } });
    quiet.record({ kind: "counts", owner: "plan", counts: { rows: 7 } });
    await Effect.runPromise(observePointCommitPublicationEffect(quiet, "transaction", work));
    expect(events).toEqual([{ kind: "phase", phase: "transaction", edge: "begin" },
      { kind: "phase", phase: "transaction", edge: "end" }]);
    quiet.assertHealthy();
  });

  it("preserves typed failure, defect and interruption Causes when delivery fails on both edges", async () => {
    const typed = new Error("business failure");
    const defect = new Error("business defect");
    const broken = new PointCommitPublicationObservation({ detail: false, record: () => { throw new Error("observer defect"); } });
    for (const work of [Effect.fail(typed), Effect.die(defect), Effect.interrupt]) {
      const expected = await Effect.runPromiseExit(work);
      const actual = await Effect.runPromiseExit(observePointCommitPublicationEffect(broken, "transaction", work));
      expect(Exit.isFailure(expected) && Exit.isFailure(actual)).toBe(true);
      if (Exit.isFailure(expected) && Exit.isFailure(actual)) {
        expect(Cause.hasInterrupts(actual.cause)).toBe(Cause.hasInterrupts(expected.cause));
        expect(Cause.hasDies(actual.cause)).toBe(Cause.hasDies(expected.cause));
        // Fiber identifiers differ between executions; typed/defect values must
        // remain the genuine business values with no observer reason appended.
        expect(actual.cause.reasons.map(reason => reason._tag)).toEqual(expected.cause.reasons.map(reason => reason._tag));
        if (!Cause.hasInterrupts(actual.cause)) expect(actual.cause).toEqual(expected.cause);
      }
    }
    expect(broken.status()).toEqual({ failureCount: 6 });
    await expect(observePointCommitPublicationPromise(broken, "transaction", () => Promise.reject(typed))).rejects.toBe(typed);
  });
});
