import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "@typescript/typescript6";
import { adaptCartCreateDeclarations } from "./check-medusa-cart-create-declarations.mjs";
import { cartCreateWorkflowSourcePairs, verifyCartCreateWorkflowSelection, verifyCartCreateWorkflowSource } from "./check-medusa-cart-create-workflows-source.mjs";

test("retains the complete pinned native Cart creation closure", () => {
  verifyCartCreateWorkflowSelection(cartCreateWorkflowSourcePairs);
  for (const pair of cartCreateWorkflowSourcePairs) {
    const source = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8");
    verifyCartCreateWorkflowSource(source, target, pair.target);
    assert.throws(() => verifyCartCreateWorkflowSource(source, target + "\nthrow new Error('changed callback');", pair.target));
  }
});

test("rejects missing, repeated, redirected and reclassified native source entries", () => {
  const first = cartCreateWorkflowSourcePairs[0];
  assert.ok(first);
  for (const files of [cartCreateWorkflowSourcePairs.slice(1), [...cartCreateWorkflowSourcePairs, first],
    [{ ...first, source: first.source + ".other" }, ...cartCreateWorkflowSourcePairs.slice(1)],
    [{ ...first, classification: "unchanged" }, ...cartCreateWorkflowSourcePairs.slice(1)],
    [...cartCreateWorkflowSourcePairs, { ...first, source: first.source + ".other", target: first.target + ".other" }]]) {
    assert.throws(() => verifyCartCreateWorkflowSelection(files));
  }
});

test("selected native declaration adaptations preserve emitted callback programs", () => {
  /** @param {string} text */
  const emit = text => {
    const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    } });
    assert.equal(result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error), false);
    return result.outputText;
  };
  for (const pair of cartCreateWorkflowSourcePairs) {
    const source = readFileSync(pair.source, "utf8").replaceAll("\r\n", "\n");
    assert.equal(emit(adaptCartCreateDeclarations(source, pair.target)), emit(source), pair.target);
  }
});
