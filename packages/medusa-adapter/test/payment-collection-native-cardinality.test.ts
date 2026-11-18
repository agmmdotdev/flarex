import { describe, expect, it } from "vitest";
import { PaymentModuleService } from "@medusajs/payment/services";

describe("native Payment collection update result cardinality", () => {
  // Exercise the actual native public method/decorators. These narrow internal
  // ports isolate its result projection; connected persistence is tested by
  // the workflow fixtures, rather than reproduced in this unit witness.
  const updated = { id: "paycol_cardinality", currency_code: "usd", amount: 10 };
  const receiver = {
    baseRepository_: {
      getFreshManager: () => ({}),
      serialize: async (value: unknown) => value,
    },
    paymentCollectionService_: { list: async () => [updated] },
    updatePaymentCollections_: async () => [updated],
  };

  it("returns a collection array for a selector, as required by the native step", async () => {
    const result: unknown = await Reflect.apply(PaymentModuleService.prototype.updatePaymentCollections,
      receiver, [{ id: updated.id }, { amount: 10 }]);
    expect(result).toEqual([updated]);
  });

  it("returns a singleton for an ID", async () => {
    const result: unknown = await Reflect.apply(PaymentModuleService.prototype.updatePaymentCollections,
      receiver, [updated.id, { amount: 10 }]);
    expect(result).toEqual(updated);
  });
});
