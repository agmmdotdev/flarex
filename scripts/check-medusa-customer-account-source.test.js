import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cartPrerequisiteSourcePairs, verifyCartPrerequisiteSourceSelection } from "./check-medusa-cart-prerequisite-source.mjs";
import { checkCustomerAccountSources, customerAddressSourcePairs, customerAccountLinkSourcePair, customerAddressUpdateSourcePairs,
  verifyCustomerAccountSelection, verifyCustomerAddressSource, verifyCustomerAddressUpdateSource } from "./check-medusa-customer-account-source.mjs";

test("retains every pinned Customer Address callback and the genuine AccountHolder Link", () => {
  checkCustomerAccountSources();
  verifyCustomerAccountSelection([...customerAddressSourcePairs, customerAccountLinkSourcePair, ...customerAddressUpdateSourcePairs]);
});
test("refuses changed default selection, deleted preimages and compensation", () => {
  for (const [suffix, before, after] of [
    ["steps/utils/unset-address-for-create.ts", "if (curr[field])", "if (!curr[field])"],
    ["steps/delete-addresses.ts", "createCustomerAddresses(prevAddresses)", "createCustomerAddresses([])"],
    ["steps/update-addresses.ts", "service.updateCustomerAddresses(c.id, { ...c })", "service.updateCustomerAddresses(c.id, {})"],
  ]) {
    const pair = customerAddressSourcePairs.find(pair => pair.target.endsWith(suffix));
    assert.ok(pair);
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    assert.ok(target.includes(before), "Missing exact mutation witness " + suffix);
    assert.throws(() => verifyCustomerAddressSource(source, target.replace(before, after), pair.target), /Changed native Customer Address source/);
  }
});
test("refuses missing, relabelled and adjacent native source pairs", () => {
  const pairs = [...customerAddressSourcePairs, customerAccountLinkSourcePair, ...customerAddressUpdateSourcePairs];
  assert.throws(() => verifyCustomerAccountSelection(pairs.slice(1)));
  assert.throws(() => verifyCustomerAccountSelection(pairs.map((pair, index) => index === 0 ? { ...pair, classification: "authored" } : pair)));
  assert.throws(() => verifyCustomerAccountSelection([...pairs, { source: "other", target: "packages/medusa-core-flows/src/customer/other.ts", classification: "workflowFork" }]));
  assert.throws(() => verifyCustomerAccountSelection([...pairs, { source: "other", target: "packages/medusa-customer/src/services/other.ts", classification: "customerAddressUpdateFork" }]));
});

test("refuses changed scalar capture, replacement and selected identity protection", () => {
  for (const [suffix, before, after] of [
    ["steps/update-addresses.ts", 'objectFields: ["metadata"]', 'objectFields: []'],
    ["steps/update-addresses.ts", 'metadata: "replace"', 'metadata: "merge"'],
    ["steps/utils/unset-address-for-update.ts", '!affectedAddressIds.has(address.id)', 'affectedAddressIds.has(address.id)'],
    ["steps/utils/unset-address-for-update.ts", '{ id: addressIds }', '{ id: [] }'],
    ["workflows/update-addresses.ts", 'selectCustomerAddressIdsStep(input.selector)', 'selectCustomerAddressIdsStep({})'],
    ["workflows/update-addresses.ts", 'updateCustomerAddressesStep(updateInput)', 'updateCustomerAddressesStep(input)'],
  ]) {
    const pair = customerAddressSourcePairs.find(pair => pair.target.endsWith(suffix));
    assert.ok(pair);
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    assert.ok(target.includes(before));
    assert.throws(() => verifyCustomerAddressSource(source, target.replace(before, after), pair.target), /Changed native Customer Address source/);
  }
});

test("refuses lost metadata option forwarding or a changed native public signature", () => {
  for (const pair of customerAddressUpdateSourcePairs) {
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    const before = pair.target.startsWith("packages/medusa-customer/") ? '      sharedContext,\n      options' : '    options?: UpdateOptions';
    const after = pair.target.startsWith("packages/medusa-customer/") ? '      sharedContext' : '    options?: never';
    assert.ok(target.includes(before));
    assert.throws(() => verifyCustomerAddressUpdateSource(source, target.replace(before, after), pair.target), /Changed native Customer Address source/);
  }
});

test("keeps the Cart prerequisite on the same exact Customer service source owner", () => {
  const native = customerAddressUpdateSourcePairs[0];
  assert.ok(native);
  assert.deepEqual(cartPrerequisiteSourcePairs.find(pair => pair.target === native.target), native);
  verifyCartPrerequisiteSourceSelection(cartPrerequisiteSourcePairs);
  assert.throws(() => verifyCartPrerequisiteSourceSelection(cartPrerequisiteSourcePairs.map(pair =>
    pair.target === native.target ? { ...pair, classification: "importRelocation" } : pair)));
});
