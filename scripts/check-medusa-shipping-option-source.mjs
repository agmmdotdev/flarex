// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

const failure = "Changed native Shipping Option creation callback behavior";
/** @type {ReadonlyArray<readonly [string, string | undefined]>} */
const files = [
  ["workflows/create-shipping-options.ts", undefined],
  ["steps/add-shipping-options-prices.ts", "createShippingOptionsPriceSetsStepId"],
  ["steps/set-shipping-options-price-sets.ts", "setShippingOptionsPriceSetsStepId"],
  ["steps/upsert-shipping-options.ts", "upsertShippingOptionsStepId"],
  ["steps/validate-fulfillment-providers.ts", undefined],
  ["steps/validate-shipping-option-prices.ts", undefined],
  ["../common/steps/emit-event.ts", "emitEventStepId"],
];

/** Type annotations, assertions and comments have no executable authority.
 * Complete emitted modules retain imports, callback order and every helper.
 * @param {string} text @param {string} message */
function runtime(text, message) {
  const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    experimentalDecorators: true, removeComments: true, newLine: ts.NewLineKind.LineFeed,
  } });
  if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(message);
  return result.outputText;
}

/** Never silently accept a changed or duplicated native adaptation anchor.
 * @param {string} text @param {string} before @param {string} after @param {number} count @param {string} message */
function replaceChecked(text, before, after, count, message) {
  if (text.split(before).length !== count + 1) throw new Error(message + ": native adaptation anchor");
  return text.replaceAll(before, after);
}

/** Authenticate the six Shipping files and shared event step/fourth inverse.
 * Optional explicit
 * source/target text overrides support negative provenance controls; production
 * callers read the pinned paths without overrides.
 * @param {string} root
 * @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyShippingOptionCreateCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, files, failure, overrides);
}

/** @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyShippingOptionUpdateCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, [
    ["workflows/update-shipping-options.ts", undefined],
    ["steps/set-shipping-options-prices.ts", "setShippingOptionsPricesStepId"],
    ...files.filter(([file]) => ["steps/upsert-shipping-options.ts", "steps/validate-fulfillment-providers.ts",
      "steps/validate-shipping-option-prices.ts", "../common/steps/emit-event.ts"].includes(file)),
  ], "Changed native Shipping Option update callback behavior", overrides);
}

/** Exact native deletion composer and raw-ID retained callback; empty-reference
 * representation remains with the existing SDK and common Link step.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyShippingOptionDeleteCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, [
    ["workflows/delete-shipping-options.ts", undefined],
    ["steps/delete-shipping-options.ts", "deleteShippingOptionsStepId"],
  ], "Changed native Shipping Option deletion callback behavior", overrides);
}

/** Genuine Fulfillment creation retains the native Location query, provider
 * service call and cancellation callback. Only imports, erased declarations and
 * the existing finite SDK's compensation metadata may differ.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyFulfillmentCreationCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, [
    ["workflows/create-fulfillment.ts", undefined],
    ["steps/create-fulfillment.ts", "createFulfillmentStepId"],
  ], "Changed native Fulfillment creation callback behavior", overrides);
}

/** Return creation retains the selected native Location query, return service
 * call, retained ID and ordinary cancellation inverse without extra guards.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyReturnFulfillmentCreationCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, [
    ["workflows/create-return-fulfillment.ts", undefined],
    ["steps/create-return-fulfillment.ts", "createReturnFulfillmentStepId"],
  ], "Changed native return Fulfillment creation callback behavior", overrides);
}

/** Standalone cancellation retains the void StepResponse and declared ID, with
 * no business compensator. The existing private SDK needs only its explicit
 * void WorkflowResponse composer edge, plus exact import relocations.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyFulfillmentCancellationCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, [
    ["workflows/cancel-fulfillment.ts", undefined],
    ["steps/cancel-fulfillment.ts", undefined],
  ], "Changed native Fulfillment cancellation callback behavior", overrides);
}

/** Shipment keeps its native guard order, generated date, nested update,
 * input-derived preimage and original retained inverse. Only finite imports
 * and the established transaction-covered compensation annotation differ.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyFulfillmentShipmentCallbacks(root, overrides = {}) {
  return verifyShippingCallbacks(root, [
    ["workflows/create-shipment.ts", undefined],
    ["workflows/update-fulfillment.ts", undefined],
    ["steps/validate-shipment.ts", undefined],
    ["steps/update-fulfillment.ts", "updateFulfillmentStepId"],
  ], "Changed native Fulfillment shipment callback behavior", overrides);
}

/** @param {string} root @param {ReadonlyArray<readonly [string, string | undefined]>} files
 * @param {string} failure @param {Record<string, {source?: string, target?: string}>} overrides */
