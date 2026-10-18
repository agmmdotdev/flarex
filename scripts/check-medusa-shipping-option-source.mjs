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
  if (Object.keys(overrides).some(name => !files.some(([file]) => file === name))) throw new Error(failure + ": unknown packet file");
  for (const [file, compensatedId] of files) {
    const source = (overrides[file]?.source ?? readFileSync(path.join(root,
      "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment", file), "utf8")).replaceAll("\r\n", "\n");
    const target = overrides[file]?.target ?? readFileSync(path.join(root,
      "packages/medusa-core-flows/src/fulfillment", file), "utf8");
    let expected = source;
    if (file !== "../common/steps/emit-event.ts") {
      expected = replaceChecked(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"', 1, failure);
      expected = replaceChecked(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"', 1, failure);
    } else expected = replaceChecked(expected, "      options: input.options,",
      "      ...(input.options === undefined ? {} : { options: input.options }),", 1, failure);
    if (file === "workflows/create-shipping-options.ts") {
      expected = replaceChecked(expected, 'import {\n  createShippingOptionsPriceSetsStep,\n  upsertShippingOptionsStep,\n} from "../steps"',
        'import { createShippingOptionsPriceSetsStep } from "../steps/add-shipping-options-prices"\nimport { upsertShippingOptionsStep } from "../steps/upsert-shipping-options"', 1, failure);
      expected = replaceChecked(expected, 'from "../../common"', 'from "../../common/steps/emit-event"', 1, failure);
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
