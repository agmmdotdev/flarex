// @ts-check
import ts from "@typescript/typescript6";
import { adaptInternalMetadataReplacement } from "./check-medusa-order-change-cancellation-source.mjs";

const failure = "Changed native Tax Rate update source";
export const taxRateUpdateSourcePairs = Object.freeze([
  { source: "third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/update-tax-rates.ts",
    target: "packages/medusa-core-flows/src/tax/workflows/update-tax-rates.ts", classification: "taxRateUpdateFork" },
  { source: "third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/update-tax-rates.ts",
    target: "packages/medusa-core-flows/src/tax/steps/update-tax-rates.ts", classification: "taxRateUpdateFork" },
].map(pair => Object.freeze(pair)));
export const updateMetadataSourcePairs = Object.freeze([
  { source: "third_party/medusa/upstream/packages/core/utils/src/modules-sdk/medusa-internal-service.ts",
    target: "packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts", classification: "updateMetadataFork" },
  { source: "third_party/medusa/upstream/packages/core/utils/src/modules-sdk/medusa-internal-service.ts",
    target: "packages/medusa-utils/src/modules-sdk/prepare-update-metadata.ts", classification: "updateMetadataFork" },
].map(pair => Object.freeze(pair)));
export const taxRuleCreatorTypeSourcePair = Object.freeze({
  source: "third_party/medusa/upstream/packages/core/types/src/tax/mutations.ts",
  target: "packages/medusa-types/src/tax/mutations.ts", classification: "taxRuleCreatorTypeFork",
});

/** Reject missing, repeated, redirected, reclassified or adjacent pairs.
 * @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyTaxRateUpdateSelection(files) {
  const pairs = [...taxRateUpdateSourcePairs, ...updateMetadataSourcePairs, taxRuleCreatorTypeSourcePair];
  for (const pair of pairs) {
    if (files.filter(file => file.source === pair.source && file.target === pair.target &&
      file.classification === pair.classification).length !== 1) throw new Error(failure + ": source pair selection");
  }
  for (const file of files) {
    if (!["taxRateUpdateFork", "updateMetadataFork", "taxRuleCreatorTypeFork"].includes(file.classification) &&
      !pairs.some(pair => pair.source === file.source || pair.target === file.target)) continue;
    if (!pairs.some(pair => pair.source === file.source && pair.target === file.target &&
      pair.classification === file.classification)) throw new Error(failure + ": source pair selection");
  }
}

/** The original update root owns created_by even when its value is undefined.
 * Under exactOptionalPropertyTypes admit exactly that native creator value in
 * CreateTaxRateRuleDTO; every other declaration and emitted byte stays native.
 * @param {string} nativeTypes @param {string} types */
