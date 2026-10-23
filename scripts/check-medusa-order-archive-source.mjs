// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { orderCompleteSourcePairs } from "./check-medusa-order-complete-source.mjs";

const failure = "Changed native Order archive source";
const nativePrefix = "third_party/medusa/upstream/";
const moduleSource = nativePrefix + "packages/modules/order/src/";
const moduleTarget = "packages/medusa-order/src/";
const workflowSource = nativePrefix + "packages/core/core-flows/src/order/";
const workflowTarget = "packages/medusa-core-flows/src/order/";
const helperSource = nativePrefix + "packages/core/utils/src/order/";
const helperTarget = "packages/medusa-utils/src/order/";

// This explicit closure excludes the entry point, ORM repositories/hooks,
// migrations and unrelated Order workflows. Source presence grants no runtime
// adapter capability. The archive step's separately named business fork keeps
// primitive preimages under the user's approved native compensation correction.
const unchanged = [
  "static-manifest.ts", "models/index.ts", "schema/index.ts", "services/index.ts",
  "types/address.ts", "types/index.ts", "types/line-item-adjustment.ts",
  "types/line-item-tax-line.ts", "types/line-item.ts", "types/order-change.ts",
  "types/order-detail.ts", "types/return-reason.ts", "types/shipping-method-adjustment.ts",
  "types/shipping-method-tax-line.ts", "types/shipping-method.ts", "types/tax-line.ts",
  "types/transaction.ts", "utils/apply-decorators.ts", "utils/index.ts",
  "utils/set-action-reference.ts", "services/actions/index.ts", "types/utils/index.ts",
  "utils/actions/index.ts",
];
const relocated = [
  "models/address.ts", "models/claim-item-image.ts", "models/claim-item.ts", "models/claim.ts",
  "models/credit-line.ts", "models/exchange-item.ts", "models/exchange.ts",
  "models/line-item-adjustment.ts", "models/line-item-tax-line.ts", "models/line-item.ts",
  "models/order-change-action.ts", "models/order-change.ts", "models/order-item.ts",
  "models/order-shipping-method.ts", "models/order-summary.ts", "models/order.ts",
  "models/return-item.ts", "models/return-reason.ts", "models/return.ts",
  "models/shipping-method-adjustment.ts", "models/shipping-method-tax-line.ts",
  "models/shipping-method.ts", "models/transaction.ts", "services/order-module-service.ts",
  "services/order-service.ts", "types/order.ts", "utils/apply-order-changes.ts",
  "utils/calculate-order-change.ts", "utils/transform-order.ts", "services/actions/cancel-claim.ts",
  "services/actions/cancel-exchange.ts", "services/actions/cancel-fulfillment.ts",
  "services/actions/cancel-return.ts", "services/actions/create-claim.ts",
  "services/actions/create-exchange.ts", "services/actions/create-return.ts",
  "services/actions/receive-return.ts", "services/actions/register-delivery.ts",
  "services/actions/register-fulfillment.ts", "services/actions/register-shipment.ts",
  "utils/actions/cancel-item-fulfillment.ts", "utils/actions/cancel-return.ts",
  "utils/actions/change-shipping-address.ts", "utils/actions/credit-line-add.ts",
  "utils/actions/deliver-item.ts", "utils/actions/fulfill-item.ts", "utils/actions/item-add.ts",
  "utils/actions/item-adjustments-replace.ts", "utils/actions/item-remove.ts",
  "utils/actions/item-update.ts", "utils/actions/promotion-add.ts", "utils/actions/promotion-remove.ts",
  "utils/actions/receive-damaged-return-item.ts", "utils/actions/receive-return-item.ts",
  "utils/actions/reinstate-item.ts", "utils/actions/return-item.ts", "utils/actions/ship-item.ts",
  "utils/actions/shipping-add.ts", "utils/actions/shipping-remove.ts",
  "utils/actions/shipping-update.ts", "utils/actions/transfer-customer.ts", "utils/actions/write-off-item.ts",
];

export const orderArchiveSourcePairs = Object.freeze([
  { source: nativePrefix + "LICENSE", target: "packages/medusa-order/LICENSE", classification: "unchanged" },
  ...unchanged.map(file => ({ source: moduleSource + file, target: moduleTarget + file, classification: "unchanged" })),
  ...relocated.map(file => ({ source: moduleSource + file, target: moduleTarget + file, classification: "importRelocation" })),
  { source: moduleSource + "joiner-config.ts", target: moduleTarget + "joiner-config.ts", classification: "orderArchiveFork" },
  ...["index.ts", "order-change-action.ts", "order-change.ts", "status.ts"].map(file => ({
    source: helperSource + file, target: helperTarget + file, classification: "unchanged",
  })),
  ...["index.ts", "service.ts"].map(file => ({
    source: nativePrefix + "packages/core/types/src/order/" + file,
    target: "packages/medusa-types/src/order/" + file, classification: "unchanged",
  })),
  ...["steps/archive-orders.ts", "workflows/archive-orders.ts"].map(file => ({
    source: workflowSource + file, target: workflowTarget + file,
    classification: file.startsWith("steps/") ? "orderArchiveCompensationFork" : "orderArchiveFork",
  })),
].map(pair => Object.freeze(pair)));

