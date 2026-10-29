import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCheckoutGraphSource, checkoutGraphSourcePairs, checkoutGraphAuthoredTargets, expectedPromotionService, verifyCheckoutGraphSelection, verifyNativeCheckoutLink, verifyPromotionService, verifyPromotionSqlPrefilter } from "./check-medusa-checkout-graph-source.mjs";
import { cartPrerequisiteSourcePairs, verifyCartPrerequisiteSourceSelection } from "./check-medusa-cart-prerequisite-source.mjs";

test("retains actual native checkout Links, Promotion constructor and approved prefilter owner", () => { checkCheckoutGraphSource(); });
test("rejects changes to the exact native prefilter and its portable persistence seam", () => {
  for (const path of checkoutGraphAuthoredTargets) {
    const original = readFileSync(path, "utf8");
    verifyPromotionSqlPrefilter(original, path);
    assert.throws(() => verifyPromotionSqlPrefilter(original + "\nexport const bypass = true;", path), /prefilter drift/);
  }
  const plan = checkoutGraphAuthoredTargets.find(path => path.endsWith("/prefilter-plan.ts"));
  const helper = checkoutGraphAuthoredTargets.find(path => path.endsWith("/prefilter.ts"));
  assert.ok(plan); assert.ok(helper);
  for (const [path, before, after] of [[plan, "filter(Number.isFinite)", "filter(value => !isNaN(value))"],
    [plan, '|| "FALSE"', '|| "TRUE"'], [helper, "persistence === undefined", "false"],
    [helper, "await persistence.evaluateRules", "await persistence.rules"]]) {
    assert.ok(path);
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(before));
    assert.throws(() => verifyPromotionSqlPrefilter(source.replace(before, after), path), /prefilter drift/);
  }
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
  for (const path of checkoutGraphAuthoredTargets.filter(path => path.endsWith("/prefilter.ts")))
    assert.throws(() => verifyPromotionSqlPrefilter(readFileSync(path, "utf8").replace(
      '"@medusajs/framework/utils/portable"', '"@medusajs/framework/utils"'), path), /prefilter drift/);
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
