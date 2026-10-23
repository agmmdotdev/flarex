// @ts-check
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { paymentSessionSourcePairs, paymentSessionTypeSourcePairs, verifyPaymentSessionSource, verifyPaymentSessionSelection,
  verifyPaymentSessionTypeSource } from "./check-medusa-payment-session-source.mjs";

test("preserves complete native Payment session roots, callbacks and inverse ordering", () => {
  for (const pair of paymentSessionSourcePairs) {
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    verifyPaymentSessionSource(source, target, pair.target);
    const mutation = target.replace("new StepResponse", "new ChangedResponse").replace("new WorkflowResponse", "new ChangedResponse");
    assert.notEqual(mutation, target);
    assert.throws(() => verifyPaymentSessionSource(source, mutation, pair.target));
  }
  const root = paymentSessionSourcePairs[0];
  if (root === undefined) throw new Error("Missing native root");
  const source = readFileSync(root.source, "utf8"), target = readFileSync(root.target, "utf8");
  for (const changed of [target.replace("noCompensation: true", "noCompensation: false"),
    target.replace("!!data.input.customer_id", "!data.input.customer_id"),
    target.replace("data: data.input.data", "data: {}")]) {
    assert.notEqual(changed, target);
    assert.throws(() => verifyPaymentSessionSource(source, changed, root.target));
  }
});

test("refuses omitted, repeated, redirected and reclassified native Payment pairs", () => {
  const pairs = [...paymentSessionSourcePairs, ...paymentSessionTypeSourcePairs];
  verifyPaymentSessionSelection(pairs);
  assert.throws(() => verifyPaymentSessionSelection(pairs.slice(1)));
  assert.throws(() => verifyPaymentSessionSelection([...pairs, ...pairs]));
  for (const property of ["source", "target", "classification"]) assert.throws(() => verifyPaymentSessionSelection(
    pairs.map((pair, index) => index === 0 ? { ...pair, [property]: "changed" } : pair)));
});

test("preserves native Payment types except the exact undefined-valued optional call ABI", () => {
  for (const pair of paymentSessionTypeSourcePairs) {
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    verifyPaymentSessionTypeSource(source, target, pair.target);
    const changed = target + "\nexport type ChangedNativePaymentContract = number\n";
    assert.throws(() => verifyPaymentSessionTypeSource(source, changed, pair.target));
  }
});

test("authenticates the real Payment promotion against pinned source and target bytes", () => {
  const manifest = JSON.parse(readFileSync("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", "utf8"));
  assert.equal(manifest.sourceCommit, "48d5cc675e4e8bc821e22c20c88a751acc66fb5f");
  verifyPaymentSessionSelection(manifest.files);
  for (const pair of [...paymentSessionSourcePairs, ...paymentSessionTypeSourcePairs]) {
    const entry = manifest.files.find((/** @type {{target:string}} */ file) => file.target === pair.target);
    assert.equal(entry.sourceSha256, createHash("sha256").update(readFileSync(pair.source)).digest("hex"));
    assert.equal(entry.targetSha256, createHash("sha256").update(readFileSync(pair.target)).digest("hex"));
  }
});
