// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { adaptOrderFinanceSource, verifyOrderFinanceHelpers } from "./check-medusa-order-finance-source.mjs";

import { adaptOrderChangeDeclineSource } from "./check-medusa-order-change-decline-source.mjs";

const failure = "Changed approved native Order Change cancellation source";
const prefix = "third_party/medusa/upstream/";
export const orderChangeCancellationSourcePairs = Object.freeze([
  ...["steps/cancel-order-change.ts", "workflows/cancel-order-change.ts"].map(file => ({
    source: prefix + "packages/core/core-flows/src/order/" + file,
    target: "packages/medusa-core-flows/src/order/" + file, classification: "orderChangeCancellationFork",
  })),
  ...["dal/repository-service.ts", "modules-sdk/medusa-internal-service.ts", "order/mutations.ts", "order/service.ts"].map(file => ({
    source: prefix + "packages/core/types/src/" + file, target: "packages/medusa-types/src/" + file,
    classification: "orderChangeCancellationRestoreFork",
  })),
  { source: prefix + "packages/modules/order/src/services/order-module-service.ts",
    target: "packages/medusa-order/src/services/order-module-service.ts", classification: "orderChangeCancellationRestoreFork" },
].map(pair => Object.freeze(pair)));

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": adaptation anchor " + before.slice(0, 80));
  return text.replace(before, after);
}

/** Apply the approved update option after the separately proven native metadata
 * extraction. All ordinary update overloads retain their existing semantics.
 * @param {string} source */
export function adaptInternalMetadataReplacement(source) {
  let expected = replace(source, '  UpsertWithReplaceConfig,', '  UpsertWithReplaceConfig,\n  DAL,');
  for (const parameter of ["data: any[]", "data: any", "selectorAndData: SelectorAndData", "selectorAndData: SelectorAndData[]"]) {
    expected = replace(expected, `    update(\n      ${parameter},\n      sharedContext?: Context`,
      `    update(\n      ${parameter},\n      sharedContext?: Context,\n      options?: DAL.UpdateOptions`);
  }
  expected = replace(expected, '      input: any | any[] | SelectorAndData | SelectorAndData[],\n      @MedusaContext() sharedContext: Context = {}',
    '      input: any | any[] | SelectorAndData | SelectorAndData[],\n      @MedusaContext() sharedContext: Context = {},\n      options?: DAL.UpdateOptions');
  expected = replace(expected, '      prepareUpdateMetadata(toUpdateData)',
    '      if (options?.metadata !== "replace") {\n        prepareUpdateMetadata(toUpdateData)\n      }');
  return replace(expected, '        toUpdateData,\n        sharedContext\n', '        toUpdateData,\n        sharedContext,\n        options\n');
}

/** Native Mikro assignment still merges every ordinary object field. Only an
 * explicitly supplied metadata property receives exact replacement in this mode.
 * @param {string} source */
export function adaptRepositoryMetadataReplacement(source) {
  let expected = replace(source, '  update(\n    data: { entity; update }[],\n    context?: Context',
    '  update(\n    data: { entity; update }[],\n    context?: Context,\n    options?: DAL.UpdateOptions');
  expected = replace(expected, '    async update(\n      data: { entity: any; update: any }[],\n      context?: Context',
    '    async update(\n      data: { entity: any; update: any }[],\n      context?: Context,\n      options?: DAL.UpdateOptions');
  return replace(expected, `      data.forEach(({ entity, update }) => {
        manager.assign(entity, update, {
          mergeObjectProperties: true,
        })
        manager.persist(entity)
      })`, `      data.forEach(({ entity, update }) => {
        const replaceMetadata = options?.metadata === "replace" &&
          Object.prototype.hasOwnProperty.call(update, "metadata")
        const updateFields = replaceMetadata ? { ...update } : update
        if (replaceMetadata) {
          delete updateFields.metadata
        }
        manager.assign(entity, updateFields, {
          mergeObjectProperties: true,
        })
        if (replaceMetadata) {
          manager.assign(entity, { metadata: update.metadata }, {
            mergeObjectProperties: false,
          })
        }
        manager.persist(entity)
      })`);
}

