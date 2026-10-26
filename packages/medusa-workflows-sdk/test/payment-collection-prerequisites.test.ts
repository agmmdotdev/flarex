import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

const port: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void,
  capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
  context: { container: { resolve() { throw new Error("No resource selected"); } }, eventGroupId: "collection-prerequisite" },
};

describe("native collection workflow SDK prerequisites", () => {
  it("admits the exact native idempotent:false marker", () => {
    const flow = createWorkflow({ name: "native-collection-marker", idempotent: false }, () => new WorkflowResponse(null));
    expect(Result.getOrThrow(flow.prepare()).identity).toMatchObject({ idempotent: false });
    expect(Result.getOrThrow(createWorkflow("native-collection-marker", () => new WorkflowResponse(null)).prepare()).identity).not.toHaveProperty("idempotent");
  });

  it.each([{ name: "bad", idempotent: true }, { name: "bad", idempotent: false, retries: 1 }, { name: "bad" }])("refuses unsupported declarations %j", config => {
    expect(() => Reflect.apply(createWorkflow, undefined, [config, () => new WorkflowResponse(null)])).toThrow();
  });

  it("refuses accessors without evaluating them", () => {
    let reads = 0;
    const config = { name: "bad", get idempotent() { reads++; return false; } };
    expect(() => Reflect.apply(createWorkflow, undefined, [config, () => new WorkflowResponse(null)])).toThrow();
    expect(reads).toBe(0);
  });

  it("executes a genuine skip without capturing an Error and continues with omitted output", async () => {
    const captures: unknown[] = [], inverses: unknown[] = [];
    const skip = createStep({ name: "native-skip", compensation: "transactionCovered" }, () => StepResponse.skip(), input => { inverses.push(input); });
    const observe = createStep("native-after-skip", (input: { absent?: unknown }) => new StepResponse(Object.keys(input)));
    const flow = createWorkflow("native-skip-root", () => new WorkflowResponse(observe({ absent: skip(undefined) })));
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, { ...port,
      capture: value => Effect.sync(() => { if (value instanceof Error) throw new Error("Skip reached value capture"); captures.push(value); return structuredClone(value); }),
    }))).toEqual([]);
    expect(captures.some(value => value instanceof Error)).toBe(false);
    expect(inverses).toEqual([]);
  });

  it("keeps a name-only skip imitation as ordinary output", async () => {
    const step = createStep("fake-skip", () => ({ name: "SkipStepResponse" }));
    const flow = createWorkflow("fake-skip-root", () => new WorkflowResponse(step(undefined)));
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, port))).toEqual({ name: "SkipStepResponse" });
  });

  it("supplies actual parent occurrence identity to a nested native child", async () => {
    const contexts: unknown[] = [];
    const probe = createStep("native-parent-probe", (_input: undefined, context) => {
      contexts.push(Reflect.get(context, "parentStepIdempotencyKey")); return new StepResponse(null);
    });
    const child = createWorkflow("native-parent-child", () => new WorkflowResponse(probe(undefined)));
    const parent = createWorkflow("native-parent-root", () => new WorkflowResponse(child.runAsStep({ input: undefined })));
    await Effect.runPromise(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, port));
    expect(contexts).toEqual([JSON.stringify(["collection-prerequisite", 0])]);
  });

  it("strips supplied root parent metadata and distinguishes sibling and deeper children", async () => {
    const contexts: unknown[] = [];
    const probe = createStep("parent-occurrence-probe", (_input: undefined, context) => {
      contexts.push(context.parentStepIdempotencyKey); return new StepResponse(null);
    });
    const leaf = createWorkflow("parent-occurrence-leaf", () => new WorkflowResponse(probe(undefined)));
    const middle = createWorkflow("parent-occurrence-middle", () => new WorkflowResponse(leaf.runAsStep({ input: undefined })));
    const root = createWorkflow("parent-occurrence-root", () => {
      probe(undefined); leaf.runAsStep({ input: undefined }); middle.runAsStep({ input: undefined });
      return new WorkflowResponse(leaf.runAsStep({ input: undefined }).config({ name: "last-child" }));
    });
    await Effect.runPromise(executeWorkflow(Result.getOrThrow(root.prepare()), undefined, { ...port,
      context: { ...port.context, parentStepIdempotencyKey: "forged-parent" } }));
    expect(contexts).toEqual([undefined, JSON.stringify(["collection-prerequisite", 1]),
      JSON.stringify(["collection-prerequisite", 2, 0]), JSON.stringify(["collection-prerequisite", 3])]);
  });
});
