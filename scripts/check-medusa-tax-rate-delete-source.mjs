// @ts-check
import ts from "@typescript/typescript6";

const failure = "Changed native Tax Rate deletion source";
export const taxRateDeletionSourcePairs = Object.freeze([
  { source: "third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/delete-tax-rates.ts",
    target: "packages/medusa-core-flows/src/tax/workflows/delete-tax-rates.ts", classification: "taxRateDeletionFork" },
  { source: "third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/delete-tax-rates.ts",
    target: "packages/medusa-core-flows/src/tax/steps/delete-tax-rates.ts", classification: "taxRateDeletionFork" },
].map(pair => Object.freeze(pair)));

/** Refuse missing, repeated, redirected and reclassified native source pairs,
 * including applying this classification to any adjacent workflow or step.
 * Unrelated, separately guarded promotion records can remain in the manifest.
 * @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyTaxRateDeletionSelection(files) {
  for (const pair of taxRateDeletionSourcePairs) {
    if (files.filter(file => file.source === pair.source && file.target === pair.target &&
      file.classification === pair.classification).length !== 1) throw new Error(failure + ": source pair selection");
  }
  for (const file of files) {
    if (file.classification !== "taxRateDeletionFork" &&
      !taxRateDeletionSourcePairs.some(pair => pair.source === file.source || pair.target === file.target)) continue;
    if (!taxRateDeletionSourcePairs.some(pair => pair.source === file.source && pair.target === file.target &&
      pair.classification === file.classification)) throw new Error(failure + ": source pair selection");
  }
}

/** Compare the complete typed and emitted modules. Printing retains public
 * contracts and erased import flags; emission authenticates runtime callbacks.
 * TypeScript's syntax-only emitter here performs no typecheck.
 * @param {string} source @returns {readonly [string,string]} */
function programs(source) {
  const emitted = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
    throw new Error(failure + ": syntax");
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return [printer.printFile(ts.createSourceFile("tax-rate-delete.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
    printer.printFile(ts.createSourceFile("tax-rate-delete.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS))];
}

/** Keep genuine void output, unconditional forward Tax resolution/call and raw
 * retained IDs. Only the exact portable import relocations, direct step import,
 * erased SDK void-reference metadata and covered-step declaration are admitted.
 * In particular, the Rule deletion step's empty-forward early return is absent.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyTaxRateDeletionCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  /** @param {string} text @param {string} before @param {string} after */
  const replace = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
    return text.replace(before, after);
  };
  let expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n");
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow, 'from "../steps"', 'from "../steps/delete-tax-rates"');
  expectedWorkflow = replace(expectedWorkflow, "  createWorkflow,", "  createWorkflow,\n  type WorkflowDefinition,");
  expectedWorkflow = replace(expectedWorkflow, "export const deleteTaxRatesWorkflow = createWorkflow(",
    "export const deleteTaxRatesWorkflow: WorkflowDefinition<\n  DeleteTaxRatesWorkflowInput,\n  WorkflowData<void>,\n  readonly []\n> = createWorkflow(");
  expectedWorkflow = replace(expectedWorkflow, "WorkflowResponse<void>", "WorkflowResponse<WorkflowData<void>>");
  let expectedStep = nativeStep.replaceAll("\r\n", "\n");
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/types"', 'from "@medusajs/types/tax/index"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedStep = replace(expectedStep, "  deleteTaxRatesStepId,", '  { name: deleteTaxRatesStepId, compensation: "transactionCovered" },');
  for (const [expected, actual] of [[expectedWorkflow, workflow], [expectedStep, step]]) {
    const expectedPrograms = programs(expected), actualPrograms = programs(actual);
    if (expectedPrograms[0] !== actualPrograms[0] || expectedPrograms[1] !== actualPrograms[1]) throw new Error(failure);
  }
}
