import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import {
  PhysicalSessionObservation, observePhysicalSessionEffect,
  type PhysicalSessionObservationEvent,
} from "../src/physicalSession/observation";
import { runEffect } from "./effectTestRuntime";

it("keeps absent observation identity and observed execution lazy", async () => {
  let executions = 0;
  const events: PhysicalSessionObservationEvent[] = [];
  const work = Effect.sync(() => { executions++; return 7; });
  expect(observePhysicalSessionEffect(undefined, "drain", work)).toBe(work);
  const observation = new PhysicalSessionObservation({ record: event => { events.push(event); } });
  const observed = observePhysicalSessionEffect(observation, "drain", work);
  expect(executions).toBe(0);
  expect(events).toEqual([]);
  expect(await runEffect(observed)).toBe(7);
  expect(executions).toBe(1);
  expect(events).toEqual([
    { kind: "phase", phase: "drain", edge: "begin" },
    { kind: "phase", phase: "drain", edge: "end", outcome: "success" },
  ]);
  expect(events.every(Object.isFrozen)).toBe(true);
  observation.assertHealthy();
});

it("classifies returned failure verdicts without replacing the business value", async () => {
  const events: PhysicalSessionObservationEvent[] = [];
  const observation = new PhysicalSessionObservation({ record: event => { events.push(event); } });
  const failure = Object.freeze({ kind: "failed", cause: new Error("private resource failure") });
  const result = await runEffect(observePhysicalSessionEffect(observation, "release",
    Effect.succeed(failure), value => value.kind === "failed"));
  expect(result).toBe(failure);
  expect(events.at(-1)).toEqual({ kind: "phase", phase: "release", edge: "end", outcome: "failure" });
  expect(JSON.stringify(events)).not.toContain("private resource failure");
});

it("isolates edge delivery faults while preserving the complete Cause and finalizers", async () => {
  const firstFault = new Error("observer first fault");
  const observation = new PhysicalSessionObservation({ record: () => { throw firstFault; } });
  const cause = Cause.combine(Cause.fail({ _tag: "BusinessRefusal" }), Cause.die(new Error("business defect")));
  let finalized = 0;
  const work = Effect.failCause(cause).pipe(Effect.ensuring(Effect.sync(() => { finalized++; })));
  const exit = await runEffect(Effect.exit(observePhysicalSessionEffect(observation, "quarantine", work)));
  expect(Exit.isFailure(exit) && exit.cause).toBe(cause);
  expect(finalized).toBe(1);
  expect(observation.status()).toEqual({ failureCount: 2 });
  expect(() => observation.assertHealthy()).toThrow(expect.objectContaining({ cause: firstFault }));
});

it("finishes observation after interruption and a failing finalizer without observer Cause changes", async () => {
  const events: PhysicalSessionObservationEvent[] = [];
  const finalizerDefect = new Error("finalizer defect");
  const observation = new PhysicalSessionObservation({ record: event => { events.push(event); throw new Error("delivery fault"); } });
  const exit = await runEffect(Effect.exit(observePhysicalSessionEffect(observation, "cancel",
    Effect.interrupt.pipe(Effect.ensuring(Effect.die(finalizerDefect))))));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([finalizerDefect]);
  }
  expect(events.map(event => event.edge)).toEqual(["begin", "end"]);
  expect(events.at(-1)?.outcome).toBe("failure");
  expect(observation.status().failureCount).toBe(2);
});

it("diagnoses decorator construction faults before running the original work exactly once", async () => {
  let executions = 0;
  const fault = new Error("decorator construction fault");
  const observation = new PhysicalSessionObservation({ record: () => undefined,
    traceEffect: () => { throw fault; } });
  const work = Effect.sync(() => { executions++; return "settled"; });
  const observed = observePhysicalSessionEffect(observation, "release", work);
  expect(observed).toBe(work);
  expect(executions).toBe(0);
  expect(await runEffect(observed)).toBe("settled");
  expect(executions).toBe(1);
  expect(observation.status()).toEqual({ failureCount: 1 });
  expect(() => observation.assertHealthy()).toThrow(expect.objectContaining({ cause: fault }));
});

it("keeps a successful Exit when its diagnostic verdict predicate throws", async () => {
  const events: PhysicalSessionObservationEvent[] = [];
  const observation = new PhysicalSessionObservation({ record: event => { events.push(event); } });
  const value = Object.freeze({ kind: "failed" });
  const fault = new Error("diagnostic verdict predicate failed");
  const exit = await runEffect(Effect.exit(observePhysicalSessionEffect(observation, "drain",
    Effect.succeed(value), () => { throw fault; })));
  expect(Exit.isSuccess(exit) && exit.value).toBe(value);
  expect(events).toEqual([
    { kind: "phase", phase: "drain", edge: "begin" },
    { kind: "phase", phase: "drain", edge: "end" },
  ]);
  expect(observation.status()).toEqual({ failureCount: 1 });
  expect(() => observation.assertHealthy()).toThrow(expect.objectContaining({ cause: fault }));
});