export function verifyTaxRuleCreatorType(nativeTypes, types) {
  const source = nativeTypes.replaceAll("\r\n", "\n");
  const parsed = ts.createSourceFile("tax-mutations.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declarations = parsed.statements.filter(node => ts.isInterfaceDeclaration(node) && node.name.text === "CreateTaxRateRuleDTO");
  const declaration = declarations[0];
  if (declarations.length !== 1 || declaration === undefined || !ts.isInterfaceDeclaration(declaration))
    throw new Error(failure + ": Rule creator type anchor");
  const members = declaration.members.filter(node => ts.isPropertySignature(node) && ts.isIdentifier(node.name) && node.name.text === "created_by");
  const member = members[0];
  if (members.length !== 1 || member === undefined || !ts.isPropertySignature(member) || member.questionToken === undefined ||
    member.type === undefined || member.type.getText(parsed) !== "string | null")
    throw new Error(failure + ": Rule creator type anchor");
  const expected = source.slice(0, member.type.getStart(parsed)) + "string | null | undefined" + source.slice(member.type.end);
  const expectedPrograms = programs(expected), nativePrograms = programs(source), actualPrograms = programs(types);
  if (expectedPrograms[0] !== actualPrograms[0] || nativePrograms[1] !== actualPrograms[1])
    throw new Error(failure + ": Rule creator type adaptation");
}

/** Extract the one exact original internal-service loop. Its only typed
 * relocation replaces the method-local InferEntityType<TEntity> cast with the
 * helper's generic entity type; emitted mutation and evaluation order stay exact.
 * @param {string} nativeInternal @param {string} internal @param {string} helper */
export function verifyUpdateMetadataExtraction(nativeInternal, internal, helper) {
  const source = nativeInternal.replaceAll("\r\n", "\n");
  const start = '      // Manage metadata if needed\n';
  const finish = '\n\n      const entities = await this[propertyRepositoryName].update(';
  if (source.split(start).length !== 2 || source.split(finish).length !== 2)
    throw new Error(failure + ": metadata extraction anchor");
  const begin = source.indexOf(start), end = source.indexOf(finish, begin);
  const original = source.slice(begin, end);
  const loop = original.slice(start.length);
  if (loop.split("InferEntityType<TEntity>").length !== 2 || loop.split("toUpdateData.forEach").length !== 2)
    throw new Error(failure + ": metadata extraction body");
  const beforeImport = 'import { mergeMetadata } from "../common/merge-metadata"';
  if (source.split(beforeImport).length !== 2) throw new Error(failure + ": metadata extraction import");
  const expectedInternal = adaptInternalMetadataReplacement(source.replace(beforeImport, 'import { prepareUpdateMetadata } from "./prepare-update-metadata"')
    .replace(original, start + '      prepareUpdateMetadata(toUpdateData)'));
  const expectedHelper = 'import { isPresent } from "../common/is-present"\n' +
    'import { mergeMetadata } from "../common/merge-metadata"\n\n' +
    'export function prepareUpdateMetadata<TEntity, TUpdate>(\n' +
    '  toUpdateData: readonly { entity: TEntity; update: TUpdate }[]\n' +
    '): void {\n' + loop.replaceAll(/^    /gm, "").replace("InferEntityType<TEntity>", "TEntity") + '\n}\n';
  for (const [expected, actual] of [[expectedInternal, internal], [expectedHelper, helper]]) {
    const expectedPrograms = programs(expected), actualPrograms = programs(actual);
    if (expectedPrograms[0] !== actualPrograms[0] || expectedPrograms[1] !== actualPrograms[1]) throw new Error(failure + ": native metadata extraction");
  }
}

/** Complete typed and emitted modules preserve public types/import flags,
 * native transforms, inline maybe-list callback, ordering and retained inverse.
 * Comments/layout do not carry runtime or contract authority.
 * @param {string} source @returns {readonly [string,string]} */
function programs(source) {
  const emitted = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    experimentalDecorators: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
    throw new Error(failure + ": syntax");
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return [printer.printFile(ts.createSourceFile("tax-rate-update.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
    printer.printFile(ts.createSourceFile("tax-rate-update.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS))];
}

/** Allow only the four exact package relocations and original step-barrel leaves.
 * Preserve original projected preimages and public update, original inline Rule
 * list/create/delete flow, actor override, immediate output and upsert inverse.
 * No optional upsert root, helper rewrite or native business change is selected.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyTaxRateUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  /** @param {string} text @param {string} before @param {string} after */
  const replace = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error(failure + ": relocation anchor");
    return text.replace(before, after);
  };
  let expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n");
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/types"', 'from "@medusajs/types/tax/index"');
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow,
    'import {\n  createTaxRateRulesStep,\n  deleteTaxRateRulesStep,\n  updateTaxRatesStep,\n} from "../steps"',
    'import { createTaxRateRulesStep } from "../steps/create-tax-rate-rules"\n' +
    'import { deleteTaxRateRulesStep } from "../steps/delete-tax-rate-rules"\n' +
    'import { updateTaxRatesStep } from "../steps/update-tax-rates"');
  let expectedStep = nativeStep.replaceAll("\r\n", "\n");
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/types"', 'from "@medusajs/types/tax/index"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedStep = replace(expectedStep, "  updateTaxRatesStepId,", '  { name: updateTaxRatesStepId, compensation: "transactionCovered" },');
  for (const [expected, actual] of [[expectedWorkflow, workflow], [expectedStep, step]]) {
    const expectedPrograms = programs(expected), actualPrograms = programs(actual);
    if (expectedPrograms[0] !== actualPrograms[0] || expectedPrograms[1] !== actualPrograms[1]) throw new Error(failure);
  }
}
