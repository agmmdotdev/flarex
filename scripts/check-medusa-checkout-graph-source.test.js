import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCheckoutGraphSource, checkoutGraphSourcePairs, checkoutGraphAuthoredTargets, expectedPromotionService, verifyCheckoutGraphSelection, verifyNativeCheckoutLink, verifyPromotionService, verifyPromotionSqlPrefilter, promotionSqlPrefilterGate } from "./check-medusa-checkout-graph-source.mjs";
import { cartPrerequisiteSourcePairs, verifyCartPrerequisiteSourceSelection } from "./check-medusa-cart-prerequisite-source.mjs";

test("retains actual native checkout Links, Promotion constructor and SQL refusal", () => { checkCheckoutGraphSource(); });
test("rejects native SQL prefilter activation or any different refusal behavior", () => {
  verifyPromotionSqlPrefilter(promotionSqlPrefilterGate);
  for (const changed of [promotionSqlPrefilterGate.replace("throw new MedusaError", "return new MedusaError"),
    promotionSqlPrefilterGate.replace("throw new MedusaError", "return _sharedContext.manager.executeQuery"),
    promotionSqlPrefilterGate.replace("NOT_ALLOWED", "NOT_FOUND")])
    assert.throws(() => verifyPromotionSqlPrefilter(changed), /refusal drift/);
});
test("authenticates exact source/classification pairs and refuses omissions, duplicates and redirects", () => {
  const first = checkoutGraphSourcePairs[0];
  assert.ok(first);
  const files = [...checkoutGraphSourcePairs, ...checkoutGraphAuthoredTargets.map(target => ({ target, classification: "authored" }))];
  verifyCheckoutGraphSelection(files);
  assert.throws(() => verifyCheckoutGraphSelection(checkoutGraphSourcePairs), /Redirected/);
  assert.throws(() => verifyCheckoutGraphSelection(files.slice(1)), /Redirected/);
  assert.throws(() => verifyCheckoutGraphSelection([...files, first]), /Redirected/);
  assert.throws(() => verifyCheckoutGraphSelection(files.map(pair => ({ ...pair, classification: "authored" }))), /Redirected/);
  assert.throws(() => verifyCheckoutGraphSelection([...files,
    { ...first, target: "packages/medusa-promotion/src/other.ts" }]), /Redirected/);
});
test("refuses changed native Link cardinality", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/modules/link-modules/src/definitions/order-cart.ts", "utf8");
  const expected = native.replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"');
  assert.throws(() => verifyNativeCheckoutLink(native, expected.replace("hasMany: true", "hasMany: false")), /drift/);
});

test("refuses portable import reversions in promoted targets and authored refusal", () => {
  for (const pair of checkoutGraphSourcePairs) {
    const native = readFileSync(pair.source, "utf8");
    const target = readFileSync(pair.target, "utf8");
    if (!target.includes('"@medusajs/framework/utils/portable"')) continue;
    const changed = target.replaceAll('"@medusajs/framework/utils/portable"', '"@medusajs/framework/utils"');
    assert.throws(() => pair.classification === "promotionServiceFork" ? verifyPromotionService(native, changed) :
      verifyNativeCheckoutLink(native, changed), /drift/);
  }
  assert.throws(() => verifyPromotionSqlPrefilter(promotionSqlPrefilterGate.replace(
    '"@medusajs/framework/utils/portable"', '"@medusajs/framework/utils"')), /refusal drift/);
});

test("keeps the Cart prerequisite module gate exact when admitting checkout Promotion", () => {
  const files = [...cartPrerequisiteSourcePairs, ...checkoutGraphSourcePairs,
    ...checkoutGraphAuthoredTargets.map(target => ({ target, classification: "authored" }))];
  verifyCartPrerequisiteSourceSelection(files);
  const service = checkoutGraphSourcePairs.find(pair => pair.classification === "promotionServiceFork");
  assert.ok(service);
  for (const changed of [{ ...service, source: service.source + ".other" }, { ...service, classification: "authored" },
    { ...service, target: "packages/medusa-promotion/src/services/other.ts" }])
    assert.throws(() => verifyCartPrerequisiteSourceSelection(files.filter(file => file.target !== service.target).concat([changed])), /unselected module code/);
});
test("allows only the named declaration annotations in the real Promotion service", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/modules/promotion/src/services/promotion-module.ts", "utf8");
  const expected = expectedPromotionService(native);
  verifyPromotionService(native, expected);
  assert.throws(() => verifyPromotionService(native, expected.replace('withDefaultRelations(config, ["application_method"])', 'withDefaultRelations(config, [])')), /drift/);
});
