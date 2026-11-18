// @ts-check
import ts from "@typescript/typescript6";

const failure = "Changed native Inventory confirmation source";
const prefix = "third_party/medusa/upstream/";
export const inventoryConfirmationSourcePairs = Object.freeze([
  ...["cart/steps/confirm-inventory.ts", "cart/utils/prepare-confirm-inventory-input.ts", "cart/workflows/confirm-variant-inventory.ts"].map(file => ({
    source: prefix + "packages/core/core-flows/src/" + file, target: "packages/medusa-core-flows/src/" + file,
    classification: "inventoryConfirmationFork",
  })),
  { source: prefix + "packages/core/utils/src/common/deep-flat-map.ts", target: "packages/medusa-utils/src/common/deep-flat-map.ts", classification: "unchanged" },
  { source: prefix + "packages/core/core-flows/src/cart/utils/__tests__/prepare-confirm-inventory-input.spec.ts",
    target: "packages/medusa-adapter/test/native-confirm-inventory-preparation.test.ts", classification: "testPort" },
].map(pair => Object.freeze(pair)));
export const inventoryAvailabilitySourcePair = Object.freeze({
  source: prefix + "packages/modules/inventory/src/repositories/inventory-level.ts",
  target: "packages/medusa-inventory/src/utils/inventory-level-availability.ts", classification: "selectedExportFacade",
});

/** Each native file has one exact executing owner and classification. Neither
 * relabeling nor copying its source into another target grants admission.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyInventoryConfirmationSourceSelection(files) {
  const pairs = [...inventoryConfirmationSourcePairs, inventoryAvailabilitySourcePair];
  for (const pair of pairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.classification !== pair.classification)
      throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    const pair = pairs.find(pair => pair.target === file.target || pair.source === file.source);
    if (pair !== undefined && (file.target !== pair.target || file.source !== pair.source || file.classification !== pair.classification) ||
      file.classification === "inventoryConfirmationFork" && pair === undefined)
      throw new Error(failure + ": redirected source " + file.target);
  }
}

/** Preserve complete typed and emitted programs. Printer layout and comments
 * are inert; native calls, order, operators and erased ABI types are retained.
 * @param {string} text */
function program(text) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure + ": syntax");
  /** @param {ts.Node} node @returns {unknown} */
  const shape = node => {
    /** @type {unknown[]} */ const children = [];
    ts.forEachChild(node, child => { children.push(shape(child)); });
    return [node.kind, ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : undefined,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : undefined,
      ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : undefined,
      ts.isTemplateLiteralToken(node) ? node.rawText : undefined,
      ts.isMetaProperty(node) ? node.keywordToken : undefined,
      ts.isImportAttributes(node) ? node.token : undefined,
      ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isExportDeclaration(node) || ts.isExportSpecifier(node) ? node.isTypeOnly : undefined,
      children];
  };
  return JSON.stringify([
    shape(ts.createSourceFile("confirmation.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
    shape(ts.createSourceFile("confirmation.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)),
  ]);
}

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
  return text.replace(before, after);
}

/** Exact portable imports and truthful optional-output declarations only.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyInventoryConfirmationFork(source, target, destination) {
  let expected = source;
  if (destination === "packages/medusa-core-flows/src/cart/steps/confirm-inventory.ts") {
    expected = replace(expected, 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
    expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  } else if (destination === "packages/medusa-core-flows/src/cart/utils/prepare-confirm-inventory-input.ts") {
    expected = replace(expected, 'import {\n  BigNumberInput,\n  ConfirmVariantInventoryWorkflowInputDTO,\n} from "@medusajs/framework/types"',
      'import type { BigNumberInput } from "@medusajs/types"\nimport type { ConfirmVariantInventoryWorkflowInputDTO } from "@medusajs/types/cart/index"');
    expected = replace(expected, "  deepFlatMap,\n", "");
    expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"\nimport { deepFlatMap } from "@medusajs/utils/common/deep-flat-map"');
    expected = replace(expected, "interface ConfirmInventoryItem {\n  id?: string", "interface ConfirmInventoryItem {\n  id?: string | undefined");
    expected = replace(expected, "  stockAvailability: Map<string, Map<string, BigNumberInput>>", "  stockAvailability: Map<string, Map<string, BigNumberInput | BigNumber>>");
    expected = replace(expected, "  const mapLocationAvailability = new Map<string, Map<string, BigNumberInput>>()", "  const mapLocationAvailability = new Map<string, Map<string, BigNumberInput | BigNumber>>()");
  } else if (destination === "packages/medusa-core-flows/src/cart/workflows/confirm-variant-inventory.ts") {
    expected = replace(expected, 'import type { ConfirmVariantInventoryWorkflowInputDTO } from "@medusajs/framework/types"',
      'import type { ConfirmVariantInventoryWorkflowInputDTO } from "@medusajs/types/cart/index"');
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    expected = replace(expected, 'import type { BigNumberInput } from "@medusajs/framework/types"', 'import type { BigNumberInput } from "@medusajs/types"');
    expected = replace(expected, 'from "../steps"', 'from "../steps/confirm-inventory"');
    expected = replace(expected, "    id?: string\n", "    id?: string | undefined\n");
  } else if (destination !== "packages/medusa-utils/src/common/deep-flat-map.ts") throw new Error(failure + ": unknown source");
  if (program(expected) !== program(target)) throw new Error(failure + ": complete program");
}

/** Authenticate only the native arithmetic return, not the repository SQL.
 * The adapter's checked selection and receipts own Item/Location membership.
 * @param {string} source @param {string} target */
export function verifyNativeInventoryAvailabilityExtraction(source, target) {
  const native = ts.createSourceFile("inventory-level.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const classes = native.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "InventoryLevelRepository");
  const owner = classes[0];
  if (classes.length !== 1 || owner === undefined || !ts.isClassDeclaration(owner)) throw new Error(failure + ": native repository owner");
  const methods = owner.members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "getAvailableQuantity");
  const method = methods[0];
  if (methods.length !== 1 || method === undefined || !ts.isMethodDeclaration(method) || method.body === undefined)
    throw new Error(failure + ": native availability method");
  const returns = method.body.statements.filter(ts.isReturnStatement), selected = returns[0];
  if (returns.length !== 1 || selected === undefined || method.body.statements.at(-1) !== selected)
    throw new Error(failure + ": native availability return");
  const expected = `import { BigNumber, MathBN } from "@medusajs/framework/utils/portable"
    import type { BigNumberInput } from "@medusajs/framework/types"
    export function inventoryLevelsAvailableQuantity(result: readonly {
      raw_stocked_quantity: BigNumberInput
      raw_reserved_quantity: BigNumberInput
    }[]): BigNumber { ${selected.getText(native)} }`;
  if (program(expected) !== program(target)) throw new Error(failure + ": extracted availability program");
}

/** Keep every native setup, call, assertion and expected value. Only explicit
 * Vitest globals and the selected pure helper/type imports change.
 * @param {string} source @param {string} target */
export function verifyInventoryConfirmationPreparationTest(source, target) {
  let expected = replace(source, 'from "@medusajs/framework/types"', 'from "@medusajs/types/cart/index"');
  expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expected = replace(expected, 'from "../prepare-confirm-inventory-input"', 'from "@medusajs/core-flows/cart/prepare-confirm-inventory-input"');
  expected = 'import { describe, expect, it } from "vitest"\n' + expected;
  if (program(expected) !== program(target)) throw new Error(failure + ": native preparation test");
}
