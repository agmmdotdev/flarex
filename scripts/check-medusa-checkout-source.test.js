import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkoutSourcePairs, verifyCheckoutSource, verifyCheckoutSelection } from "./check-medusa-checkout-source.mjs";

describe("native checkout source closure", () => {
  for (const pair of checkoutSourcePairs) {
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    it("retains native statements and types: " + pair.target, () => {
      expect(() => verifyCheckoutSource(source, target, pair.target)).not.toThrow();
      expect(() => verifyCheckoutSource(source, target + "\nthrow new Error('changed');", pair.target)).toThrow();
      const mutant = target.replaceAll("input.payment_id", "input.payment_collection_id")
        .replaceAll("service.deleteOrders(createdIds)", "service.deleteOrders([])")
        .replaceAll("paymentSession.context?.customer?.id", "paymentSession.payment.id")
        .replaceAll("Reflect.apply(cartModule.updateCarts, cartModule, [dataToUpdate])", "Reflect.apply(cartModule.updateCarts, cartModule, [[]])");
      const checkoutMutant = mutant
        .replaceAll('entity: "order_cart"', 'entity: "cart"')
        .replaceAll('unitPrice: item.raw_unit_price ?? item.unit_price', 'unitPrice: item.unit_price')
        .replaceAll('PaymentSessionStatus.PENDING', 'PaymentSessionStatus.CANCELED')
        .replaceAll('cartItemsWithShipping.length > 0', 'cartItemsWithShipping.length >= 0')
        .replaceAll('MathBN.mult(item.required_quantity, item.quantity)', 'MathBN.sum(item.required_quantity, item.quantity)')
        .replaceAll('data.computedActions.length', '0');
      expect(checkoutMutant).not.toBe(target);
      expect(() => verifyCheckoutSource(source, checkoutMutant, pair.target)).toThrow();
    });
    it("authenticates the exact selected source pair: " + pair.target, () => {
      expect(() => verifyCheckoutSelection(checkoutSourcePairs)).not.toThrow();
      expect(() => verifyCheckoutSelection(checkoutSourcePairs.map(value => value === pair ? { ...value, source: pair.source + "-other" } : value))).toThrow();
      expect(() => verifyCheckoutSelection([...checkoutSourcePairs, pair])).toThrow();
    });
  }
});

it("retains native checkout Refund identity, sign and exact amount", () => {
  const pair = checkoutSourcePairs.find(pair => pair.target.endsWith("cart/workflows/complete-cart.ts"));
  if (pair === undefined) throw new Error("Missing native checkout root");
  const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
  for (const changed of [target.replace("reference_id: refund.id", "reference_id: payment.id"),
    target.replace("refund.raw_amount ?? refund.amount", "refund.amount"),
    target.replace("refund.raw_amount ?? refund.amount, -1", "refund.raw_amount ?? refund.amount, 1"),
    target.replace('reference: "refund"', 'reference: "capture"'),
    target.replace("payment.refunds ?? []", "[]")]) {
    expect(changed).not.toBe(target);
    expect(() => verifyCheckoutSource(source, changed, pair.target)).toThrow();
  }
});
