import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

const port: WorkflowExecutionPort<Error> = {
  checkpoint: Effect.void,
  capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause instanceof Error ? cause : new Error("Foreign callback failure") }),
  context: { container: { resolve() { throw new Error("No selected resource"); } }, eventGroupId: "resolution-budget" },
};
const flow = createWorkflow("execution-resolution-budget", (input: WorkflowData<readonly number[]>) =>
  new WorkflowResponse(transform(input, value => value)));
const prepared = Result.getOrThrow(flow.prepare());

describe("trusted workflow execution resolution quota", () => {
  it("preserves the default refusal and admits a selected complete transform result", async () => {
    const input = Array.from({ length: 9_000 }, () => 0);
    await expect(Effect.runPromise(executeWorkflow(prepared, input, port)))
      .rejects.toMatchObject({ reason: "invalidReference", detail: "Transform resolution bounds exceeded" });
    expect(await Effect.runPromise(executeWorkflow(prepared, input, { ...port, resolutionNodes: 65_536 }))).toEqual(input);
    await expect(Effect.runPromise(executeWorkflow(prepared, Array.from({ length: 65_536 }, () => 0), { ...port, resolutionNodes: 65_536 })))
      .rejects.toMatchObject({ reason: "invalidReference", detail: "Transform resolution bounds exceeded" });
  });

  it("validates the quota before invoking callbacks", async () => {
    const invoke = vi.fn(port.invoke);
    for (const resolutionNodes of [0, 131_073, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      await expect(Effect.runPromise(executeWorkflow(prepared, [], { ...port, resolutionNodes, invoke })))
        .rejects.toMatchObject({ reason: "unsupportedProfile", detail: "Invalid workflow resolution node quota" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("charges repeated data aliases to the selected expanded traversal bound", async () => {
    const shared = Array.from({ length: 1_000 }, () => 0);
    const aliased = Array.from({ length: 100 }, () => shared);
    const aliases = createWorkflow("execution-expanded-resolution-budget", () =>
      new WorkflowResponse(transform({}, () => aliased)));
    const definition = Result.getOrThrow(aliases.prepare());
    for (const selected of [port, { ...port, resolutionNodes: 65_536 }])
      await expect(Effect.runPromise(executeWorkflow(definition, undefined, selected)))
        .rejects.toMatchObject({ reason: "invalidReference", detail: "Resolution traversal bounds exceeded" });
  });

  it("captures the selected quota before a callback can mutate its trusted port", async () => {
    const selected = { ...port, resolutionNodes: 65_536 };
    selected.invoke = work => { selected.resolutionNodes = 1; return port.invoke(work); };
    const input = Array.from({ length: 9_000 }, () => 0);
    expect(await Effect.runPromise(executeWorkflow(prepared, input, selected))).toEqual(input);
    expect(selected.resolutionNodes).toBe(1);
  });

  it("keeps selected transform descriptor, sparse-array, cycle and depth refusals", async () => {
    let getters = 0;
    const getter = Object.defineProperty({}, "value", { enumerable: true, get() { getters++; return 1; } });
    const cyclic: { child?: unknown } = {}; cyclic.child = cyclic;
    let deep: unknown = 0;
    for (let index = 0; index < 65; index++) deep = { child: deep };
    for (const input of [getter, Array(1), cyclic, deep]) {
      const bad = createWorkflow("selected-resolution-refusal", () => new WorkflowResponse(transform({}, () => input)));
      await expect(Effect.runPromise(executeWorkflow(Result.getOrThrow(bad.prepare()), undefined, { ...port, resolutionNodes: 65_536 })))
        .rejects.toMatchObject({ reason: "invalidReference" });
    }
    expect(getters).toBe(0);
  });
});
