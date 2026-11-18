import { Effect, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

interface Row { readonly id: string; readonly label?: string | undefined; readonly nested?: { readonly note?: string | undefined } }

describe("finite workflow optional input authoring", () => {
  it("admits native undefined fields through direct and child references while retaining brand and nominal checks", () => {
    class Amount {
      readonly #identity = "amount";
      constructor(readonly value: number) {}
      describe() { return this.#identity + this.value; }
    }
    const check = (row: WorkflowData<{ id: string; label: string | undefined }>,
      wrong: WorkflowData<{ id: string; label: number | undefined }>, label: WorkflowData<string | undefined>,
      wrongScalar: WorkflowData<number>, absent: WorkflowData<undefined>, amount: WorkflowData<Amount>, counterfeit: WorkflowData<Pick<Amount, keyof Amount>>) => {
      const receive = createStep("typed-optional-row", (value: Row) => new StepResponse(value));
      const rows = createStep("typed-optional-rows", (value: readonly Row[]) => new StepResponse(value));
      const child = createWorkflow("typed-optional-child", (value: WorkflowData<Row>) => new WorkflowResponse(receive(value)));
      const childRows = createWorkflow("typed-optional-child-rows", (value: WorkflowData<readonly Row[]>) => new WorkflowResponse(rows(value)));
      const strict = createStep("typed-optional-strict", (value: { id: string; label?: string }) => new StepResponse(value));
      // @ts-expect-error A branded value that permits explicit undefined cannot promise a stricter optional value.
      strict(row);
      receive(row);
      receive({ id: "row-one", label: undefined, nested: { note: undefined } });
      receive({ id: "row-one", label });
      child.runAsStep({ input: row });
      child.runAsStep({ input: { id: "row-one", label: undefined } });
      childRows.runAsStep({ input: [row] });
      const mapChild = createWorkflow("typed-required-map-child", (value: WorkflowData<{ required: Record<string, string> }>) => new WorkflowResponse(value));
      // @ts-expect-error A child must not accept an undefined reference as a structurally empty required map.
      mapChild.runAsStep({ input: { required: absent } });
      // @ts-expect-error The optional field still requires a string value.
      receive(wrong);
      // @ts-expect-error Child array members cannot hide an incompatible branded reference.
      childRows.runAsStep({ input: [wrong] });
      // @ts-expect-error Nested scalar reference types remain checked.
      receive({ id: "row-one", label: wrongScalar });
      // @ts-expect-error Omission compatibility does not remove required fields.
      receive({ label: "missing identity" });
      const nominal = createStep("typed-optional-nominal", (value: { amount: Amount }) => new StepResponse(value));
      nominal({ amount });
      // @ts-expect-error Public member references cannot counterfeit a nominal identity.
      nominal({ amount: counterfeit });
      // @ts-expect-error Literal property bags cannot counterfeit a nominal identity either.
      nominal({ amount: { value: 1, describe: () => "amount1" } });
    };
    expectTypeOf(check).toBeFunction();
  });

  it("preserves native own undefined through the real resolver and child invocation without mutating the source", async () => {
    const source = { id: "row-one", label: undefined, nested: { note: undefined } }, observed: unknown[] = [];
    const receive = createStep("optional-runtime-receiver", (rows: readonly Row[]) => {
      observed.push(structuredClone(rows));
      for (const row of rows) {
        expect(Object.hasOwn(row, "label")).toBe(true);
        expect(Object.hasOwn(row.nested ?? {}, "note")).toBe(true);
      }
      return new StepResponse(rows);
    });
    const child = createWorkflow("optional-runtime-child", (rows: WorkflowData<readonly Row[]>) => new WorkflowResponse(receive(rows)));
    const parent = createWorkflow("optional-runtime-parent", () => {
      const row = transform({}, () => source);
      return new WorkflowResponse(child.runAsStep({ input: [row] }));
    });
    const port: WorkflowExecutionPort<never> = { checkpoint: Effect.void,
      capture: value => Effect.sync(() => structuredClone(value)),
      invoke: work => Effect.promise(() => Promise.resolve(work())),
      context: { eventGroupId: "optional-input", container: { resolve() { throw new Error("No resource selected"); } } },
    };
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, port)))
      .toEqual([source]);
    expect(observed).toEqual([[source]]);
    expect(Object.hasOwn(source, "label")).toBe(true);
    expect(Object.hasOwn(source.nested, "note")).toBe(true);
  });
});