function verifyShippingCallbacks(root, files, failure, overrides) {
  if (Object.keys(overrides).some(name => !files.some(([file]) => file === name))) throw new Error(failure + ": unknown packet file");
  for (const [file, compensatedId] of files) {
    const source = (overrides[file]?.source ?? readFileSync(path.join(root,
      "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment", file), "utf8")).replaceAll("\r\n", "\n");
    const target = overrides[file]?.target ?? readFileSync(path.join(root,
      "packages/medusa-core-flows/src/fulfillment", file), "utf8");
    let expected = file === "steps/upsert-shipping-options.ts" ? adaptRuleCompensation(source, "option", failure)
      : file === "steps/set-shipping-options-prices.ts" ? adaptRuleCompensation(source, "pricing", failure) : source;
    if (file !== "../common/steps/emit-event.ts") {
      expected = replaceChecked(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"', 1, failure);
      if (!["workflows/create-fulfillment.ts", "workflows/create-return-fulfillment.ts", "workflows/cancel-fulfillment.ts", "workflows/create-shipment.ts", "workflows/update-fulfillment.ts"].includes(file)) expected = replaceChecked(expected, 'from "@medusajs/framework/utils"', file === "steps/delete-shipping-options.ts"
        ? 'from "@medusajs/utils/modules-sdk/definition"' : 'from "@medusajs/framework/utils/portable"', 1, failure);
    } else expected = replaceChecked(expected, "      options: input.options,",
      "      ...(input.options === undefined ? {} : { options: input.options }),", 1, failure);
    if (file === "workflows/create-shipping-options.ts") {
      expected = replaceChecked(expected, 'import {\n  createShippingOptionsPriceSetsStep,\n  upsertShippingOptionsStep,\n} from "../steps"',
        'import { createShippingOptionsPriceSetsStep } from "../steps/add-shipping-options-prices"\nimport { upsertShippingOptionsStep } from "../steps/upsert-shipping-options"', 1, failure);
      expected = replaceChecked(expected, 'from "../../common"', 'from "../../common/steps/emit-event"', 1, failure);
    }
    if (file === "workflows/create-fulfillment.ts") {
      expected = replaceChecked(expected, 'from "../steps"', 'from "../steps/create-fulfillment"', 1, failure);
      expected = replaceChecked(expected, 'from "../../common"', 'from "../../common/steps/use-remote-query"', 1, failure);
    }
    if (file === "workflows/create-return-fulfillment.ts") {
      expected = replaceChecked(expected, 'from "../steps"', 'from "../steps/create-return-fulfillment"', 1, failure);
      expected = replaceChecked(expected, 'from "../../common"', 'from "../../common/steps/use-remote-query"', 1, failure);
    }
    if (file === "workflows/cancel-fulfillment.ts") {
      expected = replaceChecked(expected, "WorkflowData, createWorkflow", "WorkflowData, WorkflowResponse, createWorkflow", 1, failure);
      expected = replaceChecked(expected, 'from "../steps"', 'from "../steps/cancel-fulfillment"', 1, failure);
      expected = replaceChecked(expected, "    cancelFulfillmentStep(input.id)\n", "    cancelFulfillmentStep(input.id)\n    return new WorkflowResponse(void 0)\n", 1, failure);
    }
    if (file === "workflows/create-shipment.ts") expected = replaceChecked(expected,
      'from "../steps"', 'from "../steps/validate-shipment"', 1, failure);
    if (file === "workflows/update-fulfillment.ts") expected = replaceChecked(expected,
      'from "../steps"', 'from "../steps/update-fulfillment"', 1, failure);
    if (file === "workflows/update-shipping-options.ts") {
      expected = replaceChecked(expected, 'import {\n  setShippingOptionsPricesStep,\n  upsertShippingOptionsStep,\n} from "../steps"',
        'import { setShippingOptionsPricesStep } from "../steps/set-shipping-options-prices"\nimport { upsertShippingOptionsStep } from "../steps/upsert-shipping-options"', 1, failure);
      expected = replaceChecked(expected, 'from "../../common"', 'from "../../common/steps/emit-event"', 1, failure);
    }
    if (file === "workflows/delete-shipping-options.ts") {
      expected = replaceChecked(expected, "  WorkflowData,\n", "  WorkflowData,\n  WorkflowResponse,\n", 1, failure);
      expected = replaceChecked(expected, 'from "../steps"', 'from "../steps/delete-shipping-options"', 1, failure);
      expected = replaceChecked(expected, 'import { emitEventStep, removeRemoteLinkStep } from "../../common"',
        'import { emitEventStep } from "../../common/steps/emit-event"\nimport { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"', 1, failure);
      expected = replaceChecked(expected, "    )\n  }\n)", "    )\n    return new WorkflowResponse(void 0)\n  }\n)", 1, failure);
    }
    if (file === "steps/delete-shipping-options.ts") {
      expected = replaceChecked(expected, 'import { DeleteEntityInput } from "@medusajs/framework/modules-sdk"',
        'import type { DeleteEntityInput } from "../../common/steps/remove-remote-links"', 1, failure);
      expected = replaceChecked(expected, 'from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"', 1, failure);
    }
    if (file === "steps/set-shipping-options-price-sets.ts") expected = replaceChecked(expected,
      'from "@medusajs/framework/modules-sdk"', 'from "@medusajs/modules-sdk/link"', 1, failure);
    if (compensatedId !== undefined) expected = replaceChecked(expected, "  " + compensatedId + ",",
      '  { name: ' + compensatedId + ', compensation: "transactionCovered" },', 1, failure);
    if (runtime(expected, failure) !== runtime(target, failure)) throw new Error(failure + ": " + file);
  }
}

/** Region keeps its complete native model/service/joiner manifest. Only the
 * Country defaults bootstrap is absent from the portable runtime.
 * @param {string} source @param {string} target */
export function verifyRegionManifestFork(source, target) {
  const message = "Changed native Region manifest fork behavior";
  let expected = replaceChecked(source.replaceAll("\r\n", "\n"), 'import loadDefaults from "./loaders/defaults"\n', "", 1, message);
  expected = replaceChecked(expected, "loaders: [loadDefaults]", "loaders: []", 2, message);
  if (runtime(expected, message) !== runtime(target, message)) throw new Error(message);
}

/** @type {ReadonlyArray<readonly [string, string]>} */
const optionRuleCompensation = [
  [String.raw`export const upsertShippingOptionsStepId =`, String.raw`async function restoreShippingOptionRulePreimages(
  previous: { id: string; rules?: (CreateShippingOptionRuleDTO & { id: string })[] }[],
  service: IFulfillmentModuleService
) {
  const withRules = previous.filter(option => Object.hasOwn(option, "rules"))
  if (!withRules.length) return
  // The native DML supports the owner FK although its filter DTO omits it.
  const filters: FilterableShippingOptionRuleProps & { shipping_option_id: string[] } = {
    shipping_option_id: withRules.map(option => option.id),
  }
  const current = await service.listShippingOptionRules(
    filters,
    { select: ["id", "shipping_option_id"] }
  )
  const original = withRules.flatMap(option =>
    (option.rules ?? []).map(rule => ({ ...rule, shipping_option_id: option.id }))
  )
  const currentIds = new Set(current.map(rule => rule.id))
  const originalIds = new Set(original.map(rule => rule.id))
  const missing = original.filter(rule => !currentIds.has(rule.id))
  if (missing.length) await service.createShippingOptionRules(missing)
  const introduced = current.filter(rule => !originalIds.has(rule.id)).map(rule => rule.id)
  if (introduced.length) await service.deleteShippingOptionRules(introduced)
}

export const upsertShippingOptionsStepId =`],
  [String.raw`      toUpdatePreviousData = await fulfillmentService.listShippingOptions(`, String.raw`      if (toUpdate.some(option => Object.hasOwn(option, "rules"))) {
        const fullSelects = selects.filter(field => !field.startsWith("rules."))
        selects.splice(0, selects.length, ...fullSelects, "rules.*")
        if (!relations.includes("rules")) relations.push("rules")
      }
      toUpdatePreviousData = await fulfillmentService.listShippingOptions(`],
  [String.raw`      await fulfillmentService.upsertShippingOptions(
        shippingOptionIds.updatedPreviousData
      )`, String.raw`      await restoreShippingOptionRulePreimages(
        shippingOptionIds.updatedPreviousData, fulfillmentService
      )
      await fulfillmentService.upsertShippingOptions(
        shippingOptionIds.updatedPreviousData
      )`]
];

/** @type {ReadonlyArray<readonly [string, string]>} */
const priceRuleCompensation = [
  [String.raw`export const setShippingOptionsPricesStepId =`, String.raw`async function restorePriceRulePreimages(
  prices: PriceDTO[],
  service: IPricingModuleService
) {
  if (!prices.length) return
  const existing = await service.listPrices(
    { id: prices.map(price => price.id) }, { select: ["id"] }
  )
  const existingIds = new Set(existing.map(price => price.id))
  const original = prices.filter(price => existingIds.has(price.id)).flatMap(price =>
    (price.price_rules ?? []).map(rule => ({ ...rule, price_id: price.id }))
  )
  if (!original.length) return
  const existingRules = await service.listPriceRules(
    { id: original.map(rule => rule.id) }, { select: ["id"] }
  )
  const existingRuleIds = new Set(existingRules.map(rule => rule.id))
  const missing = original.filter(rule => !existingRuleIds.has(rule.id))
  if (missing.length) await service.createPriceRules(missing)
}

export const setShippingOptionsPricesStepId =`],
  [String.raw`    for (const data_ of data) {`, String.raw`    const priorPrices = currentShippingOptionPricesData.flatMap(item => item.prices ?? [])
    if (priorPrices.length) {
      const priorRules = await pricingService.listPriceRules({
        price_id: priorPrices.map(price => price.id),
      })
      for (const item of currentShippingOptionPricesData) {
        item.prices = item.prices.map(price => ({
          ...price,
          price_rules: priorRules.filter(rule => rule.price_id === price.id),
        }))
      }
    }
    for (const data_ of data) {`],
  [String.raw`    for (const data_ of rollbackData) {`, String.raw`    await restorePriceRulePreimages(
      rollbackData.flatMap(data => data.prices ?? []), pricingService
    )
    for (const data_ of rollbackData) {`]
];

/** Approved139 workflow business correction, kept distinct from import relocation.
 * @param {string} source @param {"option" | "pricing"} kind @param {string} message */
function adaptRuleCompensation(source, kind, message) {
  for (const [before, after] of kind === "option" ? optionRuleCompensation : priceRuleCompensation)
    source = replaceChecked(source, before, after, 1, message);
  return source;
}
