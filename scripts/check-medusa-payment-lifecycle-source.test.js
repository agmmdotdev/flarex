import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { paymentLifecycleSourcePairs, verifyPaymentLifecycleSource, verifyPaymentAccountingSource, verifyOrderRefundValidationSource } from "./check-medusa-payment-lifecycle-source.mjs";

/** @param {string} file */
const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
for (const pair of paymentLifecycleSourcePairs.filter(pair => pair.classification === "paymentLifecycleFork")) {
  test("preserves complete native Payment program " + pair.target, () => {
    verifyPaymentLifecycleSource(read(pair.source), read(pair.target), pair.target);
    assert.throws(() => verifyPaymentLifecycleSource(read(pair.source), read(pair.target) + "\nconsole.log('unselected effect')", pair.target));
  });
}
const module = paymentLifecycleSourcePairs.find(pair => pair.classification === "paymentAccountingFork");
if (module === undefined) throw new Error("Missing Payment accounting pair");
const source = read(module.source), target = read(module.target), helper = read("packages/medusa-payment/src/utils/accounting.ts");

test("retains the finite capture relation check without changing native capture or compensation", () => {
  const pair = paymentLifecycleSourcePairs.find(pair => pair.target.endsWith("payment/steps/capture-payment.ts"));
  if (pair === undefined) throw new Error("Missing capture step source");
  const source = read(pair.source), target = read(pair.target);
  verifyPaymentLifecycleSource(source, target, pair.target);
  for (const changed of [target.replace("!hasCaptureRelations(payment)", "false"),
    target.replace("Array.isArray(payment.captures)", "payment.captures !== undefined"),
    target.replace("await paymentModule.capturePayment(input)", "await paymentModule.refundPayment(input)")])
    assert.throws(() => verifyPaymentLifecycleSource(source, changed, pair.target));
});
test("selects only the genuine native Order refund cancellation guard", () => {
  const pair = paymentLifecycleSourcePairs.find(pair => pair.classification === "orderRefundValidationFork");
  if (pair === undefined) throw new Error("Missing Order refund validation source");
  verifyOrderRefundValidationSource(read(pair.source), read(pair.target));
  assert.throws(() => verifyOrderRefundValidationSource(read(pair.source), read(pair.target).replace("===", "!==")));
  assert.throws(() => verifyOrderRefundValidationSource(read(pair.source), read(pair.target) + "\nconsole.log('extra')"));
});
test("extracts exact native accounting and preserves all remaining service behavior", () => {
  verifyPaymentAccountingSource(source, target, helper);
  for (const changed of [helper.replace("MathBN.lt(capturedAmount, totalRefundedAmount)", "MathBN.gt(capturedAmount, totalRefundedAmount)"),
    helper.replace("completedAt = now()", "completedAt = new Date()"), helper + "\nconsole.log('unselected effect')",
    helper + '\nimport "unselected-module"']) assert.throws(() => verifyPaymentAccountingSource(source, target, changed));
  for (const changed of [target.replace("this.roundToCurrencyPrecision.bind(this)", "undefined"),
    target.replace("await super.deleteRefunds({ id: refund.id }, sharedContext)", "void refund.id"),
    target.replace("throw error", "return payment"),
    target.replaceAll("Promise<InferEntityType<typeof Payment>>", "Promise<PaymentDTO>")]) assert.throws(() => verifyPaymentAccountingSource(source, changed, helper));
});

test("confines the approved native batch accounting correction to new Refund identities and exact amounts", () => {
  const pair = paymentLifecycleSourcePairs.find(pair => pair.target.endsWith("payment/workflows/refund-payments.ts"));
  if (pair === undefined) throw new Error("Missing native batch root");
  const source = read(pair.source), target = read(pair.target);
  verifyPaymentLifecycleSource(source, target, pair.target);
  for (const changed of [target.replace("reference_id: refund.id", "reference_id: payment.id"),
    target.replace("previousRefunds.has(refund.id) || seen.has(refund.id)", "false"),
    target.replace("refund.raw_amount ?? refund.amount", "refund.amount"),
    target.replace("const payment of refundedPayments", "const payment of payments"),
    target.replace("seen.add(refund.id)", "void refund.id")])
    assert.throws(() => verifyPaymentLifecycleSource(source, changed, pair.target));
});
