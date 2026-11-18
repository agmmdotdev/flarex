import { expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, parallelize, StepResponse, WorkflowResponse, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

const port = (root: string): WorkflowExecutionPort<Error> => ({
  checkpoint: Effect.void,
  capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()),
    catch: cause => cause instanceof Error ? cause : new Error("Foreign callback failed", { cause }) }),
  context: { container: { resolve() { throw new Error("No resource selected"); } }, eventGroupId: root,
    idempotencyKey: "not-the-staged-node-identity" },
});

it("keeps nested repeated-child invocation identities distinct and stable for the same trusted root", async () => {
  const decode = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.String), Schema.Array(Schema.String), Schema.String]));
  const identify = createStep("identify-native-step", (_input: void, context) => new StepResponse(context.idempotencyKey));
  const child = createWorkflow("repeated-native-child", () => new WorkflowResponse(identify(undefined)));
  const middle = createWorkflow("native-child-frame", () => new WorkflowResponse([
    child.runAsStep({ input: undefined }).config({ name: "first-child-display" }),
    child.runAsStep({ input: undefined }).config({ name: "second-child-display" }),
  ]));
  const parent = createWorkflow("native-root-identity", () => new WorkflowResponse([
    middle.runAsStep({ input: undefined }).config({ name: "first-middle-display" }),
    middle.runAsStep({ input: undefined }).config({ name: "second-middle-display" }), identify(undefined),
  ]));
  const prepared = Result.getOrThrow(parent.prepare());
  const first = decode(await Effect.runPromise(executeWorkflow(prepared, undefined, port("trusted-root-a"))));
  const same = decode(await Effect.runPromise(executeWorkflow(prepared, undefined, port("trusted-root-a"))));
  const other = decode(await Effect.runPromise(executeWorkflow(prepared, undefined, port("trusted-root-b"))));
  expect(same).toEqual(first);
  const keys = first.flat(2);
  expect(keys).toHaveLength(5);
  expect(keys.every(key => typeof key === "string" && key !== "not-the-staged-node-identity")).toBe(true);
  expect(new Set(keys).size).toBe(5);
  expect(other.flat(2).some(key => keys.includes(key))).toBe(false);
});

it("keeps parallel node identities independent of callback completion order", async () => {
  const decode = Schema.decodeUnknownSync(Schema.Struct({ left: Schema.String, right: Schema.String }));
  const identify = createStep("parallel-native-step", async (delay: number, context) => {
    for (let index = 0; index < delay; index++) await Promise.resolve();
    return new StepResponse(context.idempotencyKey);
  });
  const flow = createWorkflow("parallel-native-identities", (input: WorkflowData<{ left: number; right: number }>) => {
    const [left, right] = parallelize(identify(input.left).config({ name: "left-display-name" }),
      identify(input.right).config({ name: "right-display-name" }));
    return new WorkflowResponse({ left, right });
  });
  const prepared = Result.getOrThrow(flow.prepare());
  const first = decode(await Effect.runPromise(executeWorkflow(prepared, { left: 0, right: 4 }, port("parallel-root"))));
  const reordered = decode(await Effect.runPromise(executeWorkflow(prepared, { left: 4, right: 0 }, port("parallel-root"))));
  expect(first).toEqual(reordered);
  expect(first.left).not.toBe(first.right);
});
