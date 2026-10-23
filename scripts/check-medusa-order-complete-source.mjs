// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failure = "Changed native Order completion source";
const sourcePrefix = "third_party/medusa/upstream/packages/core/core-flows/src/order/";
const targetPrefix = "packages/medusa-core-flows/src/order/";

export const orderCompleteSourcePairs = Object.freeze([
  "steps/complete-orders.ts", "workflows/complete-orders.ts",
].map(file => Object.freeze({ source: sourcePrefix + file, target: targetPrefix + file,
  classification: "orderCompleteFork" })));

/** Only the two named native modules receive this adaptation classification.
 * Other independently admitted Order source remains its existing owner's scope.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyOrderCompleteSourceSelection(files) {
  for (const pair of orderCompleteSourcePairs) {
    const selected = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.target !== pair.target ||
      selected[0]?.classification !== pair.classification) throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (file.classification === "orderCompleteFork" && !orderCompleteSourcePairs.some(pair =>
      pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
  return text.replace(before, after);
}

/** Preserve complete native types, callbacks, preimages, hook and event ordering.
 * Only portable import paths and the existing transaction-covered declaration
 * differ; this profile does not alter native Order business behavior.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyOrderCompleteSource(source, target, destination) {
  if (!orderCompleteSourcePairs.some(pair => pair.target === destination)) throw new Error(failure + ": unknown source " + destination);
  let expected = source.replaceAll("\r\n", "\n");
  expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  if (destination === targetPrefix + "steps/complete-orders.ts")
    expected = replace(expected, "  completeOrdersStepId,\n", '  { name: completeOrdersStepId, compensation: "transactionCovered" },\n');
  else expected = replace(expected, 'from "../steps"', 'from "../steps/complete-orders"');
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error(failure + ": complete source " + destination);
}

/** @param {string} root */
export function verifyOrderCompleteFiles(root) {
  const bytes = readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"));
  const hash = (/** @type {Uint8Array} */ value) => createHash("sha256").update(value).digest("hex");
  if (hash(bytes) !== "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017")
    throw new Error(failure + ": pinned source manifest");
  const hashes = new Map(bytes.toString("utf8").trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error(failure + ": malformed source manifest");
    return [match[2], match[1]];
  }));
  for (const pair of orderCompleteSourcePairs) {
    const source = readFileSync(path.join(root, pair.source));
    if (hash(source) !== hashes.get(pair.source.slice("third_party/medusa/".length))) throw new Error(failure + ": pinned source " + pair.source);
    verifyOrderCompleteSource(source.toString("utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  }
  return { sourcePairs: orderCompleteSourcePairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyOrderCompleteFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} pinned Order completion source pairs.\n`);
}
