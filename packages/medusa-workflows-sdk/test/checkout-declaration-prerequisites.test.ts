import { Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

// Exact declaration from the pinned native complete-cart root. Admission must
// establish its storage/retention owner before any checkout callback can run.
const checkoutDeclaration = {
  name: "complete-cart",
  store: true,
  idempotent: false,
  retentionTime: 60 * 60 * 24 * 3,
} as const;

const port: WorkflowExecutionPort<unknown> = {
  checkpoint: Effect.void,
  capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
  context: { container: { resolve() { throw new Error("No resource selected"); } }, eventGroupId: "checkout-declaration" },
};

describe("native checkout declaration prerequisite", () => {
  it("admits the native declaration through the existing workflow owner", () => {
    const workflow = createWorkflow(checkoutDeclaration, () => new WorkflowResponse(null));
    expect(Result.getOrThrow(workflow.prepare()).identity).toMatchObject(checkoutDeclaration);
    const ordinary = createWorkflow({ name: checkoutDeclaration.name, idempotent: false }, () => new WorkflowResponse(null));
    expect(Result.getOrThrow(ordinary.prepare()).identity).not.toHaveProperty("store");
    expect(Result.getOrThrow(ordinary.prepare()).identity).not.toEqual(Result.getOrThrow(workflow.prepare()).identity);
  });

  it.each([
    { ...checkoutDeclaration, store: false },
    { ...checkoutDeclaration, retentionTime: 1 },
    { ...checkoutDeclaration, retentionTime: 259200.5 },
    { ...checkoutDeclaration, retentionTime: Infinity },
    { ...checkoutDeclaration, idempotent: true },
    { ...checkoutDeclaration, storeExecution: true },
    { name: "checkout", store: true, idempotent: false },
    { name: "checkout", retentionTime: 259200, idempotent: false },
  ])("refuses unsupported storage declarations %j", declaration => {
    expect(() => Reflect.apply(createWorkflow, undefined, [declaration, () => new WorkflowResponse(null)])).toThrow();
  });

  it("refuses declaration accessors without invoking them", () => {
    let reads = 0;
    const declaration = { ...checkoutDeclaration, get retentionTime() { reads++; return 259200; } };
    expect(() => Reflect.apply(createWorkflow, undefined, [declaration, () => new WorkflowResponse(null)])).toThrow();
    expect(reads).toBe(0);
  });

  it("requires the explicit outer-owner policy before any callback in a parent or child", async () => {
    let invoked = 0;
    const probe = createStep("checkout-storage-probe", () => { invoked++; return new StepResponse(null); });
    const child = createWorkflow(checkoutDeclaration, () => new WorkflowResponse(probe(undefined)));
    const parent = createWorkflow("checkout-parent", () => {
      probe(undefined);
      return new WorkflowResponse(child.runAsStep({ input: undefined }));
    });
    for (const definition of [child, parent]) {
      const result = await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(definition.prepare()), undefined, port));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) expect(result.cause.reasons).toMatchObject([
        { _tag: "Fail", error: { _tag: "WorkflowDefinitionError", reason: "unsupportedProfile" } },
      ]);
    }
    expect(invoked).toBe(0);
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined,
      { ...port, storedWorkflowPolicy: "atomicRootOutcome" }))).toBeNull();
    expect(invoked).toBe(2);
  });
});
