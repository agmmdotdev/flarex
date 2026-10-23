// @ts-check
import ts from "@typescript/typescript6";

const failure = "Changed native Tax Rate Rule replacement source";
export const taxRuleReplacementSourcePairs = Object.freeze([
  { source: "third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/set-tax-rate-rules.ts",
    target: "packages/medusa-core-flows/src/tax/workflows/set-tax-rate-rules.ts", classification: "taxRuleReplacementFork" },
  { source: "third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/list-tax-rate-rule-ids.ts",
    target: "packages/medusa-core-flows/src/tax/steps/list-tax-rate-rule-ids.ts", classification: "taxRuleReplacementFork" },
].map(pair => Object.freeze(pair)));

/** Reject omitted, repeated, redirected or reclassified source pairs, including
 * applying this classification to an adjacent workflow or step.
 * @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyTaxRuleReplacementSelection(files) {
  for (const pair of taxRuleReplacementSourcePairs) {
    if (files.filter(file => file.source === pair.source && file.target === pair.target &&
      file.classification === pair.classification).length !== 1) throw new Error(failure + ": source pair selection");
  }
  for (const file of files) {
    if (file.classification !== "taxRuleReplacementFork" &&
      !taxRuleReplacementSourcePairs.some(pair => pair.source === file.source || pair.target === file.target)) continue;
    if (!taxRuleReplacementSourcePairs.some(pair => pair.source === file.source && pair.target === file.target &&
      pair.classification === file.classification)) throw new Error(failure + ": source pair selection");
  }
}

/** Compare complete typed and emitted modules. The typed printer retains
 * import type flags and public contracts; emission authenticates actual callback
 * order and all runtime operators. Comments and layout carry no authority.
 * @param {string} source @returns {readonly [string,string]} */
function programs(source) {
  const emitted = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
    throw new Error(failure + ": syntax");
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return [printer.printFile(ts.createSourceFile("tax-replacement.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
    printer.printFile(ts.createSourceFile("tax-replacement.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS))];
}

/** Preserve the genuine replacement composer and list callback, including the
 * unconditional Tax resolution/list, complete ID projection, rules-first
 * Cartesian expansion, parent overwrite and unconditional create([]). Existing
 * creation/deletion guards continue to own both genuine compensation callbacks.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeList @param {string} list */
export function verifyTaxRuleReplacementCallbacks(nativeWorkflow, workflow, nativeList, list) {
  /** @param {string} text @param {string} before @param {string} after */
  const replace = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
    return text.replace(before, after);
  };
  let expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n");
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/types"', 'from "@medusajs/types/tax/index"');
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow,
    'import {\n  createTaxRateRulesStep,\n  deleteTaxRateRulesStep,\n  listTaxRateRuleIdsStep,\n} from "../steps"',
    'import { createTaxRateRulesStep } from "../steps/create-tax-rate-rules"\n' +
    'import { deleteTaxRateRulesStep } from "../steps/delete-tax-rate-rules"\n' +
    'import { listTaxRateRuleIdsStep } from "../steps/list-tax-rate-rule-ids"');
  let expectedList = replace(nativeList, 'from "@medusajs/framework/types"', 'from "@medusajs/types/tax/index"');
  expectedList = replace(expectedList, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedList = replace(expectedList, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  for (const [expected, actual] of [[expectedWorkflow, workflow], [expectedList, list]]) {
    const expectedPrograms = programs(expected), actualPrograms = programs(actual);
    if (expectedPrograms[0] !== actualPrograms[0] || expectedPrograms[1] !== actualPrograms[1]) throw new Error(failure);
  }
}