const restoreDTO = `/** The retained fields restored when an order change cancellation is undone. */
export interface RestoreOrderChangeCancellationDTO {
  id: string
  status: string | null
  canceled_at: Date | string | null
  canceled_by: string | null
  metadata?: Record<string, unknown> | null
}

`;
const restoreMethod = `  /** Restore a cancellation preimage without metadata merge or entity creation. */
  @InjectTransactionManager()
  @EmitEvents()
  async restoreOrderChangeCancellation(
    data: OrderTypes.RestoreOrderChangeCancellationDTO,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<OrderChangeDTO> {
    const update: OrderTypes.RestoreOrderChangeCancellationDTO = {
      id: data.id,
      status: data.status,
      canceled_at: data.canceled_at,
      canceled_by: data.canceled_by,
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
  CancelOrderChangeDTO,
  IOrderModuleService,
  RestoreOrderChangeCancellationDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const cancelOrderChangeStepId = "cancel-order-change"
/** This step cancels an order change and retains its cancellation preimage. */
export const cancelOrderChangeStep = createStep(
  { name: cancelOrderChangeStepId, compensation: "transactionCovered" },
  async (data: CancelOrderChangeDTO, { container }) => {
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    const hasMetadata = Object.prototype.hasOwnProperty.call(data, "metadata")
    const previous = await service.retrieveOrderChange(data.id, {
      select: ["id", "status", "canceled_at", "canceled_by", ...(hasMetadata ? ["metadata"] : [])],
      relations: [],
    })
    const retained: RestoreOrderChangeCancellationDTO = {
      id: previous.id,
      status: previous.status,
      canceled_at: previous.canceled_at,
      canceled_by: previous.canceled_by,
    }
    if (hasMetadata) {
      retained.metadata = previous.metadata
    }
    const preimage = structuredClone(retained)
    await service.cancelOrderChange(data)
    return new StepResponse(void 0, preimage)
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) {
      return
    }
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    await service.restoreOrderChangeCancellation(structuredClone(rollbackData))
  }
)
`;

/** Exact, finite approved business correction. The original step remains the
 * separately authenticated comparison witness; the correction replaces only it.
 * @param {string} source @param {string} destination */
export function adaptOrderChangeCancellationSource(source, destination) {
  let expected = source.replaceAll("\r\n", "\n");
  if (destination.endsWith("/steps/cancel-order-change.ts")) {
    if (createHash("sha256").update(expected).digest("hex") !== "9ef7c3cff9403e768687a4883bdf89a93b49f3dbf3c03c515d6b9908f21ee3f5")
      throw new Error(failure + ": original cancellation step anchor");
    return correctedStep;
  }
  if (destination.endsWith("/workflows/cancel-order-change.ts")) {
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    // The native graph has no returned value. Correct its erased annotation to
    // the executing composer's void callback contract without changing emission.
    expected = replace(expected, '): WorkflowData<void> => {', '): void => {');
    return replace(expected, 'from "../steps"', 'from "../steps/cancel-order-change"');
  }
  if (destination === "packages/medusa-types/src/dal/repository-service.ts") {
    expected = replace(expected, '/**\n * Data access layer (DAL)', '/** Metadata assignment policy for an existing-entity update. */\nexport interface UpdateOptions {\n  metadata?: "merge" | "replace"\n}\n\n/**\n * Data access layer (DAL)');
    return replace(expected, '  update(\n    data: { entity; update }[],\n    context?: Context',
      '  update(\n    data: { entity; update }[],\n    context?: Context,\n    options?: UpdateOptions');
  }
  if (destination === "packages/medusa-types/src/modules-sdk/medusa-internal-service.ts") {
    expected = replace(expected, '  UpsertWithReplaceConfig,', '  UpsertWithReplaceConfig,\n  UpdateOptions,');
    const start = expected.indexOf('  update(\n'), end = expected.indexOf('\n  delete(', start);
    if (start < 0 || end < start) throw new Error(failure + ": update interface anchor");
    const original = expected.slice(start, end);
    const updated = original.replaceAll('sharedContext?: Context', 'sharedContext?: Context,\n    options?: UpdateOptions')
      .replace('  update(data: any, sharedContext?: Context,\n    options?: UpdateOptions)', '  update(data: any, sharedContext?: Context, options?: UpdateOptions)');
    return replace(expected, original, updated);
  }
  if (destination === "packages/medusa-types/src/order/mutations.ts")
    return replace(expected, '/**\n * The details of declining the order change.', restoreDTO + '/**\n * The details of declining the order change.');
  if (destination === "packages/medusa-types/src/order/service.ts") {
    expected = replace(expected, '  CancelOrderChangeDTO,', '  CancelOrderChangeDTO,\n  RestoreOrderChangeCancellationDTO,');
    return replace(expected, '  cancelOrderChange(orderId: string, sharedContext?: Context): Promise<void>',
      '  cancelOrderChange(orderId: string, sharedContext?: Context): Promise<void>\n\n' +
      '  /** Restore only the retained fields changed by an order change cancellation. */\n' +
      '  restoreOrderChangeCancellation(\n    data: RestoreOrderChangeCancellationDTO,\n    sharedContext?: Context\n  ): Promise<OrderChangeDTO>');
  }
  if (destination === "packages/medusa-order/src/services/order-module-service.ts") {
    expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    return replace(expected, '  async confirmOrderChange(orderChangeId: string, sharedContext?: Context)',
      restoreMethod + '  async confirmOrderChange(orderChangeId: string, sharedContext?: Context)');
  }
  throw new Error(failure + ": unselected source " + destination);
}

