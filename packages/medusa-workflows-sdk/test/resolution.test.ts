import { describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { createStep, createWorkflow, isPreparedWorkflow, transform, when, WorkflowResponse, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";
import { proxify, referenceOf } from "../src/references";

/** SDK-owned Promise test bridge; typed failures, defects and interruption keep
 * Effect's normal runtime semantics, with full outcomes asserted through Exit. */
function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

const port: WorkflowExecutionPort<Error> = {
  checkpoint: Effect.void,
  capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause instanceof Error ? cause : new Error("Foreign callback failed") }),
  context: { container: { resolve() { throw new Error("No resource selected"); } }, eventGroupId: "resolution-test" },
};

describe("prepared workflow resolution", () => {
  it("assembles ordered records and arrays across async transforms without sharing frame results", async () => {
    const calls: number[] = [];
    const flow = createWorkflow("ordered-resolution", (input: WorkflowData<number>) => {
      const first = transform(input, async value => { calls.push(value); return { value, absent: undefined }; });
      const second = transform(input, value => { calls.push(value + 1); return value + 1; });
      return new WorkflowResponse({ values: [first.value, { second, again: first.value }], absent: first.absent, empty: [] });
    });
    const prepared = Result.getOrThrow(flow.prepare());
    expect(isPreparedWorkflow(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.resolution)).toBe(true);
    expect(Object.isFrozen(prepared.resolution.inputs)).toBe(true);
    expect(await runEffect(executeWorkflow(prepared, 3, port))).toEqual({ values: [3, { second: 4, again: 3 }], absent: undefined, empty: [] });
    expect(await runEffect(executeWorkflow(prepared, 8, port))).toEqual({ values: [8, { second: 9, again: 8 }], absent: undefined, empty: [] });
    expect(calls).toEqual([3, 4, 8, 9]);
  });

  it("keeps malformed guarded reference errors deferred and refuses the first reached member", async () => {
    const later = vi.fn(() => 2), capture = vi.fn(port.capture);
    const flow = createWorkflow("deferred-reference-refusal", (input: WorkflowData<boolean>) => {
      const selected = when("enabled", input, value => value).then(() => {
        const staged = transform(input, value => value);
        const reference = referenceOf(staged);
        if (reference?.guards === undefined) throw new Error("Missing staged branch guards");
        // Genuine private issuer, deliberately malformed callback metadata. The
        // skipped transform's input error must not become a preparation error.
        const missing = proxify({ kind: "property", owner: reference.owner, input });
        return proxify({ kind: "transform", owner: reference.owner, input: missing, guards: reference.guards });
      });
      return new WorkflowResponse([selected, transform(input, later)]);
    });
    const prepared = Result.getOrThrow(flow.prepare());
    expect(await runEffect(executeWorkflow(prepared, false, { ...port, capture }))).toEqual([undefined, 2]);
    later.mockClear(); capture.mockClear();
    await expect(runEffect(executeWorkflow(prepared, true, { ...port, capture }))).rejects.toMatchObject({ reason: "invalidReference", detail: "Missing property key" });
    expect(later).not.toHaveBeenCalled();
    // Only the condition input is captured; the malformed transform has not
    // reached its own input capture or callback.
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("captures a malformed transform input before refusing its absent callback", async () => {
    const captures: unknown[] = [];
    const later = vi.fn(() => 1);
    const flow = createWorkflow("missing-transformer", (input: WorkflowData<number>) => {
      const reference = referenceOf(input);
      if (reference === undefined) throw new Error("Missing input reference");
      const malformed = proxify({ kind: "transform", owner: reference.owner, input });
      return new WorkflowResponse({ first: malformed, later: transform(input, later) });
    });
    await expect(runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), 4, {
      ...port, capture: value => Effect.sync(() => { captures.push(value); return structuredClone(value); }),
    }))).rejects.toMatchObject({ reason: "invalidReference", detail: "Missing transformer" });
    expect(captures).toEqual([4]);
    expect(later).not.toHaveBeenCalled();
  });

  it("preserves the depth boundary and refuses foreign or unfinished references during definition capture", async () => {
    const make = (depth: number) => createWorkflow("reference-depth", (input: WorkflowData<{ value: unknown }>) => {
      let value: unknown = input;
      for (let index = 0; index < depth; index++) value = Reflect.get(Object(value), "value");
      return new WorkflowResponse(value);
    });
    let input: unknown = 7;
    for (let index = 0; index < 64; index++) input = { value: input };
    expect(await runEffect(executeWorkflow(Result.getOrThrow(make(64).prepare()), input, port))).toBe(7);
    expect(() => make(65)).toThrow("Definition bounds exceeded");
    let foreign: unknown;
    createWorkflow("reference-owner", (input: WorkflowData<number>) => new WorkflowResponse(foreign = input));
    expect(() => createWorkflow("foreign-reference", () => new WorkflowResponse(foreign))).toThrow("Reference belongs to another workflow");
    const step = createStep("first", () => 1);
    expect(() => createWorkflow("unfinished-reference", (input: WorkflowData<number>) => {
      const reference = referenceOf(input);
      if (reference === undefined) throw new Error("Missing input reference");
      step(proxify({ kind: "step", owner: reference.owner, step: Object.freeze({}) }));
      return new WorkflowResponse(null);
    })).toThrow("Reference precedes its step");
  });

  it("checks the final lifetime before resolving result callbacks and rejects copied prepared graphs", async () => {
    const callback = vi.fn((value: number) => value);
    const flow = createWorkflow("result-checkpoint", (input: WorkflowData<number>) => new WorkflowResponse(transform(input, callback)));
    const prepared = Result.getOrThrow(flow.prepare());
    const failure = new Error("Ended workflow");
    await expect(runEffect(executeWorkflow(prepared, 1, { ...port, checkpoint: Effect.fail(failure) }))).rejects.toBe(failure);
    expect(callback).not.toHaveBeenCalled();
    await expect(runEffect(executeWorkflow({ ...prepared }, 1, port))).rejects.toMatchObject({ reason: "invalidDefinition" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("interrupts a pending transform without visiting later members or retaining a partial frame cache", async () => {
    const reached = Deferred.makeUnsafe<void>();
    const blocked = Deferred.makeUnsafe<void>();
    const later = vi.fn((value: number) => value + 1);
    const first = vi.fn((value: number) => value);
    const flow = createWorkflow("interrupted-resolution", (input: WorkflowData<number>) =>
      new WorkflowResponse([transform(input, first), transform(input, later)]));
    const prepared = Result.getOrThrow(flow.prepare());
    const suspended: WorkflowExecutionPort<Error> = { ...port,
      invoke: work => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(blocked)), Effect.andThen(port.invoke(work))),
    };
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(executeWorkflow(prepared, 1, suspended));
      yield* Deferred.await(reached);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    })));
    expect(first).not.toHaveBeenCalled(); expect(later).not.toHaveBeenCalled();
    expect(await runEffect(executeWorkflow(prepared, 5, port))).toEqual([5, 6]);
    expect(first).toHaveBeenCalledTimes(1); expect(later).toHaveBeenCalledTimes(1);
  });
});
