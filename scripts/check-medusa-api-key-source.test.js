// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { apiKeySourcePairs, verifyApiKeySelection, verifyApiKeySource } from "./check-medusa-api-key-source.mjs";

test("preserves full native API Key programs and the approved creation inverse", () => {
  for (const pair of apiKeySourcePairs) {
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    verifyApiKeySource(source, target, pair.target);
    assert.throws(() => verifyApiKeySource(source, target + "\nexport const unauthorized = true;\n", pair.target));
  }
});

test("refuses undo bypasses, weakened normal deletion and erased-type drift", () => {
  for (const [path, before, after] of [
    ["packages/medusa-api-key/src/services/api-key-module-service.ts", "if (isPresent(unrevokedApiKeys))", "if (false)"],
    ["packages/medusa-api-key/src/services/api-key-module-service.ts", "return await super.deleteApiKeys(ids, sharedContext)", "return await super.deleteApiKeys([], sharedContext)"],
    ["packages/medusa-core-flows/src/api-key/steps/create-api-keys.ts", "service.revertCreatedApiKeys(createdIds)", "service.deleteApiKeys(createdIds)"],
    ["packages/medusa-types/src/api-key/service.ts", "sharedContext?: Context): Promise<void>", "sharedContext?: Context): Promise<string>"],
    ["packages/medusa-api-key/src/joiner-config.ts", "models: [ApiKey]", "models: []"],
    ["packages/medusa-core-flows/src/api-key/workflows/revoke-api-keys.ts", ".config({ noCompensation: true })", ".config({ name: 'reversible-revoke' })"],
    ["packages/medusa-core-flows/src/api-key/workflows/delete-api-keys.ts", ".config({ noCompensation: true })", ".config({ name: 'reversible-delete' })"],
    ["packages/medusa-core-flows/src/api-key/workflows/delete-api-keys.ts", "transform({ input, deleted }", "transform({ input }"],
    ["packages/medusa-core-flows/src/api-key/workflows/delete-api-keys.ts", "removeApiKeyLinksStep(ids).config({ noCompensation: true })", "removeApiKeyLinksStep(ids)"],
    ["packages/medusa-core-flows/src/api-key/steps/link-sales-channels-to-publishable-key.ts", "applyApiKeyLinkOperation(remoteLink, input, idempotencyKey)", "applyApiKeyLinkOperation(remoteLink, input, 'fixed')"],
    ["packages/medusa-core-flows/src/api-key/steps/link-sales-channels-to-publishable-key.ts", "remoteLink.compensateOperation(prevData)", "remoteLink.compensateOperation({ ...prevData, operationId: 'other' })"],
    ["packages/medusa-core-flows/src/api-key/workflows/link-sales-channels-to-publishable-key.ts", "data.add ?? []", "[]"],
    ["packages/medusa-core-flows/src/api-key/workflows/link-sales-channels-to-publishable-key.ts", "sales_channel_ids: add", "sales_channel_ids: input.add"],
    ["packages/medusa-link-modules/src/definitions/publishable-api-key-sales-channel.ts", "workflowOperations: true", "workflowOperations: false"],
  ]) {
    if (path === undefined || before === undefined || after === undefined) throw new Error("Missing mutation witness");
    const pair = apiKeySourcePairs.find(pair => pair.target === path);
    if (pair === undefined) throw new Error("Missing source pair");
    const target = readFileSync(path, "utf8"), changed = target.replace(before, after);
    assert.notEqual(changed, target);
    assert.throws(() => verifyApiKeySource(readFileSync(pair.source, "utf8"), changed, path));
  }
});

test("refuses omitted, repeated, redirected or relabeled API Key sources", () => {
  verifyApiKeySelection(apiKeySourcePairs);
  const first = apiKeySourcePairs[0];
  if (first === undefined) throw new Error("Missing source pair");
  assert.throws(() => verifyApiKeySelection(apiKeySourcePairs.slice(1)));
  assert.throws(() => verifyApiKeySelection([...apiKeySourcePairs, first]));
  for (const changed of [{ ...first, target: first.target + ".changed" }, { ...first, classification: "authored" },
    { ...first, source: first.source + ".changed" }])
    assert.throws(() => verifyApiKeySelection([changed, ...apiKeySourcePairs.slice(1)]));
});
