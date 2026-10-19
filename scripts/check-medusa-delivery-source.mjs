// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

const failure = "Changed native Fulfillment delivery closure behavior";
/** @type {ReadonlyArray<readonly [string, string, string]>} */
export const deliverySourcePairs = [
  ...["workflows/mark-fulfillment-as-delivered.ts", "workflows/update-fulfillment.ts", "steps/update-fulfillment.ts"].map(file =>
    /** @type {const} */ (["packages/medusa-core-flows/src/durable/fulfillment/" + file,
      "packages/core/core-flows/src/fulfillment/" + file, "workflowFork"])),
  ...["acquire-lock.ts", "release-lock.ts"].map(file => /** @type {const} */ ([
    "packages/medusa-core-flows/src/durable/locking/steps/" + file, "packages/core/core-flows/src/locking/steps/" + file, "workflowFork"])),
  ["packages/medusa-core-flows/src/durable/common/steps/use-remote-query.ts", "packages/core/core-flows/src/common/steps/use-remote-query.ts", "workflowFork"],
  ...["services/locking-provider.ts", "providers/in-memory.ts", "types/index.ts", "loaders/static-providers.ts"].map(file =>
    /** @type {const} */ (["packages/medusa-locking/src/" + file, "packages/modules/locking/src/" + file, "importRelocation"])),
  ["packages/medusa-locking/src/services/locking-module.ts", "packages/modules/locking/src/services/locking-module.ts", "lockingServiceFork"],
  ["packages/medusa-locking/src/services/index.ts", "packages/modules/locking/src/services/index.ts", "unchanged"],
  ["packages/medusa-types/src/locking/index.ts", "packages/core/types/src/locking/index.ts", "unchanged"],
];

/** @param {string} text @param {string} before @param {string} after @param {number} count */
function replaceChecked(text, before, after, count = 1) {
  if (text.split(before).length !== count + 1) throw new Error(failure + ": native adaptation anchor");
  return text.replaceAll(before, after);
}
/** @param {string} text */
function runtime(text) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, experimentalDecorators: true,
    removeComments: true, newLine: ts.NewLineKind.LineFeed,
  } });
  if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure + ": syntax");
  return emitted.outputText;
}
/** @param {string} source @param {string} file */
function adapt(source, file) {
  let expected = source.replaceAll("\r\n", "\n");
  if (expected.includes('from "@medusajs/framework/workflows-sdk"')) expected = replaceChecked(expected,
    'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk/durable"');
  else if (file.includes("/durable/") && expected.includes('from "@medusajs/workflows-sdk"')) expected = replaceChecked(expected,
    'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk/durable"');
  if (expected.includes('from "@medusajs/framework/utils"')) expected = replaceChecked(expected,
    'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  if (file.endsWith("workflows/mark-fulfillment-as-delivered.ts")) {
    expected = replaceChecked(expected, 'import { useRemoteQueryStep } from "../../common"',
      'import { useRemoteQueryStep } from "../../common/steps/use-remote-query.js"');
    expected = replaceChecked(expected, 'from "./update-fulfillment"', 'from "./update-fulfillment.js"');
    expected = replaceChecked(expected, 'import { acquireLockStep, releaseLockStep } from "../../locking"',
      'import { acquireLockStep } from "../../locking/steps/acquire-lock.js"\nimport { releaseLockStep } from "../../locking/steps/release-lock.js"');
    expected = replaceChecked(expected, "  markFulfillmentAsDeliveredWorkflowId,",
      "  { name: markFulfillmentAsDeliveredWorkflowId, store: true, storeExecution: true },");
    expected = replaceChecked(expected, "    acquireLockStep({\n      key: id,", String.raw`    const ownerId = transform({ id }, (_input, context) => {
      const transactionId = context.context?.transactionId
      if (typeof transactionId !== "string" || transactionId.length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Fulfillment delivery lock requires the native transaction context"
        )
      }
      return ` + "`fulfillment-delivery:${transactionId}`" + String.raw`
    })

    acquireLockStep({
      key: id,
      ownerId,`);
    expected = replaceChecked(expected, "    releaseLockStep({\n      key: id,\n", "    releaseLockStep({\n      key: id,\n      ownerId,\n");
  }
  if (file.endsWith("workflows/update-fulfillment.ts")) {
    expected = replaceChecked(expected, 'from "../steps"', 'from "../steps/update-fulfillment.js"');
    expected = replaceChecked(expected, "  updateFulfillmentWorkflowId,",
      "  { name: updateFulfillmentWorkflowId, store: true, storeExecution: true },");
  }
  if (file.endsWith("locking/steps/acquire-lock.ts")) {
    expected = replaceChecked(expected, 'import { setTimeout } from "timers/promises"\n', "");
    expected = replaceChecked(expected, "      await setTimeout(retryInterval * 1000)",
      "      await new Promise<void>((resolve) => {\n        globalThis.setTimeout(resolve, retryInterval * 1000)\n      })");
  }
  if (file.startsWith("packages/medusa-locking/")) {
    if (expected.includes('from "../types"')) expected = replaceChecked(expected, 'from "../types"', 'from "../types/index"');
    if (expected.includes('from "../services"')) expected = replaceChecked(expected, 'from "../services"', 'from "../services/index"');
    if (file.endsWith("services/locking-module.ts")) {
      // ES2022 emits a class field even when its type is erased. Remove exactly
      // the unused ORM field and its only assignment at this construction seam.
      expected = replaceChecked(expected, "  protected manager: EntityManager\n", "");
      expected = replaceChecked(expected, "    this.manager = container.manager\n", "");
    }
  }
  return expected;
}

/** Authenticate the complete selected native runtime modules. Overrides exist
 * only for negative guard tests; unknown files and missing anchors fail closed.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyFulfillmentDeliveryCallbacks(root, overrides = {}) {
  if (Object.keys(overrides).some(file => !deliverySourcePairs.some(([target]) => target === file)))
    throw new Error(failure + ": unknown packet file");
  for (const [target, source] of deliverySourcePairs) {
    const sourceText = overrides[target]?.source ?? readFileSync(path.join(root, "third_party/medusa/upstream", source), "utf8");
    const targetText = overrides[target]?.target ?? readFileSync(path.join(root, target), "utf8");
    if (runtime(adapt(sourceText, target)) !== runtime(targetText)) throw new Error(failure + ": " + target);
  }
}

/** Preserve the original InvokeFn contract with only the actual native skip
 * value added to both synchronous and Promise return unions.
 * @param {string} source @param {string} target */
export function verifyNativeSkipStepResponseType(source, target) {
  /** @param {string} text */
  const alias = text => {
    const parsed = ts.createSourceFile("create-step.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const declarations = parsed.statements.filter(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === "InvokeFn");
    if (declarations.length !== 1 || !ts.isTypeAliasDeclaration(declarations[0])) throw new Error(failure + ": native InvokeFn");
    return declarations[0].getText(parsed).replaceAll("\r\n", "\n");
  };
  const expected = replaceChecked(replaceChecked(alias(source), "  | void\n", "  | void\n  | SkipStepResponse\n"),
    "Promise<void | StepResponse<", "Promise<void | SkipStepResponse | StepResponse<");
  if (expected.replace(/\s+/g, "") !== alias(target).replace(/\s+/g, "")) throw new Error(failure + ": native skip return type");
  const parsed = ts.createSourceFile("create-step.ts", target, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const imported = parsed.statements.some(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === "@medusajs/orchestration/transaction/errors" && statement.importClause?.isTypeOnly
    && statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(binding => binding.name.text === "SkipStepResponse"));
  if (!imported) throw new Error(failure + ": native skip type import");
}
