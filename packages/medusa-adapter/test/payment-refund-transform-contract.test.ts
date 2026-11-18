import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BigNumber, MathBN } from "@medusajs/framework/utils/portable";
import { parseStringifyIfNecessary } from "@medusajs/utils/common/parse-stringify-if-necessary";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { captureCommerceInput } from "../src/value/input";
import { captureNativeNumericDto } from "../src/value/native-numeric";
import { validatePaymentsRefundStep, type ValidatePaymentsRefundStepInput } from "@medusajs/core-flows/payment/refund-payments";

/** Preserve the native refund amount boundary before changing its shared
 * finite SDK owner. A plain numeric conversion would lose native precision. */
describe("native Payment refund transform prerequisite", () => {
  it("admits a full exact refund when public Capture numbers round below their stored raw amount", async () => {
    const amount = new BigNumber("9007199254740993.0000"), flow = createWorkflow("native-exact-refund-validation",
      (input: WorkflowData<ValidatePaymentsRefundStepInput>) => new WorkflowResponse(validatePaymentsRefundStep(input)));
    const node = Result.getOrThrow(flow.prepare()).nodes.find(node => node.name === "validate-payments-refund-step");
    if (node?.kind !== "step") throw new Error("Missing native refund validator");
    const raw = amount.raw;
    if (raw === undefined) throw new Error("Missing native exact refund amount");
    expect(amount.numeric).toBe(9007199254740992);
    await expect(node.invoke({ payments: [{ id: "pay-exact", captures: [{ amount: amount.numeric, raw_amount: raw }], refunds: [] }],
      input: [{ payment_id: "pay-exact", amount: raw }] }, { eventGroupId: "exact-refund-validator",
      container: { resolve() { throw new Error("Native validator uses no resource"); } } })).resolves.toBeUndefined();
  });
  it.each([
    { name: "exact Capture ceiling", captures: [{ amount: 9007199254740992, raw_amount: { value: "9007199254740993.0000", precision: 20 } }], refunds: [], amount: "9007199254740993.0001", succeeds: false },
    { name: "exact previous Refund", captures: [{ amount: 9007199254740996, raw_amount: { value: "9007199254740995.0000", precision: 20 } }], refunds: [{ amount: 9007199254740992, raw_amount: { value: "9007199254740993.0000", precision: 20 } }], amount: "2.0001", succeeds: false },
    { name: "scalar fallback at limit", captures: [{ amount: 15 }], refunds: [{ amount: 2 }], amount: "13", succeeds: true },
    { name: "scalar fallback above limit", captures: [{ amount: 15 }], refunds: [{ amount: 2 }], amount: "14", succeeds: false },
  ])("preserves native refundable amount validation: $name", async ({ captures, refunds, amount, succeeds }) => {
    const flow = createWorkflow("native-refund-validation-boundary",
      (input: WorkflowData<ValidatePaymentsRefundStepInput>) => new WorkflowResponse(validatePaymentsRefundStep(input)));
    const node = Result.getOrThrow(flow.prepare()).nodes.find(node => node.name === "validate-payments-refund-step");
    if (node?.kind !== "step") throw new Error("Missing native refund validator");
    const result = Promise.resolve(node.invoke({ payments: [{ id: "pay-boundary", captures, refunds }],
      input: [{ payment_id: "pay-boundary", amount }] }, { eventGroupId: "refund-validation-boundary",
      container: { resolve() { throw new Error("Native validator uses no resource"); } } }));
    if (succeeds) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow("trying to refund amount greater than the refundable amount");
  });
  it("preserves strict JSON refusal of unnormalized native Order total DTOs", () => {
    const dto = { total: new BigNumber("12.5") };
    expect(parseStringifyIfNecessary(dto)).toEqual({ total: 12.5 });
    expect(captureCommerceInput(dto)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.getOrThrow(captureNativeNumericDto(dto))).toEqual(parseStringifyIfNecessary(dto));
  });

  it("preserves exact native MathBN transform results through the real finite runtime", async () => {
    const amount = MathBN.mult("3.125000000000000000001", -1), receive = vi.fn((input: unknown) => new StepResponse(input));
    expect(parseStringifyIfNecessary({ amount })).toEqual({ amount: "-3.125000000000000000001" });
    const step = createStep("refund-native-number-receiver", receive);
    const flow = createWorkflow("refund-native-number-witness", () => new WorkflowResponse(
      step(transform({}, () => [{ order_id: "order-refund", amount }]))));
    const result = await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(flow.prepare()), {}, {
      checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
      invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
      context: { eventGroupId: "refund-number-witness", container: { resolve() { throw new Error("No resource selected"); } } },
    })));
    expect(Result.getOrThrow(result)).toEqual([{ order_id: "order-refund", amount: "-3.125000000000000000001" }]);
    expect(receive).toHaveBeenCalledOnce();
  });
});