/** @param {string} source @param {string} target @param {string} destination */
export function verifyOrderChangeCancellationSource(source, target, destination) {
  if (!orderChangeCancellationSourcePairs.some(pair => pair.target === destination)) throw new Error(failure + ": unknown pair");
  const corrected = adaptOrderChangeCancellationSource(source, destination);
  const prefix = destination === "packages/medusa-order/src/services/order-module-service.ts"
    ? adaptOrderFinanceSource(corrected) : corrected;
  const expected = ["packages/medusa-order/src/services/order-module-service.ts",
    "packages/medusa-types/src/order/mutations.ts", "packages/medusa-types/src/order/service.ts"].includes(destination)
    ? adaptOrderChangeDeclineSource(prefix, destination) : prefix;
  if (expected !== target.replaceAll("\r\n", "\n"))
    throw new Error(failure + ": complete source " + destination);
}

/** @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyOrderChangeCancellationSourceSelection(files) {
  for (const pair of orderChangeCancellationSourcePairs) {
    const selected = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.target !== pair.target ||
      selected[0]?.classification !== pair.classification) throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (["orderChangeCancellationFork", "orderChangeCancellationRestoreFork"].includes(file.classification) &&
      !orderChangeCancellationSourcePairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} root */
export function verifyOrderChangeCancellationFiles(root) {
  const hash = (/** @type {Uint8Array} */ bytes) => createHash("sha256").update(bytes).digest("hex");
  const manifest = readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"));
  if (hash(manifest) !== "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017") throw new Error(failure + ": pinned manifest");
  const hashes = new Map(manifest.toString("utf8").trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error(failure + ": malformed manifest");
    return [match[2], match[1]];
  }));
  for (const pair of orderChangeCancellationSourcePairs) {
    const source = readFileSync(path.join(root, pair.source));
    if (hash(source) !== hashes.get(pair.source.slice("third_party/medusa/".length))) throw new Error(failure + ": pinned source");
    verifyOrderChangeCancellationSource(source.toString("utf8"), readFileSync(path.join(root, pair.target), "utf8"), pair.target);
    if (pair.target === "packages/medusa-order/src/services/order-module-service.ts")
      verifyOrderFinanceHelpers(source.toString("utf8"),
        readFileSync(path.join(root, "packages/medusa-order/src/utils/payment-accounting.ts"), "utf8"),
        readFileSync(path.join(root, "packages/medusa-order/src/utils/totals-selection.ts"), "utf8"),
        readFileSync(path.join(root, "packages/medusa-order/src/utils/preview-details.ts"), "utf8"));
  }
  return { sourcePairs: orderChangeCancellationSourcePairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyOrderChangeCancellationFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} pinned Order Change cancellation source pairs.\n`);
}
