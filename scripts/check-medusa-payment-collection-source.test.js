import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { paymentCollectionSourcePairs, verifyPaymentCollectionSelection, verifyPaymentCollectionSource, verifyCartPaymentTotalsSource } from "./check-medusa-payment-collection-source.mjs";
/** @param {string} file */
const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const itemTotalsSource = read("third_party/medusa/upstream/packages/core/utils/src/totals/line-item/index.ts");
/** @param {string} source @param {string} target @param {string} helper */
const verifyTotals = (source, target, helper) => verifyCartPaymentTotalsSource(source, target, helper, itemTotalsSource);
test("requires each exact native workflow selection once", () => {
  verifyPaymentCollectionSelection(paymentCollectionSourcePairs);
  assert.throws(() => verifyPaymentCollectionSelection(paymentCollectionSourcePairs.slice(1)));
  assert.throws(() => verifyPaymentCollectionSelection([...paymentCollectionSourcePairs, paymentCollectionSourcePairs[0]]));
  assert.throws(() => verifyPaymentCollectionSelection(paymentCollectionSourcePairs.map((pair, index) => index === 0 ? { ...pair, classification: "authored" } : pair)));
});

for (const pair of paymentCollectionSourcePairs) test("retains native collection program: " + pair.target, () => {
  verifyPaymentCollectionSource(read(pair.source), read(pair.target), pair.target);
  assert.throws(() => verifyPaymentCollectionSource(read(pair.source), read(pair.target) + "\nconsole.log('extra effect')", pair.target));
});

test("extracts the exact native Cart total selector and leaves every service operation intact", () => {
  const source = read("third_party/medusa/upstream/packages/modules/cart/src/services/cart-module.ts"),
    target = read("packages/medusa-cart/src/services/cart-module.ts"), helper = read("packages/medusa-cart/src/utils/totals-selection.ts");
  verifyTotals(source, target, helper);
  assert.throws(() => verifyTotals(source, target, helper.replace('"items.tax_lines"', '"items.invalid"')));
  assert.throws(() => verifyTotals(source, target.replace("decorateCartTotals(cart)", "cart"), helper));
  for (const [before, after] of [
    ["this.cartCreationStore_.record(cartCreationSnapshot(carts, plan), sharedContext)", "this.cartCreationStore_.record(cartCreationSnapshot(carts, plan), {})"],
    ["this.cartCreationStore_.compensate(receipt, sharedContext", "this.cartCreationStore_.compensate(receipt, {}"],
    ["await this.createCarts_(data, sharedContext)", "await this.createCarts_(data, {})"],
    ["carts: presentCartCreation(carts), receipt", "carts, receipt"],
    ["this.addressService_.delete(ids, context)", "this.addressService_.delete(ids, {})"],
  ]) assert.throws(() => verifyTotals(source, target.replace(before, after), helper));
});

test("retains only the approved scalar amount preimage selection", () => {
  const pair = paymentCollectionSourcePairs.find(pair => pair.target.endsWith("steps/update-payment-collection.ts"));
  assert.ok(pair);
  const target = read(pair.target);
  assert.throws(() => verifyPaymentCollectionSource(read(pair.source), target.replace('{ objectFields: ["amount"] }', '{}'), pair.target));
  assert.throws(() => verifyPaymentCollectionSource(read(pair.source), target.replace('objectFields: ["amount"]', 'objectFields: ["amount", "metadata"]'), pair.target));
  const exact = 'pc.amount === undefined ? undefined : ("raw_amount" in pc ? pc.raw_amount : undefined) ?? pc.amount';
  assert.throws(() => verifyPaymentCollectionSource(read(pair.source), target.replace(exact, 'pc.amount'), pair.target));
  assert.throws(() => verifyPaymentCollectionSource(read(pair.source), target.replace(exact, '("raw_amount" in pc ? pc.raw_amount : undefined) ?? pc.amount'), pair.target));
});

test("retains captured-payment exclusion, validation and exact Cart amount comparison", () => {
  for (const [suffix, before, after] of [
    ["cancel-payment-collection.ts", "!p.captured_at", "true"],
    ["refresh-payment-collection.ts", "MathBN.eq(", "MathBN.gt("],
    ["create-payment-collection-for-cart.ts", "if (cart.payment_collection)", "if (false)"],
  ]) {
    const pair = paymentCollectionSourcePairs.find(pair => pair.target.endsWith(suffix));
    assert.ok(pair);
    assert.throws(() => verifyPaymentCollectionSource(read(pair.source), read(pair.target).replace(before, after), pair.target));
  }
});

test("retains exact required native Line Item total metadata", () => {
  const source = read("third_party/medusa/upstream/packages/modules/cart/src/services/cart-module.ts");
  const target = read("packages/medusa-cart/src/services/cart-module.ts"), helper = read("packages/medusa-cart/src/utils/totals-selection.ts");
  verifyTotals(source, target, helper);
  assert.throws(() => verifyTotals(source, target, helper.replace('"original_subtotal"', '"invented_total"')));
  assert.throws(() => verifyCartPaymentTotalsSource(source, target, helper, itemTotalsSource.replace("subtotal: BigNumber", "subtotal?: BigNumber")));
});
