import { describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { createHook, createStep, createWorkflow, isPreparedWorkflow, StepResponse, transform, when, WorkflowResponse, type WorkflowData } from "../src/index";
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
  it("snapshots bare native transform Dates as ISO strings before the next callback", async () => {
    const date = new Date("2026-10-19T01:00:00.000Z"), seen: unknown[] = [];
    const receive = createStep("native-transform-date-receiver", (input: unknown) => {
      seen.push(input); date.setTime(0); return new StepResponse(input);
    });
    const flow = createWorkflow("native-transform-date", () => new WorkflowResponse(receive(transform({}, () => ({
      shipped_at: date, positional: [date],
    })))));
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual({
      shipped_at: "2026-10-19T01:00:00.000Z", positional: ["2026-10-19T01:00:00.000Z"],
    });
    expect(seen).toEqual([{ shipped_at: "2026-10-19T01:00:00.000Z", positional: ["2026-10-19T01:00:00.000Z"] }]);
  });

  it("refuses invalid, decorated and counterfeit transform Dates without invoking custom serialization", async () => {
    const custom = vi.fn(() => "not-native"), decorated = new Date(0);
    Object.defineProperty(decorated, "toJSON", { get: custom });
    class DerivedDate extends Date {}
    for (const date of [new Date(Number.NaN), decorated, Object.create(Date.prototype), new DerivedDate(0)]) {
      const next = vi.fn(() => new StepResponse(null)), receive = createStep("refused-date-receiver", next);
      const flow = createWorkflow("refused-transform-date", () => new WorkflowResponse(receive(transform({}, () => ({ date })))));
      await expect(runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).rejects.toMatchObject({ reason: "invalidReference" });
      expect(next).not.toHaveBeenCalled();
    }
    expect(custom).not.toHaveBeenCalled();
  });

  // Frozen native136 SDK differential, pin48d5cc675e4e8bc821e22c20c88a751acc66fb5f:
  // create-step-handler's stored response -> resolve-value -> WorkflowResponse.
  // These are actual native result shapes, including the surprising raw-void
  // marker; they are not derived by calling the portable representation helper.
  it("preserves the native distinction between raw void/null and explicit StepResponse outputs", async () => {
    const rawVoid = createStep("native-raw-void", () => undefined);
    const rawNull = createStep("native-raw-null", () => null);
    const wrappedVoid = createStep("native-wrapped-void", () => new StepResponse(undefined));
    const wrappedNull = createStep("native-wrapped-null", () => new StepResponse(null));
    const flow = createWorkflow("native-callback-output-kinds", () => new WorkflowResponse({
      rawVoid: rawVoid(undefined), rawNull: rawNull(undefined), wrappedVoid: wrappedVoid(undefined), wrappedNull: wrappedNull(undefined),
      literal: undefined,
    }));
    const result = await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port));
    expect(result).toEqual({ rawVoid: { __type: "Symbol(WorkflowWorkflowData)" },
      rawNull: { __type: "Symbol(WorkflowWorkflowData)", output: null }, wrappedNull: null, literal: undefined });
    expect(Object.hasOwn(Object(result), "wrappedVoid")).toBe(false);
    expect(Object.hasOwn(Object(result), "literal")).toBe(true);
  });

  it.each([false, 0, "", [], { id: "actual-value" }].map(value => ({ value })))("keeps non-nullish raw and wrapped callback output $value", async ({ value }) => {
    const raw = createStep("native-falsy-raw", () => value);
    const wrapped = createStep("native-falsy-wrapped", () => new StepResponse(value));
    const flow = createWorkflow("native-non-nullish-output", () => new WorkflowResponse({ raw: raw(undefined), wrapped: wrapped(undefined) }));
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual({ raw: value, wrapped: value });
  });

  it("keeps direct and ignored void results undefined without turning literal null into a callback marker", async () => {
    const raw = createStep("ignored-native-void", () => undefined);
    const ignored = createWorkflow("ignored-native-callback", () => { raw(undefined); return new WorkflowResponse(undefined); });
    const direct = createWorkflow("direct-native-void", () => new WorkflowResponse(undefined));
    const nullable = createWorkflow("direct-native-null", () => new WorkflowResponse(null));
    for (const flow of [ignored, direct]) expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toBeUndefined();
    expect(await runEffect(executeWorkflow(Result.getOrThrow(nullable.prepare()), undefined, port))).toBeNull();
  });

  it("captures actual retained inputs before omitting explicit void record members and keeps array positions", async () => {
    const compensation = ["retained-native-id"], captures: unknown[] = [];
    const wrapped = createStep("native-void-with-retained", () => new StepResponse(undefined, compensation));
    const flow = createWorkflow("native-retained-void-projection", () => {
      const result = wrapped(undefined);
      return new WorkflowResponse({ omitted: result, positional: [result, undefined], literal: undefined });
    });
    const result = await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, {
      ...port, capture: value => Effect.sync(() => { const captured = structuredClone(value); captures.push(captured); return captured; }),
    }));
    expect(result).toEqual({ positional: [undefined, undefined], literal: undefined });
    expect(Object.hasOwn(Object(result), "omitted")).toBe(false);
    expect(captures).toContainEqual({ output: undefined, compensation: ["retained-native-id"] });
    compensation.push("later-caller-mutation");
    expect(captures).toContainEqual({ output: undefined, compensation: ["retained-native-id"] });
  });

  it("passes omitted native void members to transformers without dropping literal undefined", async () => {
    const wrapped = createStep("native-transform-void", () => new StepResponse(undefined));
    const inspect = vi.fn((value: { omitted?: undefined; literal: undefined }) => ({ keys: Object.keys(value), literal: value.literal }));
    const flow = createWorkflow("native-void-transform-input", () => {
      const output = wrapped(undefined);
      return new WorkflowResponse(transform({ omitted: output, literal: undefined }, inspect));
    });
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual({ keys: ["literal"], literal: undefined });
    expect(inspect).toHaveBeenCalledWith({ literal: undefined }, port.context);
  });

  it("keeps skipped references distinct from executed void callbacks", async () => {
    const callback = vi.fn(() => new StepResponse(undefined));
    const step = createStep("native-guarded-void", callback);
    const flow = createWorkflow("native-skipped-void", (input: WorkflowData<boolean>) => {
      const selected = when("native-void-enabled", input, enabled => enabled).then(() => step(undefined));
      return new WorkflowResponse({ selected, literal: undefined });
    });
    const prepared = Result.getOrThrow(flow.prepare());
    const skipped = await runEffect(executeWorkflow(prepared, false, port));
    expect(skipped).toEqual({ selected: undefined, literal: undefined });
    expect(Object.hasOwn(Object(skipped), "selected")).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(await runEffect(executeWorkflow(prepared, true, port))).toEqual({ literal: undefined });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("keeps child and folded hook void results explicit while omitting their nested record slots", async () => {
    const child = createWorkflow("native-void-child", () => new WorkflowResponse(undefined));
    const parent = createWorkflow("native-void-parent", () => {
      const hook = createHook("native-void-hook", {});
      return new WorkflowResponse({ child: child.runAsStep({ input: undefined }), hook: hook.getResult(), literal: undefined }, { hooks: [hook] });
    });
    const expected = { literal: undefined };
    expect(await runEffect(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, port))).toEqual(expected);
    expect(await runEffect(executeWorkflow(Result.getOrThrow(parent.prepare({ "native-void-hook": () => new StepResponse(undefined) })), undefined, port))).toEqual(expected);
    const direct = createWorkflow("native-direct-child-void", () => new WorkflowResponse(child.runAsStep({ input: undefined })));
    expect(await runEffect(executeWorkflow(Result.getOrThrow(direct.prepare()), undefined, port))).toBeUndefined();
  });

  it.each([
    { value: { __type: "Symbol(WorkflowStepResponse)", output: undefined, compensation: ["data-only"] } },
    { value: { __type: "Symbol(WorkflowWorkflowData)", output: null, extra: "ordinary-input" } },
    { value: { __type: "Symbol(WorkflowWorkflowData)", undefinedStepResult: true, output: undefined } },
  ])("does not interpret caller marker data as StepResponse or omission provenance: $value.__type", async ({ value: input }) => {
    const step = createStep("native-data-marker", (value: unknown) => value);
    const flow = createWorkflow("native-untrusted-marker-data", (input: WorkflowData<unknown>) => new WorkflowResponse({ result: step(input), literal: undefined }));
    const result = await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), input, port));
    expect(result).toEqual({ result: input, literal: undefined });
    expect(Object.hasOwn(Object(result), "result")).toBe(true);
  });

  it("does not let native void omission bypass retained-value capture failure or run later callbacks", async () => {
    const wrapped = createStep("native-refused-retained", () => new StepResponse(undefined, ["refused-retained-id"]));
    const later = vi.fn(() => "later"), next = createStep("native-after-retained", later);
    const flow = createWorkflow("native-retained-capture-refusal", () => { wrapped(undefined); return new WorkflowResponse(next(undefined)); });
    const failure = new Error("Retained input capture refused");
    await expect(runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, { ...port,
      capture: value => typeof value === "object" && value !== null && "compensation" in value ? Effect.fail(failure) : port.capture(value),
    }))).rejects.toBe(failure);
    expect(later).not.toHaveBeenCalled();
  });

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
