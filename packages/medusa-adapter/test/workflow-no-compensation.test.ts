import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, when, type WorkflowData, type Resolved } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";

describe("finite native step compensation configuration", () => {
  it("disables only its configured instance and preserves sibling and child callbacks", () => {
    const compensate = vi.fn(), invoke = () => new StepResponse(1, "retained");
    const native = createStep({ name: "native", compensation: "transactionCovered" }, invoke, compensate);
    const child = createWorkflow("child-default-compensation", () => new WorkflowResponse(native(undefined)));
    const root = createWorkflow("instance-compensation", () => {
      const disabled = native(undefined).config({ noCompensation: true }).config({ name: "disabled" });
      const sibling = native(undefined).config({ name: "sibling" });
      return new WorkflowResponse({ disabled, sibling, child: child.runAsStep({ input: undefined }) });
    });
    const nodes = Result.getOrThrow(root.prepare()).nodes;
    expect(nodes.find(node => node.name === "disabled")).toMatchObject({ kind: "step", invoke, compensate: undefined, compensation: undefined });
    expect(nodes.find(node => node.name === "sibling")).toMatchObject({ kind: "step", invoke, compensate, compensation: "transactionCovered" });
    expect(Result.getOrThrow(child.prepare()).nodes[0]).toMatchObject({ invoke, compensate, compensation: "transactionCovered" });
    expect(compensate).not.toHaveBeenCalled();
  });

  it("rejects re-enabling, unknown options, empty configuration and child-wide suppression", () => {
    const native = createStep("refuse-options", () => 1), child = createWorkflow("refuse-child", () => new WorkflowResponse(native(undefined)));
    for (const config of [{}, { noCompensation: false }, { noCompensation: 1 }, { noCompensation: true, timeout: 1 }, { name: undefined }])
      expect(() => createWorkflow("invalid-options", () => new WorkflowResponse(Reflect.apply(native(undefined).config, undefined, [config])))).toThrow();
    expect(() => createWorkflow("invalid-child", () => new WorkflowResponse(child.runAsStep({ input: undefined }).config({ noCompensation: true })))).toThrow();
  });

  it.each([false, true])("keeps conditional whole/member absence when selected=%s", async selected => {
    const native = createStep("conditional-value", () => ({ value: 42 }));
    const flow = createWorkflow("conditional-projection", (input: WorkflowData<boolean>) => {
      const whole = when("selected", input, value => value).then(() => native(undefined));
      const { value } = whole;
      expectTypeOf<Resolved<typeof whole>>().toEqualTypeOf<{ value: number } | undefined>();
      expectTypeOf<Resolved<typeof value>>().toEqualTypeOf<number | undefined>();
      return new WorkflowResponse({ whole, value });
    });
    const port: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
      invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
      context: { eventGroupId: "conditional-test", container: { resolve() { throw new Error("No resources"); } } } };
    const output = await Effect.runPromise(executeWorkflow(Result.getOrThrow(flow.prepare()), selected, port));
    expect(output).toEqual(selected ? { whole: { value: 42 }, value: 42 } : { whole: undefined, value: undefined });
  });
});