// Package scaffolding is authored by the root integration, never represented as
// native source or used to admit other Order files.
export const orderArchiveAuthoredTargets = Object.freeze([
  "packages/medusa-order/package.json", "packages/medusa-order/tsconfig.json",
]);

/** Accept a complete promotion manifest without granting adjacent Order files.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyOrderArchiveSourceSelection(files) {
  for (const pair of orderArchiveSourcePairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.classification !== pair.classification)
      throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (orderArchiveAuthoredTargets.includes(file.target) && file.source === undefined && file.classification === "authored") continue;
    // Completion has its own exact source proof and grants no wider Order closure.
    if (orderCompleteSourcePairs.some(pair => pair.source === file.source && pair.target === file.target &&
      pair.classification === file.classification)) continue;
    const relevant = ["orderArchiveFork", "orderArchiveCompensationFork"].includes(file.classification) || file.target.startsWith("packages/medusa-order/") ||
      file.target.startsWith(workflowTarget) || file.target.startsWith(helperTarget) ||
      file.source?.startsWith(moduleSource) || file.source?.startsWith(workflowSource) || file.source?.startsWith(helperSource) ||
      orderArchiveSourcePairs.some(pair => pair.source !== nativePrefix + "LICENSE" && pair.source === file.source);
    if (relevant && !orderArchiveSourcePairs.some(pair => pair.source === file.source && pair.target === file.target &&
      pair.classification === file.classification)) throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
  return text.replace(before, after);
}

/** Preserve every native byte except newline convention and named relocations.
 * This includes erased types, decorators, status changes, retained inverse and
 * event/step ordering. The original post-archive inverse remains the explicit
 * source witness for the approved primitive-preimage correction below.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyOrderArchiveSource(source, target, destination) {
  const pair = orderArchiveSourcePairs.find(pair => pair.target === destination);
  if (pair === undefined) throw new Error(failure + ": unknown source " + destination);
  let expected = source.replaceAll("\r\n", "\n");
  if (pair.classification === "importRelocation") {
    if (!expected.includes('"@medusajs/framework/utils"')) throw new Error(failure + ": portable import anchor");
    expected = expected.replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"');
  } else if (destination === moduleTarget + "joiner-config.ts") {
    expected = replace(expected, 'import { defineJoinerConfig, Modules } from "@medusajs/framework/utils"',
      'import { Modules } from "@medusajs/framework/utils/portable"\n' +
      'import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"');
    expected = replace(expected, "defineJoinerConfig(Modules.ORDER", "defineJoinerConfigFromModels(Modules.ORDER");
  } else if (["orderArchiveFork", "orderArchiveCompensationFork"].includes(pair.classification)) {
    expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    if (destination === workflowTarget + "steps/archive-orders.ts") {
      expected = replace(expected, "  archiveOrdersStepId,\n", '  { name: archiveOrdersStepId, compensation: "transactionCovered" },\n');
      expected = replace(expected,
        "    const archived = await service.archive(data.orderIds)\n" +
        "    return new StepResponse(\n" +
        "      archived,\n" +
        "      archived.map((store) => {\n" +
        "        return {\n" +
        "          id: store.id,\n" +
        "          status: store.status,\n" +
        "        }\n" +
        "      })\n" +
        "    )",
        "    // Keep primitive preimages before archive mutates its returned Orders.\n" +
        "    const previousOrders = await service.listOrders(\n" +
        "      { id: data.orderIds },\n" +
        '      { select: ["id", "status"] }\n' +
        "    )\n" +
        "    const previousStatuses = previousOrders.map((order) => ({\n" +
        "      id: order.id,\n" +
        "      status: order.status,\n" +
        "    }))\n" +
        "    const archived = await service.archive(data.orderIds)\n" +
        "    return new StepResponse(archived, previousStatuses)");
    } else {
      expected = replace(expected, 'from "../steps"', 'from "../steps/archive-orders"');
    }
  }
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error(failure + ": complete source " + destination);
}

/** Standalone source proof; the central promotion guard separately authenticates
 * authored files, package/export admission and emitted build inventories.
 * @param {string} root */
export function verifyOrderArchiveFiles(root) {
  const bytes = readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"));
  const hash = (/** @type {Uint8Array} */ value) => createHash("sha256").update(value).digest("hex");
  if (hash(bytes) !== "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017")
    throw new Error(failure + ": pinned source manifest");
  const hashes = new Map(bytes.toString("utf8").trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error(failure + ": malformed source manifest");
    return [match[2], match[1]];
  }));
  for (const pair of orderArchiveSourcePairs) {
    const source = readFileSync(path.join(root, pair.source));
    if (hash(source) !== hashes.get(pair.source.slice("third_party/medusa/".length)))
      throw new Error(failure + ": pinned source " + pair.source);
    verifyOrderArchiveSource(source.toString("utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  }
  return { sourcePairs: orderArchiveSourcePairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyOrderArchiveFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} pinned Order archive source pairs.\n`);
}
