import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BigNumber, MathBN, createRawPropertiesFromBigNumber } from "@medusajs/framework/utils/portable";
import { captureOrderFinanceTotals } from "../src/modules/order/finance-summary";

describe("native Order Summary JSON numeric boundary", () => {
  it("captures genuine native quantities and preserves trimmed raw values and unrelated JSON", async () => {
    const input = { paid_total: new BigNumber(15), refunded_total: new BigNumber("3.125"),
      transaction_total: MathBN.sub(15, "3.125"), pending_difference: new BigNumber("3.125"),
      original_order_total: 15, current_order_total: 15, accounting_total: 15, credit_line_total: 0,
      preserved: { application: "native-json" } };
    createRawPropertiesFromBigNumber(input);
    expect(await Effect.runPromise(captureOrderFinanceTotals(input))).toMatchObject({ paid_total: 15, refunded_total: 3.125,
      transaction_total: 11.875, pending_difference: 3.125, raw_paid_total: { value: "15", precision: 20 },
      raw_refunded_total: { value: "3.125", precision: 20 }, original_order_total: 15, preserved: { application: "native-json" } });
  });

  it("refuses contradictory raw quantities and foreign serializers without executing them", async () => {
    const toJSON = vi.fn(() => 5), foreign = { toJSON };
    expect(await Effect.runPromise(Effect.result(captureOrderFinanceTotals({ paid_total: foreign })))).toMatchObject({ _tag: "Failure" });
    expect(toJSON).not.toHaveBeenCalled();
    expect(await Effect.runPromise(Effect.result(captureOrderFinanceTotals({ paid_total: 15,
      raw_paid_total: { value: "16", precision: 20 } })))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});
