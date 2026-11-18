// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failure = "Changed approved native Order Change decline source";
const prefix = "third_party/medusa/upstream/";
const manifestSha256 = "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017";
const classTarget = "packages/medusa-order/src/services/order-module-service.ts";
const mutationTarget = "packages/medusa-types/src/order/mutations.ts";
const interfaceTarget = "packages/medusa-types/src/order/service.ts";

// Shared targets retain their existing promotion records and full-source owner.
// Only the two new leaves introduce a decline-specific classification.
export const orderChangeDeclineSourcePairs = Object.freeze([
  ...["steps/decline-order-change.ts", "workflows/decline-order-change.ts"].map(file => ({
    source: prefix + "packages/core/core-flows/src/order/" + file,
    target: "packages/medusa-core-flows/src/order/" + file, classification: "orderChangeDeclineFork",
  })),
  ...["order/mutations.ts", "order/service.ts"].map(file => ({
    source: prefix + "packages/core/types/src/" + file, target: "packages/medusa-types/src/" + file,
    classification: "orderChangeCancellationRestoreFork",
  })),
  { source: prefix + "packages/modules/order/src/services/order-module-service.ts",
    target: classTarget, classification: "orderChangeCancellationRestoreFork" },
].map(pair => Object.freeze(pair)));

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": adaptation anchor " + before.slice(0, 80));
  return text.replace(before, after);
}

const restoreDTO = `/** The retained fields restored when an order change decline is undone. */
export interface RestoreOrderChangeDeclineDTO {
  id: string
  status: string | null
  declined_at: Date | string | null
  declined_by: string | null
  metadata?: Record<string, unknown> | null
}

`;
const restoreInterface = `  /** Restore only the retained fields changed by an order change decline. */
  restoreOrderChangeDecline(
    data: RestoreOrderChangeDeclineDTO,
    sharedContext?: Context
  ): Promise<OrderChangeDTO>

`;
const restoreMethod = `  /** Restore a decline preimage without metadata merge or entity creation. */
  @InjectManager()
  @EmitEvents()
  @InjectTransactionManager()
  async restoreOrderChangeDecline(
    data: OrderTypes.RestoreOrderChangeDeclineDTO,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<OrderChangeDTO> {
    const update: OrderTypes.RestoreOrderChangeDeclineDTO = {
      id: data.id,
      status: data.status,
      declined_at: data.declined_at,
      declined_by: data.declined_by,
    }
    if (Object.prototype.hasOwnProperty.call(data, "metadata")) {
      update.metadata = data.metadata
    }
    const restored = await this.orderChangeService_.update(
      update,
      sharedContext,
      { metadata: "replace" }
    )
    return await this.baseRepository_.serialize<OrderChangeDTO>(restored)
  }

`;
const correctedStep = `import type {
  DeclineOrderChangeDTO,
  IOrderModuleService,
  RestoreOrderChangeDeclineDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const declineOrderChangeStepId = "decline-order-change"
/** This step declines an order change and retains its decline preimage. */
export const declineOrderChangeStep = createStep(
  { name: declineOrderChangeStepId, compensation: "transactionCovered" },
  async (data: DeclineOrderChangeDTO, { container }) => {
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    const hasMetadata = Object.prototype.hasOwnProperty.call(data, "metadata")
    const previous = await service.retrieveOrderChange(data.id, {
      select: ["id", "status", "declined_at", "declined_by", ...(hasMetadata ? ["metadata"] : [])],
      relations: [],
    })
    const retained: RestoreOrderChangeDeclineDTO = {
      id: previous.id,
      status: previous.status,
      declined_at: previous.declined_at,
      declined_by: previous.declined_by,
    }
    if (hasMetadata) {
      retained.metadata = previous.metadata
    }
    const preimage = structuredClone(retained)
    await service.declineOrderChange(data)
    return new StepResponse(void 0, preimage)
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) {
      return
    }
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    await service.restoreOrderChangeDecline(structuredClone(rollbackData))
  }
)
`;

/** The canonical cancellation verifier authenticates the whole shared source.
 * These are only the finite additions applied after that prefix (and finance
 * extraction for the class), never a second pinned-to-live class comparison.
 * @param {string} destination */
function sharedInsertions(destination) {
  if (destination === mutationTarget) return [{
    before: '/**\n * The details of declining the order change.', addition: restoreDTO,
  }];
  if (destination === interfaceTarget) return [
    { before: '  RestoreOrderChangeCancellationDTO,\n', addition: '  RestoreOrderChangeDeclineDTO,\n' },
    { before: '  /**\n   * This method declines an order change.\n', addition: restoreInterface },
  ];
  if (destination === classTarget) return [{
    before: '  async declineOrderChange(orderChangeId: string, sharedContext?: Context)', addition: restoreMethod,
  }];
  throw new Error(failure + ": unselected shared source " + destination);
}

/** Apply only the named, approved correction. Shared input must be the fully
 * authenticated cancellation prefix, plus finance extraction for the class.
 * @param {string} source @param {string} destination */
