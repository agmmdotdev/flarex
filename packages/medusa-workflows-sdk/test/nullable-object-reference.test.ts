import { Effect, Result } from "effect";
import { expect, expectTypeOf, it } from "vitest";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type Resolved, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

interface Row { readonly id: string; readonly nested: { readonly label: string } }

it("exposes nullable object members as possibly absent while retaining the original resolved and nominal brands", () => {
  class Amount {
    readonly #identity = "native-quantity";
    constructor(readonly value: string) {}
    describe() { return this.#identity + this.value; }
  }
  const check = (row: WorkflowData<Row | null>, optional: WorkflowData<Row | undefined>, nullableAmount: WorkflowData<Amount | null>,
    amount: WorkflowData<Amount>, counterfeit: WorkflowData<Pick<Amount, keyof Amount>>, opaque: WorkflowData<unknown>) => {
    // Preserve the existing native dynamic authoring ABI; unknown stays opaque.
    expectTypeOf<WorkflowData<ReturnType<typeof JSON.parse>>>().toBeAny();
    expectTypeOf<Resolved<typeof opaque>>().toEqualTypeOf<unknown>();
    // @ts-expect-error Unknown references grant no object-member declaration.
    opaque.id;
    expectTypeOf(row.id).toEqualTypeOf<string | undefined>();
    expectTypeOf(optional.id).toEqualTypeOf<string | undefined>();
    expectTypeOf<Resolved<typeof row>>().toEqualTypeOf<Row | null>();
    expectTypeOf<Resolved<typeof optional>>().toEqualTypeOf<Row | undefined>();
    const required = createStep("required-native-member", (input: { id: string }) => new StepResponse(input));
    const admitted = createStep("optional-native-member", (input: { id?: string | undefined }) => new StepResponse(input));
    // @ts-expect-error Selecting a nullable member does not prove it exists.
    required({ id: row.id });
    admitted({ id: row.id });
    const requiredChild = createWorkflow("required-nullable-child", (input: WorkflowData<Row>) => new WorkflowResponse(input));
    // @ts-expect-error A nullable parent reference cannot enter a required child.
    requiredChild.runAsStep({ input: row });
    // @ts-expect-error Undefined remains a genuine child-input possibility.
    requiredChild.runAsStep({ input: optional });
    const nominal = createStep("required-native-nominal", (input: { amount: Amount }) => new StepResponse(input));
    nominal({ amount });
    // @ts-expect-error Nullable nominal values retain their original brand.
    nominal({ amount: nullableAmount });
    // @ts-expect-error Public members cannot counterfeit the private nominal value.
    nominal({ amount: counterfeit });
    expectTypeOf<Resolved<WorkflowData<never>>>().toEqualTypeOf<never>();
  };
  expectTypeOf(check).toBeFunction();
});

it("uses the existing runtime selection owner for null parents and genuine member values", async () => {
  const select = createStep("native-nullable-object", (present: boolean): StepResponse<Row | null> =>
    new StepResponse(present ? { id: "selected", nested: { label: "genuine" } } : null));
  const flow = createWorkflow("native-nullable-member-root", (input: WorkflowData<boolean>) => {
    const row = select(input);
    return new WorkflowResponse({ id: row.id, label: row.nested?.label });
  });
  const prepared = Result.getOrThrow(flow.prepare());
  const port: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context: { eventGroupId: "nullable-reference", container: { resolve() { throw new Error("No resource selected"); } } } };
  expect(await Effect.runPromise(executeWorkflow(prepared, false, port))).toEqual({ id: undefined, label: undefined });
  expect(await Effect.runPromise(executeWorkflow(prepared, true, port))).toEqual({ id: "selected", label: "genuine" });
});
