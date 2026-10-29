import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cartCreationStepSourcePair, verifyCartCreationStepSource } from "./check-medusa-cart-creation-source.mjs";

test("authenticates the exact pinned Cart step and native ownership correction", () => {
  verifyCartCreationStepSource(readFileSync(cartCreationStepSourcePair.source, "utf8"), readFileSync(cartCreationStepSourcePair.target, "utf8"));
});

test("refuses changed native forward, retained inverse and receipt contracts", () => {
  const source = readFileSync(cartCreationStepSourcePair.source, "utf8"), target = readFileSync(cartCreationStepSourcePair.target, "utf8");
  for (const [before, after] of [["createCartsWithOwnership", "createCarts"],
    ["compensateCartsCreation", "deleteCarts"], ["created.receipt", "created.carts"],
    ['compensation: "transactionCovered"', 'compensation: "required"']]) {
    assert.ok(target.includes(before));
    assert.throws(() => verifyCartCreationStepSource(source, target.replace(before, after)), /Changed native Cart creation step source/);
  }
  assert.throws(() => verifyCartCreationStepSource(source + "\nexport const changed = true;", target), /Changed native Cart creation step source/);
});