export function adaptOrderChangeDeclineSource(source, destination) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (destination === "packages/medusa-core-flows/src/order/steps/decline-order-change.ts") {
    if (createHash("sha256").update(normalized).digest("hex") !== "440299cb7e1de13b8c9e8d08c294eefc2a810e84bd0901d31eaa18faa3f7fb75")
      throw new Error(failure + ": original decline step anchor");
    return correctedStep;
  }
  if (destination === "packages/medusa-core-flows/src/order/workflows/decline-order-change.ts") {
    if (createHash("sha256").update(normalized).digest("hex") !== "b6676cad93793692432510838db4f73f9328d83b0dfb9594af12451221da7835")
      throw new Error(failure + ": original decline root anchor");
    let expected = replace(normalized, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    expected = replace(expected, '): WorkflowData<void> => {', '): void => {');
    return replace(expected, 'from "../steps"', 'from "../steps/decline-order-change"');
  }
  if (/\b(?:RestoreOrderChangeDeclineDTO|restoreOrderChangeDecline)\b/.test(normalized))
    throw new Error(failure + ": decline correction already present");
  let expected = normalized;
  for (const insertion of sharedInsertions(destination))
    expected = replace(expected, insertion.before, insertion.addition + insertion.before);
  return expected;
}

/** Full comparisons here belong only to the two new leaves. Shared sources
 * must pass the existing canonical owner with decline adaptation applied last.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyOrderChangeDeclineSource(source, target, destination) {
  const pair = orderChangeDeclineSourcePairs.find(selected => selected.target === destination);
  if (pair === undefined) throw new Error(failure + ": unknown pair");
  if (pair.classification !== "orderChangeDeclineFork")
    throw new Error(failure + ": shared source requires canonical composition");
  if (adaptOrderChangeDeclineSource(source, destination) !== target.replaceAll("\r\n", "\n"))
    throw new Error(failure + ": complete source " + destination);
}

/** Verify the exact finite additions without claiming ownership of the rest of
 * a shared class/type file. The returned prefix is for composition diagnostics;
 * canonical full-source verification is independently required by promotion.
 * @param {string} target @param {string} destination */
export function verifyOrderChangeDeclineSharedSource(target, destination) {
  let prefixSource = target.replaceAll("\r\n", "\n");
  for (const insertion of sharedInsertions(destination))
    prefixSource = replace(prefixSource, insertion.addition + insertion.before, insertion.before);
  if (/\b(?:RestoreOrderChangeDeclineDTO|restoreOrderChangeDecline)\b/.test(prefixSource))
    throw new Error(failure + ": additional decline restoration source");
  return prefixSource;
}

/** @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyOrderChangeDeclineSourceSelection(files) {
  for (const pair of orderChangeDeclineSourcePairs) {
    const selected = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.target !== pair.target ||
      selected[0]?.classification !== pair.classification) throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (file.classification === "orderChangeDeclineFork" &&
      !orderChangeDeclineSourcePairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {unknown} pin @param {Uint8Array} manifest */
export function verifyOrderChangeDeclineProvenance(pin, manifest) {
  if (typeof pin !== "object" || pin === null || !("commit" in pin) || !("packageBaseline" in pin) ||
    !("sourceManifestSha256" in pin) || pin.commit !== "48d5cc675e4e8bc821e22c20c88a751acc66fb5f" ||
    pin.packageBaseline !== "2.13.4" || pin.sourceManifestSha256 !== manifestSha256 ||
    createHash("sha256").update(manifest).digest("hex") !== manifestSha256)
    throw new Error(failure + ": pinned provenance");
  return new Map(Buffer.from(manifest).toString("utf8").trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error(failure + ": malformed manifest");
    return [match[2], match[1]];
  }));
}

/** Only standalone leaves receive complete comparisons here. Shared files
 * receive provenance and finite-addition checks; the canonical cancellation
 * guard must compose cancellation -> finance (class only) -> decline once.
 * @param {string} root */
export function verifyOrderChangeDeclineFiles(root) {
  const pin = JSON.parse(readFileSync(path.join(root, "third_party/medusa/SOURCE.json"), "utf8"));
  const hashes = verifyOrderChangeDeclineProvenance(pin, readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS")));
  for (const pair of orderChangeDeclineSourcePairs) {
    const source = readFileSync(path.join(root, pair.source));
    if (createHash("sha256").update(source).digest("hex") !== hashes.get(pair.source.slice("third_party/medusa/".length)))
      throw new Error(failure + ": pinned source");
    const target = readFileSync(path.join(root, pair.target), "utf8");
    if (pair.classification === "orderChangeDeclineFork") verifyOrderChangeDeclineSource(source.toString("utf8"), target, pair.target);
    else verifyOrderChangeDeclineSharedSource(target, pair.target);
  }
  return { sourcePairs: 5, standalonePairs: 2, composedPairs: 3 };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyOrderChangeDeclineFiles(process.cwd());
  process.stdout.write(`Verified ${result.standalonePairs} pinned Order Change decline leaves and ${result.composedPairs} finite shared corrections; canonical shared-source verification remains required.\n`);
}
