import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { createHook, createStep, createWorkflow, transform, when, StepResponse, WorkflowResponse, type StepOutput, type WorkflowData, type WorkflowDefinition } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";

const port: WorkflowExecutionPort<Error> = {
  checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause instanceof Error ? cause : new Error("Foreign callback failed") }),
  context: { container: { resolve() { throw new Error("No resource selected"); } }, eventGroupId: "one-root" },
};
const run = <I, O, H extends readonly unknown[]>(flow: WorkflowDefinition<I, O, H>, input: I) => runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), input, port));

describe("native workflow composition", () => {
  it("preserves the pinned child result and shared context while isolating repeated frames", async () => {
    const build = vi.fn(), evaluate = vi.fn((value: number) => value + 1);
    const context = createStep("context", (_: unknown, context) => context.eventGroupId);
    const child = createWorkflow("child", (input: WorkflowData<number>) => {
      build();
      const output = transform(input, evaluate);
      return new WorkflowResponse({ values: [output, output], group: context(undefined) });
    });
    const flow = createWorkflow("parent", (input: WorkflowData<{ first: number; second: number }>) => {
      const first = child.runAsStep({ input: input.first });
      const selected = first.values;
      first.config({ name: "first" });
      const second = child.runAsStep({ input: input.second }).config({ name: "second" });
      first.config({ name: "renamed" });
      return new WorkflowResponse({ first: selected, second });
    });
    const prepared = Result.getOrThrow(flow.prepare());
    expect(prepared.nodeCount).toBe(4);
    expect(await Promise.all([runEffect(executeWorkflow(prepared, { first: 1, second: 5 }, port)),
      runEffect(executeWorkflow(prepared, { first: 10, second: 20 }, port))])).toEqual([
      { first: [2, 2], second: { values: [6, 6], group: "one-root" } },
      { first: [11, 11], second: { values: [21, 21], group: "one-root" } },
    ]);
    expect(build).toHaveBeenCalledTimes(1); expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("binds each child's hooks by instance and leaves parent hooks separate", async () => {
    const child = createWorkflow("hook-child", (input: WorkflowData<number>) => {
      const hook = createHook<"same", number, number>("same", input);
      return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
    });
    const first = vi.fn((value: number) => value + 1), second = vi.fn((value: number) => value + 2);
    const registration: { same: (value: number) => number } = { same: first };
    const flow = createWorkflow("hook-parent", () => {
      const a = child.runAsStep({ input: 10, hooks: registration }).config({ name: "first" });
      const b = child.runAsStep({ input: 10, hooks: { same: second } }).config({ name: "second" });
      const absent = child.runAsStep({ input: 0 }).config({ name: "absent" });
      const hook = createHook<"same", number, number>("same", 1);
      return new WorkflowResponse({ a, b, absent, parent: hook.getResult() }, { hooks: [hook] });
    });
    registration.same = () => 999;
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare({ same: () => 3 })), undefined, port)))
      .toEqual({ a: 11, b: 12, absent: undefined, parent: 3 });
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  });

  it("skips all child work and evaluates reached child results even when unused", async () => {
    const predicate = vi.fn(() => true), result = vi.fn(() => 5), input = vi.fn(() => 1);
    const child = createWorkflow("guard-child", () => new WorkflowResponse(when("inner", null, predicate).then(() => transform(null, result))));
    const after = createStep("after", () => { expect(result).toHaveBeenCalledTimes(1); return null; });
    const flow = createWorkflow("guard-parent", (enabled: WorkflowData<boolean>) => {
      when("outer", enabled, value => value).then(() => child.runAsStep({ input: transform(null, input) }));
      return new WorkflowResponse(null);
    });
    expect(await run(flow, false)).toBeNull();
    for (const fn of [predicate, result, input]) expect(fn).not.toHaveBeenCalled();
    expectTypeOf<NonNullable<typeof flow[" input"]>>().toEqualTypeOf<boolean>();
    const reached = createWorkflow("unused-result", () => { child.runAsStep({ input: undefined }); return new WorkflowResponse(after(undefined)); });
    expect(await run(reached, undefined)).toBeNull();
  });

  it("keeps child failure fatal without invoking covered inverse callbacks", async () => {
    const inverse = vi.fn(), later = vi.fn(); const failure = new Error("child failed");
    const step = createStep({ name: "covered", compensation: "transactionCovered" }, () => new StepResponse(1), inverse);
    const child = createWorkflow("failure-child", () => new WorkflowResponse(transform(step(undefined), () => { throw failure; })));
    const after = createStep("later", later);
    const parent = createWorkflow("failure-parent", () => { child.runAsStep({ input: undefined }); return new WorkflowResponse(after(undefined)); });
    const exit = await runEffect(Effect.exit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, port)));
    expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true);
    expect(inverse).not.toHaveBeenCalled(); expect(later).not.toHaveBeenCalled();
  });

  it("supports absent and never child outputs and rejects optional input misuse", async () => {
    const absent = createWorkflow("absent-child", () => new WorkflowResponse(undefined));
    const nil = createWorkflow("nil-child", () => new WorkflowResponse(null));
    const failure = createStep("never", (): never => { throw new Error("never returned"); });
    const never = createWorkflow("never-child", () => new WorkflowResponse(failure(undefined)));
    const flow = createWorkflow("absent-parent", () => {
      const missing = absent.runAsStep({ input: undefined }).config({ name: "missing" });
      const empty = nil.runAsStep({ input: undefined });
      return new WorkflowResponse(transform({ missing, empty }, value => {
        expectTypeOf(value.missing).toEqualTypeOf<undefined>();
        expectTypeOf(value.empty).toEqualTypeOf<null>();
        return value;
      }));
    });
    expect(await run(flow, undefined)).toEqual({ missing: undefined, empty: null });
    const typed = createWorkflow("never-parent", () => new WorkflowResponse(never.runAsStep({ input: undefined }).config({ name: "failure" })));
    await expect(run(typed, undefined)).rejects.toThrow("never returned");
    const required = createWorkflow("requires-number", (value: WorkflowData<number>) => new WorkflowResponse(value));
    createWorkflow("optional-child-types", () => {
      const optional = when("disabled", null, () => false).then(() => 1);
      // @ts-expect-error A possibly skipped value cannot satisfy a required child input.
      required.runAsStep({ input: optional });
      // @ts-expect-error Child input is inferred, not caller-chosen.
      required.runAsStep({ input: "wrong" }).config({ name: "wrong" });
      return new WorkflowResponse(null);
    });
  });

  it("refuses malformed calls and foreign references without invoking getters", () => {
    const child = createWorkflow("checked-child", (input: WorkflowData<number>) => new WorkflowResponse(input));
    const getter = vi.fn(() => 1);
    const cases = [{}, { input: 1, extra: true }, { input: 1, hooks: { unknown: () => 1 } },
      Object.defineProperty({}, "input", { get: getter, enumerable: true }),
      { input: 1, hooks: Object.defineProperty({}, "unknown", { get: getter, enumerable: true }) }];
    for (const value of cases) expect(() => createWorkflow("malformed-parent", () => new WorkflowResponse(Reflect.apply(child.runAsStep, undefined, [value])))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => child.runAsStep({ input: 1 })).toThrow("Use inside createWorkflow");
    expect(() => createWorkflow("duplicate-parent", () => new WorkflowResponse([child.runAsStep({ input: 1 }), child.runAsStep({ input: 2 })]))).toThrow();
    let escaped: StepOutput<number> | undefined;
    createWorkflow("source-parent", () => new WorkflowResponse(escaped = child.runAsStep({ input: 1 })));
    expect(() => escaped?.config({ name: "late" })).toThrow();
    expect(() => createWorkflow("foreign-parent", () => new WorkflowResponse(child.runAsStep({ input: escaped ?? 1 })))).toThrow();
  });

  it("executes nested children and counts repeated definitions against one node ceiling", async () => {
    const step = createStep("leaf", () => null);
    let child = createWorkflow("leaf-flow", () => new WorkflowResponse(step(undefined)));
    for (let depth = 0; depth < 4; depth++) {
      const previous = child;
      child = createWorkflow(`level-${depth}`, () => {
        previous.runAsStep({ input: undefined }).config({ name: "first" });
        previous.runAsStep({ input: undefined }).config({ name: "second" });
        return new WorkflowResponse(step(undefined));
      });
    }
    expect(Result.getOrThrow(child.prepare()).nodeCount).toBe(61);
    expect(await run(child, undefined)).toBeNull();
    expect(() => createWorkflow("too-many", () => {
      child.runAsStep({ input: undefined }).config({ name: "first" });
      return new WorkflowResponse(child.runAsStep({ input: undefined }).config({ name: "second" }));
    })).toThrow("Too many workflow nodes");
  });

  it("captures composition, literal inputs and hook registration in deterministic identity", () => {
    const child = createWorkflow("identity-child", (input: WorkflowData<number>) => {
      const hook = createHook("hook", input);
      return new WorkflowResponse({ input, hook: hook.getResult() }, { hooks: [hook] });
    });
    const prepare = (input: number, name: string, bound = false) => createWorkflow("identity-parent", () =>
      new WorkflowResponse(child.runAsStep({ input, ...(bound ? { hooks: { hook: () => 1 } } : {}) }).config({ name })));
    const identity = (flow: ReturnType<typeof prepare>) => Result.getOrThrow(flow.prepare()).identity;
    expect(identity(prepare(1, "first"))).toEqual(identity(prepare(1, "first")));
    for (const changed of [prepare(2, "first"), prepare(1, "second"), prepare(1, "first", true)]) expect(identity(changed)).not.toEqual(identity(prepare(1, "first")));
    expect(Object.isFrozen(identity(prepare(1, "first")))).toBe(true);
  });

  it("preserves the full input union and maximum workflow names", async () => {
    const child = createWorkflow("a".repeat(128), (input: WorkflowData<boolean | null>) => new WorkflowResponse(input));
    const parent = createWorkflow("boolean-parent", () => new WorkflowResponse([
      child.runAsStep({ input: true }).config({ name: "true" }),
      child.runAsStep({ input: false }).config({ name: "false" }),
      child.runAsStep({ input: null }),
    ]));
    expect(await run(parent, undefined)).toEqual([true, false, null]);
    const symbol = Symbol("field");
    const symbolic = createWorkflow("symbolic-property", (input: WorkflowData<{ [symbol]: string }>) => new WorkflowResponse(input[symbol]));
    expect(Result.isFailure(symbolic.prepare())).toBe(true);
  });
});
