// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failure = "Changed native Order Change deletion source";
const sourcePrefix = "third_party/medusa/upstream/packages/core/core-flows/src/order/";
const targetPrefix = "packages/medusa-core-flows/src/order/";

export const orderChangeDeletionSourcePairs = Object.freeze([
  "steps/delete-order-changes.ts", "workflows/delete-order-change.ts",
].map(file => Object.freeze({ source: sourcePrefix + file, target: targetPrefix + file,
  classification: "orderChangeDeletionFork" })));

/** Only the exact native step and root receive this classification. Adjacent
 * Order workflows retain their independent source owners and admission gates.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyOrderChangeDeletionSourceSelection(files) {
  for (const pair of orderChangeDeletionSourcePairs) {
    const selected = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.target !== pair.target ||
      selected[0]?.classification !== pair.classification) throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (file.classification === "orderChangeDeletionFork" && !orderChangeDeletionSourcePairs.some(pair =>
      pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
  return text.replace(before, after);
}

/** Preserve the complete native types, raw IDs, callbacks, calls and ordering.
 * Only portable import paths, the standard transaction-covered declaration and
 * the erased root void annotation differ. Exactly three pinned blank JSDoc
 * lines lose their trailing space; no callback or root body is rewritten.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyOrderChangeDeletionSource(source, target, destination) {
  if (!orderChangeDeletionSourcePairs.some(pair => pair.target === destination)) throw new Error(failure + ": unknown source " + destination);
  let expected = source.replaceAll("\r\n", "\n");
  expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  if (destination === targetPrefix + "steps/delete-order-changes.ts") {
    expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    expected = replace(expected, "  deleteOrderChangesStepId,\n", '  { name: deleteOrderChangesStepId, compensation: "transactionCovered" },\n');
  } else {
    expected = replace(expected, 'from "../steps"', 'from "../steps/delete-order-changes"');
    expected = replace(expected, "): WorkflowData<void> => {", "): void => {");
    if ((expected.match(/^ \* $/gm) ?? []).length !== 3) throw new Error(failure + ": documentation transport anchor");
    expected = expected.replace(/^ \* $/gm, " *");
  }
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error(failure + ": complete source " + destination);
}

/** Authenticate original bytes against the pinned manifest before any complete
 * source comparison. A changed comparison snapshot cannot grant new behavior.
 * @param {string} root */
export function verifyOrderChangeDeletionFiles(root) {
  const bytes = readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"));
  const hash = (/** @type {Uint8Array} */ value) => createHash("sha256").update(value).digest("hex");
  if (hash(bytes) !== "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017")
    throw new Error(failure + ": pinned source manifest");
  const hashes = new Map(bytes.toString("utf8").trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error(failure + ": malformed source manifest");
    return [match[2], match[1]];
  }));
  for (const pair of orderChangeDeletionSourcePairs) {
    const source = readFileSync(path.join(root, pair.source));
    if (hash(source) !== hashes.get(pair.source.slice("third_party/medusa/".length))) throw new Error(failure + ": pinned source " + pair.source);
    verifyOrderChangeDeletionSource(source.toString("utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  }
  return { sourcePairs: orderChangeDeletionSourcePairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyOrderChangeDeletionFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} pinned Order Change deletion source pairs.\n`);
}
