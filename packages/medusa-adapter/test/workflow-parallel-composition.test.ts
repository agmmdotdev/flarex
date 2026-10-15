import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Deferred, Effect, Fiber, Result } from "effect";
import { createHook, createStep, createWorkflow, parallelize, transform, when, WorkflowResponse, type Resolved, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";

const port: WorkflowExecutionPort<Error> = {
  checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause instanceof Error ? cause : new Error("Foreign callback failed", { cause }) }),
  context: { container: { resolve() { throw new Error("No resources selected"); } }, eventGroupId: "one-parallel-root" },
};

describe("native parallel workflow composition", () => {
  it("enters both child frames before either finishes and returns positional results on the same root port", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    let entered = 0;
    const step = createStep("work", async (value: number, context) => {
      expect(context).toBe(port.context);
      if (++entered === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return value;
    });
    const child = createWorkflow("child", (input: WorkflowData<number>) => new WorkflowResponse(step(input)));
    const parent = createWorkflow("parent", () => new WorkflowResponse(parallelize(
      child.runAsStep({ input: 10 }).config({ name: "left" }), child.runAsStep({ input: 20 }).config({ name: "right" }),
    )));
    const prepared = Result.getOrThrow(parent.prepare());
    expect(prepared.nodeCount).toBe(4);
    expect(await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(executeWorkflow(prepared, undefined, port));
      yield* Deferred.await(reached).pipe(Effect.timeout(2_000));
      expect(entered).toBe(2); yield* Deferred.succeed(release, undefined);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))))).toEqual([10, 20]);
  });

  it("single-flights a shared asynchronous parent transform while isolating each child's caches and hooks", async () => {
    const shared = vi.fn(async (value: number) => { await Promise.resolve(); return value + 1; });
    const evaluateChild = vi.fn((value: number) => value * 2);
    const child = createWorkflow("cached-child", (input: WorkflowData<number>) => {
      const value = transform(input, evaluateChild), hook = createHook<"done", number, string>("done", value);
      return new WorkflowResponse({ value, repeated: value, hook: hook.getResult() }, { hooks: [hook] });
    });
    const parent = createWorkflow("cached-parent", (input: WorkflowData<number>) => {
      const value = transform(input, shared);
      return new WorkflowResponse(parallelize(
        child.runAsStep({ input: value, hooks: { done: () => "left" } }).config({ name: "left" }),
        child.runAsStep({ input: value, hooks: { done: () => "right" } }).config({ name: "right" }),
      ));
    });
    const prepared = Result.getOrThrow(parent.prepare());
    for (const input of [3, 7]) expect(await Effect.runPromise(executeWorkflow(prepared, input, port))).toEqual([
      { value: (input + 1) * 2, repeated: (input + 1) * 2, hook: "left" },
      { value: (input + 1) * 2, repeated: (input + 1) * 2, hook: "right" },
    ]);
    expect(shared).toHaveBeenCalledTimes(2); expect(evaluateChild).toHaveBeenCalledTimes(4);
  });

  it("keeps a failing shared transform single-flight and preserves its original error", async () => {
    const failure = new Error("normalization failed"), normalize = vi.fn(async (): Promise<number> => { await Promise.resolve(); throw failure; });
    const child = createWorkflow("shared-failure-child", (input: WorkflowData<number>) => new WorkflowResponse(input));
    const parent = createWorkflow("shared-failure-parent", () => {
      const input = transform(undefined, normalize);
      return new WorkflowResponse(parallelize(child.runAsStep({ input }).config({ name: "left" }), child.runAsStep({ input }).config({ name: "right" })));
    });
    const exit = await Effect.runPromise(Effect.exit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, port)));
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(exit._tag === "Failure" && exit.cause.reasons.some(reason => reason._tag === "Fail" && reason.error === failure)).toBe(true);
  });

  it("groups native two-argument conditions and skips every callback and input transform of a false region", async () => {
    const skipped = vi.fn(() => 99), predicate = vi.fn(() => true), reached = vi.fn((value: number) => value);
    const step = createStep("reached", reached);
    const child = createWorkflow("conditional-child", (input: WorkflowData<number>) => new WorkflowResponse(when("inner", input, predicate).then(() => step(input))));
    const parent = createWorkflow("conditional-parent", () => {
      const values = parallelize(
        when({ enabled: false }, value => value.enabled).then(() => child.runAsStep({ input: transform(undefined, skipped) }).config({ name: "skipped" })),
        when({ enabled: true }, value => value.enabled).then(() => child.runAsStep({ input: 5 }).config({ name: "reached-child" })),
      );
      return new WorkflowResponse(transform(values, values => {
        expectTypeOf<Resolved<typeof values[0]>>().toEqualTypeOf<number | undefined>();
        return values;
      }));
    });
    const prepared = Result.getOrThrow(parent.prepare());
    expect(await Effect.runPromise(executeWorkflow(prepared, undefined, port))).toEqual([undefined, 5]);
    expect(skipped).not.toHaveBeenCalled(); expect(predicate).toHaveBeenCalledTimes(1); expect(reached).toHaveBeenCalledTimes(1);
    expect(prepared.nodes.filter(node => node.kind === "condition").map(node => node.name)).toEqual(["when-0", "when-1"]);
  });

  it("interprets nested groups only in their selected outer branch", async () => {
    const invoke = vi.fn((value: number) => value), leaf = createStep("leaf", invoke);
    const child = createWorkflow("nested-leaf", (input: WorkflowData<number>) => new WorkflowResponse(leaf(input)));
    const parent = createWorkflow("nested-groups", (enabled: WorkflowData<boolean>) => new WorkflowResponse(parallelize(
      when("outer", enabled, value => value).then(() => parallelize(
        child.runAsStep({ input: 1 }).config({ name: "inner-left" }), child.runAsStep({ input: 2 }).config({ name: "inner-right" }),
      )),
      child.runAsStep({ input: 3 }).config({ name: "outside" }),
    )));
    const prepared = Result.getOrThrow(parent.prepare());
    expect(await Effect.runPromise(executeWorkflow(prepared, false, port))).toEqual([undefined, 3]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await Effect.runPromise(executeWorkflow(prepared, true, port))).toEqual([[1, 2], 3]);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it.each(["failure", "defect"] as const)("retains the initiating %s Cause and joins interrupted sibling finalizers", async kind => {
    const reached = Deferred.makeUnsafe<void>(), finalized: string[] = [], initiating = new Error("initiating " + kind);
    const step = createStep("marker", (value: string) => value);
    const child = createWorkflow("failure-child", (input: WorkflowData<string>) => new WorkflowResponse(step(input)));
    const later = vi.fn(), after = createStep("after", later);
    const parent = createWorkflow("failure-parent", () => {
      parallelize(child.runAsStep({ input: "wait" }).config({ name: "waiting" }), child.runAsStep({ input: "fail" }).config({ name: "failing" }));
      return new WorkflowResponse(after(undefined));
    });
    const controlled: WorkflowExecutionPort<Error> = { ...port, invoke: work => Effect.gen(function* () {
      const marker = yield* Effect.try({ try: work, catch: cause => cause instanceof Error ? cause : new Error("unexpected", { cause }) });
      if (marker === "wait") return yield* Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(() => { finalized.push("waiting"); })));
      yield* Deferred.await(reached);
      return yield* (kind === "failure" ? Effect.fail(initiating) : Effect.die(initiating));
    }) };
    const exit = await Effect.runPromise(Effect.exit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, controlled)));
    expect(finalized).toEqual(["waiting"]); expect(later).not.toHaveBeenCalled();
    expect(exit._tag === "Failure" && exit.cause.reasons.some(reason => kind === "failure"
      ? reason._tag === "Fail" && reason.error === initiating : reason._tag === "Die" && reason.defect === initiating)).toBe(true);
  });

  it("joins every running sibling on parent interruption without reaching its final checkpoint", async () => {
    const reached = Deferred.makeUnsafe<void>(); let entered = 0, finalized = 0, checkpoint = 0;
    const step = createStep("wait", () => null), child = createWorkflow("cancel-child", () => new WorkflowResponse(step(undefined)));
    const parent = createWorkflow("cancel-parent", () => new WorkflowResponse(parallelize(
      child.runAsStep({ input: undefined }).config({ name: "left" }), child.runAsStep({ input: undefined }).config({ name: "right" }),
    )));
    const controlled: WorkflowExecutionPort<Error> = { ...port, checkpoint: Effect.sync(() => { checkpoint++; }),
      invoke: work => Effect.gen(function* () { work(); if (++entered === 2) yield* Deferred.succeed(reached, undefined);
        return yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => { finalized++; }))); }) };
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, controlled));
      yield* Deferred.await(reached).pipe(Effect.timeout(2_000)); yield* Fiber.interrupt(fiber);
    })));
    expect(entered).toBe(2); expect(finalized).toBe(2); expect(checkpoint).toBe(0);
  });

  it("rejects foreign, duplicate, gapped and dependent sibling regions before execution", () => {
    const invoke = vi.fn((value: unknown) => value), step = createStep("step", invoke);
    expect(() => parallelize(undefined, undefined)).toThrow("Use inside createWorkflow");
    expect(() => createWorkflow("duplicate-region", () => { const a = step(1); return new WorkflowResponse(parallelize(a, a)); })).toThrow("non-overlapping");
    expect(() => createWorkflow("gapped-regions", () => { const a = step(1).config({ name: "a" }); step(2).config({ name: "gap" });
      return new WorkflowResponse(parallelize(a, step(3).config({ name: "b" }))); })).toThrow("consecutive");
    expect(() => createWorkflow("dependent-regions", () => { const a = step(1).config({ name: "a" });
      return new WorkflowResponse(parallelize(a, step(a).config({ name: "b" }))); })).toThrow("precedes its step");
    let foreign: WorkflowData<unknown> | undefined;
    createWorkflow("foreign-owner", () => new WorkflowResponse(foreign = step(1)));
    expect(() => createWorkflow("foreign-region", () => new WorkflowResponse(parallelize(foreign, step(2))))).toThrow("this composer's staged steps");
    expect(() => createWorkflow("undefined-region", () => new WorkflowResponse(parallelize(undefined, step(2))))).toThrow("staged steps");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("binds explicit parallel arrangement into deterministic identity and leaves ordered identities unchanged", () => {
    const left = createStep("left", (value: number) => value), right = createStep("right", (value: number) => value);
    const prepare = (parallel: boolean) => Result.getOrThrow(createWorkflow("identity", () => {
      const a = left(1), b = right(2); return new WorkflowResponse(parallel ? parallelize(a, b) : [a, b]);
    }).prepare());
    const ordered = prepare(false), parallel = prepare(true);
    expect(ordered.identity).toEqual({ name: "identity", nodes: [
      { name: "left", kind: "step", guards: [], input: 1, hook: false, bound: false },
      { name: "right", kind: "step", guards: [], input: 2, hook: false, bound: false },
    ], references: [{ kind: "step", step: 0 }, { kind: "step", step: 1 }], result: { array: [{ reference: 0 }, { reference: 1 }] } });
    expect(ordered).not.toHaveProperty("parallel"); expect(parallel.identity).not.toEqual(ordered.identity);
    expect(parallel.identity).toEqual(prepare(true).identity); expect(parallel.nodeCount).toBe(ordered.nodeCount);
  });

  it("counts all repeated and skipped child nodes under the unchanged 64-node ceiling", () => {
    const leaf = createStep("leaf", () => null);
    const child = createWorkflow("twenty-nodes", () => { for (let index = 0; index < 20; index++) leaf(undefined).config({ name: "leaf-" + index }); return new WorkflowResponse(null); });
    const parent = createWorkflow("sixty-three-nodes", () => new WorkflowResponse(parallelize(
      child.runAsStep({ input: undefined }).config({ name: "a" }), child.runAsStep({ input: undefined }).config({ name: "b" }), child.runAsStep({ input: undefined }).config({ name: "c" }),
    )));
    expect(Result.getOrThrow(parent.prepare()).nodeCount).toBe(63);
    expect(() => createWorkflow("over-limit-skipped", () => new WorkflowResponse(parallelize(
      when(undefined, () => false).then(() => child.runAsStep({ input: undefined }).config({ name: "a" })),
      when(undefined, () => false).then(() => child.runAsStep({ input: undefined }).config({ name: "b" })),
      when(undefined, () => false).then(() => child.runAsStep({ input: undefined }).config({ name: "c" })),
    )))).toThrow("Too many workflow nodes");
  });
});
