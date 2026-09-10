import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createHook, createStep, createWorkflow, transform, when, WorkflowResponse, type Hook, type StepOutput, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";

const port: WorkflowExecutionPort<Error> = {
  checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: error => error instanceof Error ? error : new Error("Foreign callback failed") }),
  context: { container: { resolve() { throw new Error("No resource expected"); } }, eventGroupId: "conditions-test" },
};
describe("native named workflow conditions", () => {
  it("skips inputs, transforms, hooks, child predicates and results in false branches", async () => {
    const predicate = vi.fn((input: { enabled: boolean }) => input.enabled);
    const nested = vi.fn(() => true), handler = vi.fn(() => 1), deferred = vi.fn(() => 2), hook = vi.fn(() => 3);
    const step = createStep("branch-step", handler);
    const flow = createWorkflow("guarded", (input: WorkflowData<{ enabled: boolean }>) => {
      const hooks: Hook<"inside", { enabled: boolean }, number>[] = [];
      const result = when("outer", input, predicate).then(() => {
        step(transform(input, deferred));
        const hook = createHook<"inside", { enabled: boolean }, number>("inside", input);
        hooks.push(hook);
        when("inner", input, nested).then(() => hook.getResult());
        return transform(input, deferred);
      });
      const normalized = transform(result, value => {
        expectTypeOf(value).toEqualTypeOf<number | undefined>();
        return value ?? null;
      });
      return new WorkflowResponse(normalized, { hooks });
    });
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare({ inside: hook })), { enabled: false }, port))).toBeNull();
    expect(predicate).toHaveBeenCalledTimes(1);
    for (const callback of [nested, handler, deferred, hook]) expect(callback).not.toHaveBeenCalled();
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare({ inside: hook })), { enabled: true }, port))).toBe(2);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(predicate).toHaveBeenCalledTimes(2); expect(nested).toHaveBeenCalledTimes(1); expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps nested optional results, escaped transforms and concurrent invocations isolated", async () => {
    const count = vi.fn((value: { inner: boolean }) => value.inner);
    const leaf = vi.fn((value: { id: number }) => value.id);
    let escaped: WorkflowData<number> | undefined;
    const flow = createWorkflow("nested", (input: WorkflowData<{ outer: boolean; inner: boolean; id: number }>) => {
      const value = when("parent", input, value => value.outer).then(() => {
        escaped = transform(input, leaf);
        return when("child", input, count).then(() => escaped);
      });
      return new WorkflowResponse(transform({ value, escaped }, result => [result.value ?? null, result.escaped ?? null]));
    });
    const prepared = Result.getOrThrow(flow.prepare());
    expect(await Promise.all([
      runEffect(executeWorkflow(prepared, { outer: false, inner: true, id: 1 }, port)),
      runEffect(executeWorkflow(prepared, { outer: true, inner: false, id: 2 }, port)),
      runEffect(executeWorkflow(prepared, { outer: true, inner: true, id: 3 }, port)),
    ])).toEqual([[null, null], [null, 2], [3, 3]]);
    expect(count).toHaveBeenCalledTimes(2); expect(leaf).toHaveBeenCalledTimes(2);
  });

  it("renames instances without retargeting existing references and seals them after composition", async () => {
    const step = createStep("shared", (input: number) => ({ input }));
    let escaped: StepOutput<{ input: number }> | undefined;
    const flow = createWorkflow("named", () => {
      const first = step(1); const selected = first.input;
      first.config({ name: "first" }); escaped = first;
      const second = step(2).config({ name: "second" });
      first.config({ name: "renamed" });
      return new WorkflowResponse([selected, second.input, first.input]);
    });
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual([1, 2, 1]);
    expect(() => escaped?.config({ name: "late" })).toThrow();
    expect(() => createWorkflow("foreign-config", () => new WorkflowResponse(escaped?.config({ name: "foreign" })))).toThrow();
    expect(() => createWorkflow("collision", () => new WorkflowResponse([step(1), step(2)]))).toThrow();
    for (const option of [{ name: "ok", retry: true }, { name: "" }, { name: "ok", extra: undefined }]) {
      expect(() => createWorkflow("bad-name", () => new WorkflowResponse(Reflect.apply(step(1).config, undefined, [option])))).toThrow();
    }
    for (const config of [{}, { name: undefined }, { name: 123 }, { name: null }]) {
      expect(() => Reflect.apply(createStep, undefined, [config, () => null])).toThrow();
    }
  });

  it("gives transforms owned inputs and keeps cached output properties free of callback mutations", async () => {
    const step = createStep("owned-output", () => ({ value: 1 }));
    const flow = createWorkflow("owned-transforms", () => {
      const original = step(undefined);
      const changed = transform(original, value => { value.value = 2; return value; });
      return new WorkflowResponse(transform({ changed, original }, value => [value.changed.value, value.original.value]));
    });
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual([2, 1]);
  });

  it("supports named instances whose declared output is null, undefined or void", async () => {
    const missing = createStep("missing-output", () => undefined);
    const empty = createStep("null-output", () => null);
    const completed = createStep<void, void>("void-output", () => {});
    const flow = createWorkflow("absence-instances", () => {
      const first = missing(undefined).config({ name: "first-missing" });
      const second = missing(undefined).config({ name: "second-missing" });
      const nil = empty(undefined).config({ name: "nil" });
      const done = completed(undefined).config({ name: "done" });
      return new WorkflowResponse(transform({ first, second, nil, done }, value => {
        expectTypeOf(value.first).toEqualTypeOf<undefined>();
        expectTypeOf(value.nil).toEqualTypeOf<null>();
        expectTypeOf(value.done).toEqualTypeOf<void>();
        return [value.first ?? null, value.second ?? null, value.nil, value.done ?? null];
      }));
    });
    expect(await runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual([null, null, null, null]);
  });

  it("requires narrowing optional conditional values before required step inputs", () => {
    const number = createStep("requires-number", (value: number) => value.toFixed());
    const record = createStep("requires-record", (value: { id: string }) => value.id);
    const flow = createWorkflow("optional-input-contract", () => {
      const maybeNumber = when("number-condition", null, () => false).then(() => 1);
      const maybeRecord = when("record-condition", null, () => false).then(() => ({ id: "one" }));
      // @ts-expect-error A skipped numeric branch cannot satisfy a required number.
      number(maybeNumber);
      // @ts-expect-error A skipped object branch cannot satisfy a required record.
      record(maybeRecord);
      return new WorkflowResponse(null);
    });
    // Type-only misuse fixture; execution would correctly supply undefined.
    expect(Result.isSuccess(flow.prepare())).toBe(true);
  });

  it("retains a configurable reference for a step that never returns", async () => {
    const fail = createStep("failure", () => { throw new Error("expected failure"); });
    const flow = createWorkflow("named-failure", () => {
      const failed = fail(undefined).config({ name: "named-failing-step" });
      return new WorkflowResponse(transform(failed, value => {
        expectTypeOf(value).toEqualTypeOf<never>();
        return value;
      }));
    });
    await expect(runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).rejects.toThrow("expected failure");
  });

  it("refuses unfinished, duplicate, foreign and asynchronous definitions before execution", () => {
    for (const name of [{ name: "branch" }, undefined, null, 1, "", "invalid name"]) {
      expect(() => createWorkflow("invalid-branch-name", () => new WorkflowResponse(
        Reflect.apply(when, undefined, [name, null, () => true]).then(() => 1),
      ))).toThrow();
    }
    expect(() => createWorkflow("unfinished", () => { when("branch", 1, () => true); return new WorkflowResponse(1); })).toThrow();
    expect(() => createWorkflow("duplicate-branch", () => {
      when("branch", 1, () => true).then(() => 1);
      return new WorkflowResponse(when("branch", 2, () => true).then(() => 2));
    })).toThrow();
    expect(() => createWorkflow("twice", () => {
      const branch = when("branch", 1, () => true); branch.then(() => 1);
      return new WorkflowResponse(branch.then(() => 2));
    })).toThrow();
    // @ts-expect-error Branch construction cannot return a Promise.
    expect(() => createWorkflow("async-build", () => new WorkflowResponse(when("branch", 1, () => true).then(async () => 1)))).toThrow();
    // @ts-expect-error Rejected async builders must not escape as unhandled rejections.
    expect(() => createWorkflow("rejected-build", () => new WorkflowResponse(when("branch", 1, () => true).then(async () => { throw new Error("invalid builder"); })))).toThrow();
    const maybeAsync = (): number | Promise<number> => Promise.resolve(1);
    // @ts-expect-error A possible Promise member also violates synchronous construction.
    expect(() => createWorkflow("maybe-async-build", () => new WorkflowResponse(when("branch", 1, () => true).then(maybeAsync)))).toThrow();
    let foreign: WorkflowData<number> | undefined;
    createWorkflow("source", () => new WorkflowResponse(foreign = transform(1, value => value)));
    expect(() => createWorkflow("foreign", () => new WorkflowResponse(when("branch", foreign, () => true).then(() => 1)))).toThrow();
    expect(() => createWorkflow("bounded", () => {
      for (let index = 0; index < 33; index++) when(`branch-${index}`, index, () => true).then(() => index);
      return new WorkflowResponse(null);
    })).toThrow();
  });

  it("fails a reached throwing, non-Boolean or asynchronous predicate without running its steps", async () => {
    const handler = vi.fn(); const step = createStep("never", handler);
    for (const predicate of [() => { throw new Error("predicate failed"); }, () => 1, async () => true, async () => { throw new Error("async failed"); }]) {
      const flow = createWorkflow("invalid-predicate", () => {
        const branch = Reflect.apply(when, undefined, ["branch", 1, predicate]);
        branch.then(() => step(undefined));
        return new WorkflowResponse(null);
      });
      await expect(runEffect(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).rejects.toThrow();
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
