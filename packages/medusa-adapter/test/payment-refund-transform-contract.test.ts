import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BigNumber, MathBN } from "@medusajs/framework/utils/portable";
import { parseStringifyIfNecessary } from "@medusajs/utils/common/parse-stringify-if-necessary";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { captureCommerceInput } from "../src/value/input";
import { captureNativeNumericDto } from "../src/value/native-numeric";

/** Preserve the native refund amount boundary before changing its shared
 * finite SDK owner. A plain numeric conversion would lose native precision. */
describe("native Payment refund transform prerequisite", () => {
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
