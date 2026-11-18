import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "@medusajs/deps/zod";
import { createHook, createStep, createWorkflow, isPreparedWorkflow, nativePricingContextResult,
  StepResponse, WorkflowResponse, when, type Hook, type HookHandlers, type NativePricingContext, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

function environment() {
  const captures: unknown[] = [];
  let live = true;
  const closed = new Error("Owning lifetime closed");
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.suspend(() => live ? Effect.void : Effect.fail(closed)),
    capture: value => Effect.suspend(() => live ? Effect.sync(() => {
      const captured = structuredClone(value); captures.push(captured); return captured;
    }) : Effect.fail(closed)),
    invoke: work => Effect.suspend(() => live ? Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) : Effect.fail(closed)),
    context: { eventGroupId: "pricing-hook", container: { resolve() { throw new Error("No resource admitted"); } } },
  };
  return { port, captures, close() { live = false; }, closed };
}

const declaration = (name = "native-pricing-hook") => createWorkflow(name, () => {
  const hook = createHook("pricing", {}, { resultValidator: nativePricingContextResult });
  return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
});

describe("closed native pricing-context hook profile", () => {
  it("declares the resolved hook callback input without exposing staged reference brands", () => {
    class Amount {
      readonly #identity = "native-hook-amount";
      constructor(readonly value: string) {}
      describe() { return this.#identity + this.value; }
    }
    interface Source { readonly id: string; readonly amount: Amount; readonly optional: { readonly label: string } | null }
    const check = (input: WorkflowData<Source>, selected: WorkflowData<Source | null>) => {
      const hook = createHook("resolved", { input, selected }, { resultValidator: nativePricingContextResult });
      type Input = NonNullable<(typeof hook)[" input"]>;
      expectTypeOf<Input>().toEqualTypeOf<{ input: Source; selected: Source | null }>();
      const handlers: HookHandlers<readonly [typeof hook]> = { resolved: value => {
        expectTypeOf(value.input.amount).toEqualTypeOf<Amount>();
        expectTypeOf(value.selected).toEqualTypeOf<Source | null>();
        return new StepResponse({ id: value.input.id });
      } };
      const incorrect: HookHandlers<readonly [typeof hook]> = {
        // @ts-expect-error Runtime callbacks receive resolved data, never staged references.
        resolved: (value: { input: WorkflowData<Source>; selected: Source | null }) => new StepResponse({ id: value.input.id }),
      };
      expectTypeOf<NativePricingContext>().toEqualTypeOf<Readonly<Record<string, unknown>> | undefined>();
      return { handlers, incorrect };
    };
    expectTypeOf(check).toBeFunction();
  });

  it("resolves genuine child-step values before invoking the native pricing hook", async () => {
    const source = createStep("native-hook-source", () => new StepResponse({ id: "selected", optional: null }));
    const flow = createWorkflow("resolved-native-pricing-hook", () => {
      const selected = source(undefined);
      const hook = createHook("pricing", { input: selected, id: selected.id }, { resultValidator: nativePricingContextResult });
      return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
    });
    const prepared = Result.getOrThrow(flow.prepare({ pricing: value => {
      expect(value).toEqual({ input: { id: "selected", optional: null }, id: "selected" });
      return new StepResponse({ retained: value.input, selected: value.id });
    } }));
    expect(await Effect.runPromise(executeWorkflow(prepared, undefined, environment().port)))
      .toEqual({ retained: { id: "selected", optional: null }, selected: "selected" });
  });

  it("retains native StepResponse output, raw output-member selection and bound undefined wrapping", async () => {
    const flow = declaration(), env = environment();
    for (const [handler, expected] of [
      [() => new StepResponse({ price: 7, nested: { exact: "9007199254740993" } }), { price: 7, nested: { exact: "9007199254740993" } }],
      [() => ({ price: 7 }), { __type: "Symbol(WorkflowWorkflowData)" }],
      [() => ({ output: { price: 7 } }), { price: 7 }],
      [() => new StepResponse(undefined), { __type: "Symbol(WorkflowWorkflowData)" }],
      [() => undefined, { __type: "Symbol(WorkflowWorkflowData)" }],
    ] as const) {
      expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(flow.prepare({ pricing: handler })), undefined, env.port))).toEqual(expected);
    }
  });

  it("bypasses parsing for native no-handler absence and preserves lazy cached result staging", async () => {
    const unused = createWorkflow("unused-native-pricing-hook", () => {
      const hook = createHook("pricing", {}, { resultValidator: nativePricingContextResult });
      return new WorkflowResponse("unused", { hooks: [hook] });
    });
    const cached = createWorkflow("cached-native-pricing-hook", () => {
      const hook = createHook("pricing", {}, { resultValidator: nativePricingContextResult });
      const first = hook.getResult(); expect(hook.getResult()).toBe(first);
      return new WorkflowResponse(first, { hooks: [hook] });
    });
    expect(Result.getOrThrow(unused.prepare()).nodes.map(node => node.name)).toEqual(["pricing"]);
    expect(Result.getOrThrow(cached.prepare()).nodes.map(node => node.name)).toEqual(["pricing", "get-pricing-result"]);
    const env = environment();
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(cached.prepare()), undefined, env.port))).toBeUndefined();
    // Unused native results never inspect a value's suitability for this validator.
    const invalid = Reflect.apply(unused.prepare, undefined, [{ pricing: () => new StepResponse(7) }]);
    if (!Result.isResult(invalid)) throw new Error("Missing prepared result");
    const prepared = Result.getOrThrow(invalid);
    if (!isPreparedWorkflow(prepared)) throw new Error("Unissued workflow");
    expect(await Effect.runPromise(executeWorkflow(prepared, undefined, env.port))).toBe("unused");
  });

  it.each([null, 7, "wrong", []])("propagates the native Zod failure for StepResponse output %j after retaining compensation", async value => {
    const flow = declaration(), env = environment(), compensation = { retained: "original-handler-preimage" };
    // Deliberate runtime boundary: forged handler results bypass the authoring
    // type so the real native parser, not a compile-time rejection, is exercised.
    const result = Reflect.apply(flow.prepare, undefined, [{ pricing: () => new StepResponse(value, compensation) }]);
    if (!Result.isResult(result)) throw new Error("Missing prepared result");
    const prepared = Result.getOrThrow(result);
    if (!isPreparedWorkflow(prepared)) throw new Error("Unissued workflow");
    const expected = z.record(z.string(), z.any()).optional().safeParse(value);
    if (expected.success) throw new Error("Native witness unexpectedly accepted invalid input");
    await expect(Effect.runPromise(executeWorkflow(prepared, undefined, env.port))).rejects.toMatchObject({ issues: expected.error.issues });
    expect(env.captures).toContainEqual({ output: value, compensation });
    const original = prepared.nodes[0], parsed = prepared.nodes[1];
    expect(original?.kind !== "workflow" && original?.hook).toBe(true);
    expect(parsed?.kind !== "workflow" && parsed?.compensate).toBeUndefined();
  });

  it("skips conditional handlers/results and does not cache per-invocation outputs across calls", async () => {
    let calls = 0;
    const flow = createWorkflow("conditional-native-pricing-hook", (input: WorkflowData<boolean>) => {
      const exposed: Hook<"pricing", object, Readonly<Record<string, unknown>> | undefined>[] = [];
      const selected = when("pricing-condition", input, enabled => enabled).then(() => {
        const hook = createHook("pricing", {}, { resultValidator: nativePricingContextResult });
        exposed.push(hook);
        return hook.getResult();
      });
      return new WorkflowResponse(selected, { hooks: exposed });
    });
    const prepared = Result.getOrThrow(flow.prepare({ pricing: () => new StepResponse({ sequence: ++calls }) })), env = environment();
    expect(await Effect.runPromise(executeWorkflow(prepared, false, env.port))).toBeUndefined();
    expect(calls).toBe(0);
    expect(await Effect.runPromise(executeWorkflow(prepared, true, env.port))).toEqual({ sequence: 1 });
    expect(await Effect.runPromise(executeWorkflow(prepared, false, env.port))).toBeUndefined();
    expect(calls).toBe(1);
    const counted = createWorkflow("counted-native-pricing-hook", () => {
      const hook = createHook("pricing", {}, { resultValidator: nativePricingContextResult });
      return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
    });
    const active = Result.getOrThrow(counted.prepare({ pricing: () => new StepResponse({ sequence: ++calls }) }));
    expect(await Effect.runPromise(executeWorkflow(active, undefined, env.port))).toEqual({ sequence: 2 });
    expect(await Effect.runPromise(executeWorkflow(active, undefined, env.port))).toEqual({ sequence: 3 });
  });

  it("refuses foreign schemas, cloned profiles, callback substitution and option getters without executing them", () => {
    let inspected = 0;
    const getter = Object.defineProperty({}, "resultValidator", { enumerable: true, get() { inspected++; return nativePricingContextResult; } });
    for (const options of [getter, { resultValidator: { ...nativePricingContextResult } }, { resultValidator: z.record(z.string(), z.any()).optional() },
      { resultValidator: { ...nativePricingContextResult, parse() { inspected++; } } }, { resultValidator: nativePricingContextResult, extra: true }])
      expect(() => createWorkflow("invalid-native-pricing-profile", () => {
        Reflect.apply(createHook, undefined, ["pricing", {}, options]); return new WorkflowResponse(undefined);
      })).toThrow();
    expect(inspected).toBe(0);
    expect(Object.isFrozen(nativePricingContextResult)).toBe(true);
    expect(Reflect.ownKeys(nativePricingContextResult)).toEqual(["profile"]);
  });

  it("captures the issued validator choice without retaining mutable caller options", async () => {
    const options = { resultValidator: nativePricingContextResult };
    const flow = createWorkflow("captured-native-pricing-options", () => {
      const hook = createHook("pricing", {}, options);
      return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
    });
    options.resultValidator = { ...nativePricingContextResult };
    const prepared = Result.getOrThrow(flow.prepare({ pricing: () => new StepResponse({ price: 7 }) }));
    expect(await Effect.runPromise(executeWorkflow(prepared, undefined, environment().port))).toEqual({ price: 7 });
  });

  it("binds validator declarations and child dependencies into identity while leaving plain hooks unchanged", () => {
    const plain = createWorkflow("same-pricing-name", () => {
      const hook = createHook("pricing", {}); return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
    });
    const validated = declaration("same-pricing-name");
    const old = Result.getOrThrow(plain.prepare()), selected = Result.getOrThrow(validated.prepare());
    expect(old.identity.nodes).toEqual([{ name: "pricing", kind: "step", guards: [], input: { record: [] }, hook: true, bound: false }]);
    expect(selected.identity).not.toEqual(old.identity);
    expect(selected.identity.nodes[0]).toMatchObject({ hookValidator: "nativePricingContextResult" });
    expect(selected.identity.nodes[1]).toMatchObject({ hookResult: { handler: 0, validator: "nativePricingContextResult" } });
    const parent = createWorkflow("native-pricing-parent", () => new WorkflowResponse(validated.runAsStep({ input: undefined })));
    expect(Result.getOrThrow(parent.prepare()).identity.nodes[0]).toMatchObject({ workflow: selected.identity });
  });

  it("preserves the owning lifetime refusal and full callback Cause without running later work", async () => {
    const env = environment(); let later = 0;
    const after = createStep("after-pricing", () => { later++; return new StepResponse(null); });
    const flow = createWorkflow("closing-native-pricing", () => {
      const hook = createHook("pricing", {}, { resultValidator: nativePricingContextResult });
      const value = hook.getResult(); after(value); return new WorkflowResponse(value, { hooks: [hook] });
    });
    const prepared = Result.getOrThrow(flow.prepare({ pricing: () => { env.close(); return new StepResponse({ price: 7 }); } }));
    await expect(Effect.runPromise(executeWorkflow(prepared, undefined, env.port))).rejects.toBe(env.closed);
    expect(later).toBe(0);
    const failure = new Error("Owning callback failure"), defect = new Error("Owning callback defect");
    const cause = Cause.combine(Cause.fail(failure), Cause.die(defect));
    const port = { ...environment().port, invoke: () => Effect.failCause(cause) };
    const exit = await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(declaration().prepare()), undefined, port));
    if (!Exit.isFailure(exit)) throw new Error("Missing owning callback Cause");
    expect(exit.cause.reasons).toMatchObject([{ _tag: "Fail", error: failure }, { _tag: "Die", defect }]);
  });
});
