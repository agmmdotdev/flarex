import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptOrderFinanceSource, verifyOrderFinanceHelpers, verifyOrderFinanceSource, verifyOrderFinanceSelection } from "./check-medusa-order-finance-source.mjs";
import { adaptOrderChangeCancellationSource } from "./check-medusa-order-change-cancellation-source.mjs";

const source = readFileSync("third_party/medusa/upstream/packages/modules/order/src/services/order-module-service.ts", "utf8");
const accounting = readFileSync("packages/medusa-order/src/utils/payment-accounting.ts", "utf8");
const totals = readFileSync("packages/medusa-order/src/utils/totals-selection.ts", "utf8");
const preview = readFileSync("packages/medusa-order/src/utils/preview-details.ts", "utf8");
const corrected = adaptOrderChangeCancellationSource(source, "packages/medusa-order/src/services/order-module-service.ts");

test("preserves native arithmetic and total selection with the cancellation correction", () => {
  verifyOrderFinanceHelpers(source, accounting, totals, preview);
  const transformed = adaptOrderFinanceSource(corrected);
  assert.match(transformed, /restoreOrderChangeCancellation/);
  assert.doesNotMatch(transformed, /this\.shouldIncludeTotals/);
  assert.doesNotMatch(transformed, /private shouldIncludeTotals/);
  assert.doesNotMatch(transformed, /private addRelationsToCalculateTotals/);
  verifyOrderFinanceSource(source, corrected, transformed, accounting, totals, preview);
});

test("refuses arithmetic, import-closure and extra-export drift", () => {
  assert.throws(() => verifyOrderFinanceHelpers(source, accounting.replace("MathBN.sub : MathBN.add", "MathBN.add : MathBN.sub"), totals, preview));
  assert.throws(() => verifyOrderFinanceHelpers(source, accounting.replace("transformPropertiesToBigNumber,", "deduplicate,"), totals, preview));
  assert.throws(() => verifyOrderFinanceHelpers(source, accounting + "\nexport const bypass = true\n", totals, preview));
});

test("refuses selection and native orchestration drift", () => {
  assert.throws(() => verifyOrderFinanceHelpers(source, accounting, totals.replace('"credit_lines",', '"transactions",'), preview));
  const transformed = adaptOrderFinanceSource(corrected);
  assert.throws(() => verifyOrderFinanceSource(source, corrected, transformed.replace("version: transactionData[0].version", "version: 1"), accounting, totals, preview));
  assert.throws(() => verifyOrderFinanceSource(source, corrected, transformed.replace("await this.orderSummaryService_.update(summaries, sharedContext)", "void summaries"), accounting, totals, preview));
});

test("retains native preview enrichment and both read ports without alternate totals", () => {
  verifyOrderFinanceHelpers(source, accounting, totals, preview);
  assert.throws(() => verifyOrderFinanceHelpers(source, accounting, totals, preview.replace("reads.listOrderLineItems(", "reads.listOrderShippingMethods(")));
  assert.throws(() => verifyOrderFinanceHelpers(source, accounting, totals, preview.replace("compareAtUnitPrice || null", "compareAtUnitPrice ?? null")));
  const transformed = adaptOrderFinanceSource(corrected);
  assert.throws(() => verifyOrderFinanceSource(source, corrected,
    transformed.replace("includeOrderPreviewDetails(this, order,", "includeOrderPreviewDetails(this, { ...order },"), accounting, totals, preview));
});

test("requires one original class identity and uniquely owned helper records", () => {
  const files = [
    { source: "third_party/medusa/upstream/packages/modules/order/src/services/order-module-service.ts", target: "packages/medusa-order/src/services/order-module-service.ts", classification: "orderChangeCancellationRestoreFork" },
    { target: "packages/medusa-order/src/utils/payment-accounting.ts", classification: "authored" },
    { target: "packages/medusa-order/src/utils/totals-selection.ts", classification: "authored" },
    { target: "packages/medusa-order/src/utils/preview-details.ts", classification: "authored" },
  ];
  verifyOrderFinanceSelection(files);
  assert.throws(() => verifyOrderFinanceSelection([...files, files[1]]));
  assert.throws(() => verifyOrderFinanceSelection(files.map(file => file.target.endsWith("payment-accounting.ts") ? { ...file, source: "unselected.ts" } : file)));
});
