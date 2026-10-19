// @ts-check
import ts from "@typescript/typescript6";

/** Native151 keeps raw retained IDs, required Link calls and native inverses.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyPricePreferenceDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const failure = "Changed native PricePreference deletion callback behavior";
  /** @param {string} text @param {string} before @param {string} after */
  const replace = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error(failure + ": missing native adaptation anchor");
    return text.replace(before, after);
  };
  let expectedWorkflow = replace(nativeWorkflow.replaceAll("\r\n", "\n"), 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow, 'from "../steps"', 'from "../steps/delete-price-preferences"');
  let expectedStep = replace(nativeStep.replaceAll("\r\n", "\n"), 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedStep = replace(expectedStep, "  deletePricePreferencesStepId,", '  { name: deletePricePreferencesStepId, compensation: "transactionCovered" },');
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  /** @param {string} text */
  const program = text => printer.printFile(ts.createSourceFile("price-preference-delete.ts", text,
    ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  for (const [expected, target] of [[expectedWorkflow, workflow], [expectedStep, step]]) {
    if (nativeWorkflowProgram(expected, failure) !== nativeWorkflowProgram(target, failure) || program(expected) !== program(target))
      throw new Error(failure);
  }
}

/** Native150 retains the complete selector update, sparse list and inverse
 * upsert callbacks, including the original public type references.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyPricePreferenceUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const failure = "Changed native PricePreference update callback behavior";
  /** @param {string} text @param {string} before @param {string} after */
  const replace = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error(failure + ": missing native adaptation anchor");
    return text.replace(before, after);
  };
  let expectedWorkflow = replace(nativeWorkflow.replaceAll("\r\n", "\n"), 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow, 'from "../steps"', 'from "../steps/update-price-preferences"');
  let expectedStep = replace(nativeStep.replaceAll("\r\n", "\n"), "import {\n  IPricingModuleService,", "import type {\n  IPricingModuleService,");
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedStep = replace(expectedStep, "  updatePricePreferencesStepId,", '  { name: updatePricePreferencesStepId, compensation: "transactionCovered" },');
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  /** @param {string} text */
  const program = text => printer.printFile(ts.createSourceFile("price-preference-update.ts", text,
    ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  for (const [expected, target] of [[expectedWorkflow, workflow], [expectedStep, step]]) {
    if (nativeWorkflowProgram(expected, failure) !== nativeWorkflowProgram(target, failure) || program(expected) !== program(target))
      throw new Error(failure);
  }
}

/** Native149 creation keeps the complete native workflow and retained physical
 * deletion callback. Only direct imports and covered metadata differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyPricePreferenceCreateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const failure = "Changed native PricePreference creation callback behavior";
  /** @param {string} text @param {string} before @param {string} after */
  const replace = (text, before, after) => {
    if (text.split(before).length !== 2) throw new Error(failure + ": missing native adaptation anchor");
    return text.replace(before, after);
  };
  let expectedWorkflow = replace(nativeWorkflow.replaceAll("\r\n", "\n"), 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  expectedWorkflow = replace(expectedWorkflow, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow, 'from "../steps"', 'from "../steps/create-price-preferences"');
  let expectedStep = replace(nativeStep.replaceAll("\r\n", "\n"), "import {\n  IPricingModuleService,", "import type {\n  IPricingModuleService,");
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  expectedStep = replace(expectedStep, 'from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"');
  expectedStep = replace(expectedStep, "  createPricePreferencesStepId,", '  { name: createPricePreferencesStepId, compensation: "transactionCovered" },');
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  /** @param {string} text @param {string} name */
  const contract = (text, name) => {
    const file = ts.createSourceFile("price-preference.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = file.statements.filter(node => ts.isTypeAliasDeclaration(node) && node.name.text === name);
    const selected = declarations[0];
    if (declarations.length !== 1 || selected === undefined) throw new Error(failure);
    const typeImports = file.statements.filter(node => ts.isImportDeclaration(node) && node.importClause?.isTypeOnly);
    return [selected, ...typeImports].map(node => printer.printNode(ts.EmitHint.Unspecified, node, file)).join("\n");
  };
  /** @type {Array<[string,string,string]>} */
  const pairs = [[expectedWorkflow, workflow, "CreatePricePreferencesWorkflowInput"],
    [expectedStep, step, "CreatePricePreferencesStepInput"]];
  for (const [expected, target, name] of pairs) {
    if (nativeWorkflowProgram(expected, failure) !== nativeWorkflowProgram(target, failure) || contract(expected, name) !== contract(target, name))
      throw new Error(failure);
  }
}

/** Native148 Product/Channel membership: only the existing finite SDK input/
 * void wrappers, leaf imports, optional-link types and transaction-covered
 * compensation metadata differ. All native callbacks and empty guards remain.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeAssociation @param {string} association
 * @param {string} nativeDetachment @param {string} detachment */
export function verifySalesChannelProductLinkCallbacks(nativeWorkflow, workflow, nativeAssociation, association, nativeDetachment, detachment) {
  const failure = "Changed native SalesChannel Product membership callback behavior";
  /** @param {string} text @param {string} before @param {string} after @param {number} count */
  const replace = (text, before, after, count = 1) => {
    if (text.split(before).length !== count + 1) throw new Error(failure + ": missing native adaptation anchor");
    return text.replaceAll(before, after);
  };
  /** @param {string} text @param {string} id */
  const step = (text, id) => {
    text = replace(text.replaceAll("\r\n", "\n"),
      'import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"',
      'import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"\nimport type { Link } from "@medusajs/modules-sdk/link"\nimport { Modules } from "@medusajs/utils/modules-sdk/definition"');
    text = replace(text, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    text = replace(text, "  links: {", "  links?: {");
    text = replace(text, "  }[]\n}", "  }[] | undefined\n}");
    text = replace(text, "  " + id + ",", '  { name: ' + id + ', compensation: "transactionCovered" },');
    return replace(text, "container.resolve(ContainerRegistrationKeys.LINK)",
      'container.resolve<Pick<Link, "create" | "dismiss">>(ContainerRegistrationKeys.LINK)', 2);
  };
  let expectedWorkflow = replace(nativeWorkflow.replaceAll("\r\n", "\n"), 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  expectedWorkflow = replace(expectedWorkflow, 'import { WorkflowData, createWorkflow } from "@medusajs/framework/workflows-sdk"',
    'import { type WorkflowData, createWorkflow, WorkflowResponse, transform } from "@medusajs/workflows-sdk"');
  expectedWorkflow = replace(expectedWorkflow, 'import { transform } from "@medusajs/framework/workflows-sdk"\n', "");
  expectedWorkflow = replace(expectedWorkflow, 'from "../steps"', 'from "../steps/detach-products-from-sales-channels"');
  expectedWorkflow = replace(expectedWorkflow, "  ): WorkflowData<void> => {", "  ) => {");
  for (const field of ["add", "remove"]) expectedWorkflow = replace(expectedWorkflow,
    "return data.input." + field + "?.map((productId) => ({", "return { links: data.input." + field + "?.map((productId) => ({");
  expectedWorkflow = replace(expectedWorkflow, "        product_id: productId,\n      }))", "        product_id: productId,\n      })) }", 2);
  expectedWorkflow = replace(expectedWorkflow, "associateProductsWithSalesChannelsStep({ links: toAdd })", "associateProductsWithSalesChannelsStep(toAdd)");
  expectedWorkflow = replace(expectedWorkflow, "detachProductsFromSalesChannelsStep({ links: toRemove })", "detachProductsFromSalesChannelsStep(toRemove)\n    return new WorkflowResponse(void 0)");
  /** @type {Array<[string,string,string]>} */
  const pairs = [[expectedWorkflow, workflow, "LinkProductsToSalesChannelWorkflowInput"],
    [step(nativeAssociation, "associateProductsWithSalesChannelsStepId"), association, "AssociateProductsWithSalesChannelsStepInput"],
    [step(nativeDetachment, "detachProductsFromSalesChannelsStepId"), detachment, "DetachProductsFromSalesChannelsStepInput"]];
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  /** @param {string} text @param {string} name */
  const contract = (text, name) => {
    const file = ts.createSourceFile("membership.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = file.statements.filter(node => (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === name);
    const selected = declarations[0];
    if (declarations.length !== 1 || selected === undefined) throw new Error(failure);
    return printer.printNode(ts.EmitHint.Unspecified, selected, file);
  };
  for (const [expected, target, name] of pairs) {
    if (nativeWorkflowProgram(expected, failure) !== nativeWorkflowProgram(target, failure) || contract(expected, name) !== contract(target, name)) throw new Error(failure);
  }
}

const vitestBindings = new Set(["afterAll", "afterEach", "beforeAll", "beforeEach", "describe", "expect", "it", "test", "vi"]);
const currencyImports = new Map([["../index", "@medusajs/currency/index"], ["../static-manifest", "@medusajs/currency/static-manifest"], ["../models", "@medusajs/currency/models"]]);

/** The complete native CSV suite changes only its explicit test-runner import.
 * Its fixtures remain the exact native files, including their formatting.
 * @param {string} source @param {string} target
 * @param {Record<string, string>} sourceFixtures
 * @param {Record<string, string>} targetFixtures */
export function verifyCsvNormalizerTests(source, target, sourceFixtures, targetFixtures) {
  verifyTestPort(source, target);
  const file = ts.createSourceFile("csv-normalizer.spec.ts", target, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const first = file.statements[0];
  if (first === undefined || !ts.isImportDeclaration(first) || first.getStart(file) !== 0 ||
    !ts.isStringLiteral(first.moduleSpecifier) || first.moduleSpecifier.text !== "vitest")
    throw new Error("Changed native CSV test-runner import");
  const bindings = first.importClause?.namedBindings;
  if (first.importClause?.isTypeOnly || first.importClause?.name || bindings === undefined || !ts.isNamedImports(bindings) ||
    bindings.elements.map(binding => binding.isTypeOnly || binding.propertyName ? null : binding.name.text).join(",") !== "describe,expect,it")
    throw new Error("Changed native CSV test-runner import");
  const nativeText = target.slice(first.end).replace(/^\r?\n/, "").replace(/\r\n/g, "\n");
  if (nativeText !== source.replace(/\r\n/g, "\n")) throw new Error("Changed native CSV suite beyond the test-runner import");
  const names = ["multiple-products-multiple-variants.json", "same-product-multiple-rows.json",
    "same-product-multiple-variant-options.json", "single-row-create.json"].sort();
  if (JSON.stringify(Object.keys(sourceFixtures).sort()) !== JSON.stringify(names) ||
    JSON.stringify(Object.keys(targetFixtures).sort()) !== JSON.stringify(names) ||
    names.some(name => sourceFixtures[name] !== targetFixtures[name]))
    throw new Error("Changed native CSV fixtures");
}

/** Two unchanged native item creation bodies.
 * @param {string} source @param {string} target */
export function verifyInventoryCreateTests(source, target) {
  verifyInventoryTests(source, target, new Set(["should create an inventory item", "should create inventory items from array"]), false);
}

/** Preserve both native update bodies and their complete beforeEach seed.
 * @param {string} source @param {string} target */
export function verifyInventoryUpdateTests(source, target) {
  verifyInventoryTests(source, target, new Set(["should update the inventory item", "should update multiple inventory items"]), true);
}

/** Preserve both native absolute Level update bodies and their original seed.
 * @param {string} source @param {string} target */
export function verifyInventoryLevelUpdateTests(source, target) {
  verifyInventoryTests(source, target, new Set(["should update inventory level", "should fail to update inventory level for item in location that isn't stocked"]), true);
}

/** Exact callback extraction is shared by the Inventory deletion provenance
 * guards; testPortProgram owns type erasure and executable AST comparison.
 * @param {string} text @param {string} name @param {string} factory
 * @param {readonly number[]} indexes */
function inventoryDeletionCallbacks(text, name, factory, indexes) {
  const file = ts.createSourceFile("inventory-delete.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @type {ts.CallExpression[]} */
  const calls = [];
  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      if (calls.length !== 0 || node.initializer === undefined || !ts.isCallExpression(node.initializer)
        || !ts.isIdentifier(node.initializer.expression) || node.initializer.expression.text !== factory)
        throw new Error("Invalid native Inventory deletion callback declaration");
      calls.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const call = calls[0];
  if (call === undefined) throw new Error("Missing native Inventory deletion callback declaration");
  return indexes.map(index => {
    const callback = call.arguments[index];
    if (callback === undefined || (!ts.isFunctionExpression(callback) && !ts.isArrowFunction(callback)))
      throw new Error("Missing native Inventory deletion callback");
    return { file, call, callback, text: callback.getText(file) };
  });
}

/** Exact named top-level declarations share the callback guards' existing AST
 * normalizer; source import/type relocation never changes executable bodies.
 * @param {string} text @param {string} name */
function inventoryNamedDeclaration(text, name) {
  const file = ts.createSourceFile("inventory-creation.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const matches = file.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations
    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name));
  const declaration = matches[0];
  if (matches.length !== 1 || declaration === undefined) throw new Error("Changed native Inventory Item creation callback behavior");
  return { file, declaration, text: "const " + declaration.getText(file) };
}

/** Authenticate the existing Item root's sole child-options seam, both native
 * ordinal helpers, unchanged Level child and retained Item/Level callbacks.
 * The location Query bridge is checked exactly before restoring its native
 * remoteQuery preamble; the native difference/error tail remains unchanged.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeItem @param {string} item
 * @param {string} nativeLevels @param {string} levels
 * @param {string} nativeLevel @param {string} level
 * @param {string} nativeLocations @param {string} locations */
export function verifyInventoryItemCreateCallbacks(nativeWorkflow, workflow, nativeItem, item, nativeLevels, levels, nativeLevel, level, nativeLocations, locations) {
  const failure = "Changed native Inventory Item creation callback behavior";
  /** @param {string} text */
  const shape = text => testPortProgram("const callback = " + text);
  /** @param {string} source @param {string} target @param {string} name */
  const sameVariable = (source, target, name) => {
    if (testPortProgram(inventoryNamedDeclaration(source, name).text) !== testPortProgram(inventoryNamedDeclaration(target, name).text)) throw new Error(failure);
  };
  for (const name of ["buildLocationLevelMapAndItemData", "buildInventoryLevelsInput", "createInventoryItemsWorkflowId"]) sameVariable(nativeWorkflow, workflow, name);
  const original = inventoryDeletionCallbacks(nativeWorkflow, "createInventoryItemsWorkflow", "createWorkflow", [1])[0];
  const promoted = inventoryDeletionCallbacks(workflow, "createInventoryItemsWorkflow", "createWorkflow", [1])[0];
  if (original === undefined || promoted === undefined || !ts.isBlock(promoted.callback.body) || promoted.call.arguments[0]?.getText(promoted.file) !== "createInventoryItemsWorkflowId") throw new Error(failure);
  const seam = promoted.callback.body.statements[3];
  const expected = "createInventoryLevelsWorkflow.runAsStep({ input: inventoryLevelsInput.input })";
  if (seam === undefined || testPortProgram(seam.getText(promoted.file)) !== testPortProgram(expected)) throw new Error(failure);
  const restored = promoted.text.replace(seam.getText(promoted.file), "createInventoryLevelsWorkflow.runAsStep(inventoryLevelsInput)");
  if (shape(original.text) !== shape(restored)) throw new Error(failure);
  /** @type {readonly (readonly [string, string, string, string, readonly number[]])[]} */
  const unchanged = [
    [nativeItem, item, "createInventoryItemsStep", "createStep", [1, 2]],
    [nativeLevels, levels, "createInventoryLevelsWorkflow", "createWorkflow", [1]],
    [nativeLevel, level, "createInventoryLevelsStep", "createStep", [1, 2]],
  ];
  for (const [source, target, name, factory, indexes] of unchanged) {
    const sourceCallbacks = inventoryDeletionCallbacks(source, name, factory, indexes);
    const targetCallbacks = inventoryDeletionCallbacks(target, name, factory, indexes);
    for (const [index, callback] of sourceCallbacks.entries()) if (shape(callback.text) !== shape(targetCallbacks[index]?.text ?? "")) throw new Error(failure);
    sameVariable(source, target, name + "Id");
    const selected = targetCallbacks[0], options = selected?.call.arguments[0];
    if (selected === undefined || options === undefined || testPortProgram("const options = " + options.getText(selected.file)) !== testPortProgram(factory === "createStep"
      ? `const options = { name: ${name}Id, compensation: "transactionCovered" }` : `const options = ${name}Id`)) throw new Error(failure);
  }
  const nativeValidation = inventoryDeletionCallbacks(nativeLocations, "validateInventoryLocationsStep", "createStep", [1])[0];
  const validation = inventoryDeletionCallbacks(locations, "validateInventoryLocationsStep", "createStep", [1])[0];
  if (nativeValidation === undefined || validation === undefined || !ts.isBlock(nativeValidation.callback.body) || !ts.isBlock(validation.callback.body)) throw new Error(failure);
  const nativeStatements = nativeValidation.callback.body.statements, statements = validation.callback.body.statements;
  const query = statements[0], result = statements[1], completeness = statements[2], nativeQuery = nativeStatements[0], nativeResult = nativeStatements[1];
  if (query === undefined || result === undefined || completeness === undefined || nativeQuery === undefined || nativeResult === undefined) throw new Error(failure);
  const querySeam = `const query = container.resolve<WorkflowGraphResource>("query")`;
  const resultSeam = `const { data: stockLocations, metadata } = await query.graph({ entity: "stock_location", filters: { id: data.map((d) => d.location_id) }, fields: ["id"], pagination: { take: query.maxPageSize } })`;
  const completenessSeam = `if (metadata.count !== stockLocations.length || metadata.skip !== 0) throw new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Inventory validation requires a complete bounded ID result" })`;
  if (testPortProgram(query.getText(validation.file)) !== testPortProgram(querySeam) || testPortProgram(result.getText(validation.file)) !== testPortProgram(resultSeam) ||
    testPortProgram(completeness.getText(validation.file)) !== testPortProgram(completenessSeam)) throw new Error(failure);
  const nativeRestored = validation.text.replace(completeness.getText(validation.file), "")
    .replace(result.getText(validation.file), nativeResult.getText(nativeValidation.file)).replace(query.getText(validation.file), nativeQuery.getText(nativeValidation.file));
  if (shape(nativeValidation.text) !== shape(nativeRestored)) throw new Error(failure);
  sameVariable(nativeLocations, locations, "validateInventoryLocationsStepId");
  if (validation.call.arguments[0]?.getText(validation.file) !== "validateInventoryLocationsStepId") throw new Error(failure);
}

/** Preserve the exact emitted native deletion guard and generic callbacks.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyInventoryLevelDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  /** @param {string} text @param {string} name @param {readonly number[]} indexes */
  const callbacks = (text, name, indexes) => inventoryDeletionCallbacks(text, name, "createStep", indexes)
    .map(callback => testPortProgram("const callback = " + callback.text));
  if (JSON.stringify(callbacks(nativeWorkflow, "validateInventoryLevelsDelete", [1])) !==
    JSON.stringify(callbacks(workflow, "validateInventoryLevelsDelete", [1])) ||
    JSON.stringify(callbacks(nativeStep, "deleteEntitiesStep", [1, 2])) !==
    JSON.stringify(callbacks(step, "deleteEntitiesStep", [1, 2])))
    throw new Error("Changed native Inventory Level deletion callback behavior");
}

/** Preserve the singular native Item root after authenticating its one authored
 * checked-projection seam; all native guard and lifecycle callbacks erase only types.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step
 * @param {string} nativeLink @param {string} link */
export function verifyInventoryItemDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, link) {
  const failure = "Changed native Inventory Item deletion callback behavior";
  /** @param {string} source @param {string} target @param {string} name @param {readonly number[]} indexes */
  const sameCallbacks = (source, target, name, indexes) => {
    const native = inventoryDeletionCallbacks(source, name, "createStep", indexes);
    const promoted = inventoryDeletionCallbacks(target, name, "createStep", indexes);
    if (native.some((callback, index) => testPortProgram("const callback = " + callback.text) !==
      testPortProgram("const callback = " + promoted[index]?.text))) throw new Error(failure);
  };
  sameCallbacks(nativeStep, step, "validateInventoryDeleteStep", [1]);
  sameCallbacks(nativeStep, step, "deleteInventoryItemStep", [1, 2]);
  sameCallbacks(nativeLink, link, "removeRemoteLinkStep", [1, 2]);
  const native = inventoryDeletionCallbacks(nativeWorkflow, "deleteInventoryItemWorkflow", "createWorkflow", [1])[0];
  const promoted = inventoryDeletionCallbacks(workflow, "deleteInventoryItemWorkflow", "createWorkflow", [1])[0];
  if (native === undefined || promoted === undefined || !ts.isBlock(promoted.callback.body)) throw new Error(failure);
  const statements = promoted.callback.body.statements, query = statements[0], seam = statements[1];
  const checkedProjection = `const inventoryItemsToDelete = transform(inventoryRows, (value) => Result.getOrThrow(decodeInventoryDeletionRows(value).pipe(
    Result.mapError(() => new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Inventory deletion requires checked reserved quantities" })),
  )).map(row => ({ ...row })))`;
  if (query === undefined || seam === undefined || testPortProgram(seam.getText(promoted.file)) !== testPortProgram(checkedProjection)) throw new Error(failure);
  const queryText = query.getText(promoted.file);
  if (queryText.split("inventoryRows").length !== 2) throw new Error(failure);
  const restoredComposer = promoted.text.replace(seam.getText(promoted.file), "")
    .replace(queryText, queryText.replace("inventoryRows", "inventoryItemsToDelete"));
  if (testPortProgram("const callback = " + native.text) !== testPortProgram("const callback = " + restoredComposer)) throw new Error(failure);
  // The older Product deletion consumer requires the existing eight-row native
  // projection. A four-raw-ID standalone boundary must not reduce that decoder.
  const decoderFile = ts.createSourceFile("item-deletion-projection.ts", workflow, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const decoders = decoderFile.statements.filter(ts.isVariableStatement).flatMap(statement =>
    statement.declarationList.declarations.filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "decodeInventoryDeletionRows"));
  const decoder = decoders[0];
  const expectedDecoder = `const decodeInventoryDeletionRows = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({
    id: Schema.String.check(Schema.isLengthBetween(1, 256)), reserved_quantity: Schema.Number.check(Schema.isFinite()),
  })).check(Schema.isMaxLength(8)), { onExcessProperty: "error" })`;
  if (decoders.length !== 1 || decoder === undefined || testPortProgram("const " + decoder.getText(decoderFile)) !== testPortProgram(expectedDecoder)) throw new Error(failure);
}

/** The native Level batch composer and both direct step callbacks erase only
 * types. Existing Level deletion provenance authenticates its nested child.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeCreate @param {string} create
 * @param {string} nativeUpdate @param {string} update */
export function verifyInventoryLevelBatchCallbacks(nativeWorkflow, workflow, nativeCreate, create, nativeUpdate, update) {
  const failure = "Changed native Inventory Level batch callback behavior";
  /** @type {readonly (readonly [string, string, string, string, readonly number[]])[]} */
  const selections = [
    [nativeWorkflow, workflow, "batchInventoryItemLevelsWorkflow", "createWorkflow", [1]],
    [nativeCreate, create, "createInventoryLevelsStep", "createStep", [1, 2]],
    [nativeUpdate, update, "updateInventoryLevelsStep", "createStep", [1, 2]],
  ];
  for (const [source, target, name, factory, indexes] of selections) {
    // The tuple list above is deliberately literal; no caller chooses callbacks.
    const original = inventoryDeletionCallbacks(source, name, factory, indexes);
    const promoted = inventoryDeletionCallbacks(target, name, factory, indexes);
    for (const [index, callback] of original.entries()) {
      const selected = promoted[index];
      if (selected === undefined || testPortProgram("const callback = " + callback.text) !== testPortProgram("const callback = " + selected.text)) throw new Error(failure);
    }
    if (factory === "createStep") {
      const selected = promoted[0], options = selected?.call.arguments[0];
      const id = name === "createInventoryLevelsStep" ? "createInventoryLevelsStepId" : "updateInventoryLevelsStepId";
      if (selected === undefined || options === undefined || testPortProgram("const options = " + options.getText(selected.file)) !==
        testPortProgram(`const options = { name: ${id}, compensation: "transactionCovered" }`)) throw new Error(failure);
    }
  }
  const constant = "batchInventoryItemLevelsWorkflowId";
  /** @param {string} text */
  const identity = text => {
    const file = ts.createSourceFile("level-batch-identity.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const matches = file.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations
      .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === constant));
    if (matches.length !== 1 || matches[0] === undefined) throw new Error(failure);
    return testPortProgram("const " + matches[0].getText(file));
  };
  if (identity(nativeWorkflow) !== identity(workflow)) throw new Error(failure);
}

/** @param {string} source @param {string} target @param {Set<string>} names @param {boolean} verifySeed */
function verifyInventoryTests(source, target, names, verifySeed) {
  /** @param {string} text @param {boolean} onlySelected */
  const tests = (text, onlySelected) => {
    const file = ts.createSourceFile("inventory.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    /** @type {Map<string, string>} */
    const bodies = new Map();
    /** @param {ts.Node} node */
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "it") {
        const name = node.arguments[0];
        if (name === undefined || !ts.isStringLiteral(name)) {
          if (onlySelected) throw new Error("Invalid Inventory test selection");
          return;
        }
        if (onlySelected && !names.has(name.text)) throw new Error("Invalid Inventory test selection");
        if (names.has(name.text)) {
          if (bodies.has(name.text)) throw new Error("Duplicate native Inventory selection");
          let seed = "";
          if (verifySeed) {
            const block = node.parent.parent;
            if (!ts.isBlock(block)) throw new Error("Missing native Inventory seed block");
            const seeds = block.statements.filter(statement => ts.isExpressionStatement(statement) &&
              ts.isCallExpression(statement.expression) && ts.isIdentifier(statement.expression.expression) &&
              statement.expression.expression.text === "beforeEach");
            if (seeds.length !== 1) throw new Error("Invalid native Inventory seed");
            seed = seeds[0].getText(file) + ";\n";
          }
          bodies.set(name.text, JSON.stringify(testPortProgram(seed + node.getText(file) + ";")));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return bodies;
  };
  const original = tests(source, false), selected = tests(target, true);
  if (original.size !== names.size || selected.size !== names.size || [...names].some(name => selected.get(name) !== original.get(name)))
    throw new Error("Changed selected native Inventory test bodies");
}

/** Preserve the admitted Pricing bodies and their complete native seed.
 * @param {string} source @param {string} target */
export function verifyPricingCreateTests(source, target) {
  const names = new Set(["should create a priceSet successfully", "should create a price set with prices",
    "should take the later price when passing two prices with equivalent rules"]);
  /** @param {string} text */
  const selection = text => {
    const file = ts.createSourceFile("pricing.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    /** @type {Map<string, string>} */
    const bodies = new Map();
    let count = 0;
    /** @type {string | undefined} */
    let seed;
    /** @param {ts.Node} node */
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "it") {
        count++;
        const name = node.arguments[0];
        if (name !== undefined && ts.isStringLiteral(name) && names.has(name.text)) {
          if (bodies.has(name.text)) throw new Error("Duplicate native Pricing selection");
          bodies.set(name.text, JSON.stringify(testPortProgram(node.getText(file) + ";")));
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text === "seedPriceSetData") {
        if (seed !== undefined || node.body === undefined) throw new Error("Invalid native Pricing seed");
        seed = JSON.stringify(testPortProgram("async function seedPriceSetData(service) " + node.body.getText(file)));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return { bodies, count, seed };
  };
  const original = selection(source), selected = selection(target);
  if (original.count !== 28 || selected.count !== 3 || original.seed === undefined || selected.seed !== original.seed ||
    [...names].some(name => !original.bodies.has(name) || selected.bodies.get(name) !== original.bodies.get(name)))
    throw new Error("Changed selected native Pricing test bodies or seed");
}

/** Pricing retains its Product and Shipping creation/lifecycle profiles. The
 * named preference profile shares native creation with Store lookup/upsert and
 * physical deletion. Native preference updates retain a separate selector,
 * sparse preimage and inverse-upsert view. Preference deletion separately admits
 * native soft deletion and its event-free restore. Shipping updates keep their four native methods and full
 * mutation/causal receipt inputs.
 * @param {string} source @param {string} target @param {string} repositorySource */
export function verifyPricingWorkflowSelection(source, target, repositorySource) {
  const contract = ts.createSourceFile("native.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declaration = contract.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === "IPricingModuleService");
  if (declaration === undefined || !ts.isInterfaceDeclaration(declaration)) throw new Error("Missing native Pricing interface");
  const methods = new Set(declaration.members.filter(ts.isMethodSignature).map(member => member.name.getText(contract)));
  if (["createPriceSets", "createPriceLists", "createPricePreferences", "listPricePreferences", "updatePricePreferences", "upsertPricePreferences", "deletePricePreferences", "softDeletePricePreferences", "restorePricePreferences", "deletePriceSets",
    "updatePriceSets", "listPrices", "listPriceRules", "createPriceRules"]
    .some(method => !methods.has(method))) throw new Error("Missing native Pricing admitted methods");
  const adapter = ts.createSourceFile("adapter.ts", target, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @type {ts.CallExpression[]} */
  const selections = [];
  /** @type {ts.VariableDeclaration[]} */
  const admissions = [];
  /** @type {ts.VariableDeclaration[]} */
  const lifecycles = [];
  /** @type {ts.VariableDeclaration[]} */
  const preferences = [];
  /** @type {ts.VariableDeclaration[]} */
  const preferenceUpdates = [];
  /** @type {ts.VariableDeclaration[]} */
  const preferenceDeletions = [];
  /** @type {ts.VariableDeclaration[]} */
  const preferenceContracts = [];
  /** @type {ts.VariableDeclaration[]} */
  const preferencePolicies = [];
  /** @type {ts.VariableDeclaration[]} */
  const shippings = [];
  /** @type {ts.VariableDeclaration[]} */
  const shippingUpdates = [];
  /** @type {ts.VariableDeclaration[]} */
  const admitted = [];
  /** @type {ts.VariableDeclaration[]} */
  const graphs = [];
  /** @type {ts.CallExpression[]} */
  const modules = [];
  /** @type {ts.CallExpression[]} */
  const repositories = [];
  /** @type {ts.ParameterDeclaration[]} */
  const parameters = [];
  /** @type {ts.CallExpression[]} */
  const shippingCaptures = [];
  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineWorkflowModule") selections.push(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineCommerceModule") modules.push(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "preparePricingRepository") repositories.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "mutable") admissions.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "lifecycle") lifecycles.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "preferences") preferences.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "preferenceUpdates") preferenceUpdates.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "preferenceDeletions") preferenceDeletions.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "preferenceContracts") preferenceContracts.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "preferencePolicy") preferencePolicies.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "shipping") shippings.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "shippingUpdates") shippingUpdates.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "admitted") admitted.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "graph") graphs.push(node);
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === "admission") parameters.push(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "shippingLifecycleServices"
      && node.expression.name.text === "set") shippingCaptures.push(node);
    ts.forEachChild(node, visit);
  };
  visit(adapter);
  const input = selections[0]?.arguments[0];
  // A later spread, getter or computed key can replace an earlier literal.
  // This maintained registration must remain an unambiguous data literal.
  if (input === undefined || !ts.isObjectLiteralExpression(input) || input.properties.some(property =>
    (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) ||
    !ts.isIdentifier(property.name) || (ts.isShorthandPropertyAssignment(property) && property.name.text === "methods")))
    throw new Error("Ambiguous native Pricing workflow selection");
  const selected = input !== undefined && ts.isObjectLiteralExpression(input)
    ? input.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(adapter) === "methods") : [];
  const initializer = selected[0]?.initializer;
  const expectedMethods = `const methods = {
    ...(shippingUpdates ? { updatePriceSets: updateShippingPriceSets, listPrices: listShippingPrices,
      listPriceRules: listShippingPriceRules, createPriceRules: createShippingPriceRules } : {}),
    ...(preferences && !preferenceUpdates && !preferenceDeletions ? { createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences } : {}),
    ...(preferenceUpdates ? { listPricePreferences: listUpdatePricePreferences, updatePricePreferences, upsertPricePreferences: upsertUpdatePricePreferences } : {}),
    ...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences } : {}),
    ...(!preferences && !shippingUpdates ? { createPriceSets, ...(!shipping ? { createPriceLists, createPricePreferences } : {}),
      ...(mutable ? { upsertPriceSets, updatePriceSets, listPriceSets } : {}),
      ...(lifecycle || shipping ? { softDeletePriceSets } : {}), ...(shipping ? { restorePriceSets, deletePriceSets } : {}) } : {})
  };`;
  const exactMethods = initializer !== undefined && ts.isObjectLiteralExpression(initializer)
    && nativeWorkflowProgram('const methods = ' + initializer.getText(adapter), "Invalid Pricing selection") ===
      nativeWorkflowProgram(expectedMethods, "Invalid Pricing selection");
  const policies = input.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(adapter) === "logical");
  const policy = policies[0]?.initializer;
  const policyProperties = policy !== undefined && ts.isObjectLiteralExpression(policy) ? [...policy.properties] : [];
  const policySpread = policyProperties[0];
  const commands = policyProperties[1];
  const graph = graphs[0]?.initializer;
  const moduleInput = modules[0]?.arguments[0];
  const profiles = moduleInput !== undefined && ts.isObjectLiteralExpression(moduleInput)
    ? moduleInput.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(adapter) === "profile") : [];
  const profile = profiles[0]?.initializer;
  const profileNames = profile !== undefined && ts.isObjectLiteralExpression(profile)
    ? profile.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(adapter) === "name") : [];
  const services = moduleInput !== undefined && ts.isObjectLiteralExpression(moduleInput)
    ? moduleInput.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(adapter) === "service") : [];
  const service = services[0]?.initializer;
  const expectedService = `const service = ({ binding, dependencies, context }) => {
    const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
    const native = new PricingModuleService(container, { scope: "internal" });
    return { service: {
      createPriceSets: preferences ? binding.refuse : native.createPriceSets.bind(native),
      createPriceLists: preferences || shipping ? binding.refuse : native.createPriceLists.bind(native),
      createPricePreferences: shipping || preferenceUpdates || preferenceDeletions ? binding.refuse : native.createPricePreferences.bind(native),
      listPriceSets: preferences ? binding.refuse : native.listPriceSets.bind(native),
      retrievePriceSet: preferences ? binding.refuse : native.retrievePriceSet.bind(native),
      listAndCountPriceSets: preferences ? binding.refuse : native.listAndCountPriceSets.bind(native),
      calculatePrices: preferences || shipping ? binding.refuse : native.calculatePrices.bind(native),
      upsertPriceSets: mutable ? native.upsertPriceSets.bind(native) : binding.refuse,
      updatePriceSets: mutable || shippingUpdates ? native.updatePriceSets.bind(native) : binding.refuse,
      listPrices: shippingUpdates ? native.listPrices.bind(native) : binding.refuse,
      listPriceRules: shippingUpdates ? native.listPriceRules.bind(native) : binding.refuse,
      createPriceRules: shippingUpdates ? native.createPriceRules.bind(native) : binding.refuse,
      softDeletePriceSets: lifecycle || shipping ? native.softDeletePriceSets.bind(native) : binding.refuse,
      restorePriceSets: shipping ? native.restorePriceSets.bind(native) : binding.refuse,
      deletePriceSets: shipping ? native.deletePriceSets.bind(native) : binding.refuse,
      listPricePreferences: preferences && !preferenceDeletions ? native.listPricePreferences.bind(native) : binding.refuse,
      updatePricePreferences: preferenceUpdates ? native.updatePricePreferences.bind(native) : binding.refuse,
      upsertPricePreferences: preferences && !preferenceDeletions ? native.upsertPricePreferences.bind(native) : binding.refuse,
      deletePricePreferences: preferences && !preferenceUpdates && !preferenceDeletions ? native.deletePricePreferences.bind(native) : binding.refuse,
      softDeletePricePreferences: preferenceDeletions ? native.softDeletePricePreferences.bind(native) : binding.refuse,
      restorePricePreferences: preferenceDeletions ? native.restorePricePreferences.bind(native) : binding.refuse
    }, context };
  };`;
  const shippingCapture = shippingCaptures[0]?.parent.parent;
  if (admissions.length !== 1 || admissions[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="variant-updates"||admission==="product-updates"' ||
    lifecycles.length !== 1 || lifecycles[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="product-updates"' ||
    preferenceUpdates.length !== 1 || preferenceUpdates[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="price-preference-updates"' ||
    preferenceDeletions.length !== 1 || preferenceDeletions[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="price-preference-deletions"' ||
    preferences.length !== 1 || preferences[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="price-preferences"||preferenceUpdates||preferenceDeletions' ||
    preferenceContracts.length !== 1 || preferenceContracts[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'yield*compilePricePreferenceContracts(metadata.frame)' ||
    preferencePolicies.length !== 1 || preferencePolicies[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'pricingPreferencePolicy(preferenceContracts)' ||
    shippings.length !== 1 || shippings[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="shipping-options"||shippingUpdates' ||
    shippingUpdates.length !== 1 || shippingUpdates[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="shipping-option-updates"' ||
    shippingCaptures.length !== 1 || shippingCapture === undefined || !ts.isIfStatement(shippingCapture) ||
    nativeWorkflowProgram(shippingCapture.getText(adapter), "Invalid Pricing selection") !== nativeWorkflowProgram(
      'if (shipping && !shippingUpdates) shippingLifecycleServices.set(workflow, { routing: nativePricingRouting, softDelete: softDeletePriceSets, restore: restorePriceSets });', "Invalid Pricing selection") ||
    parameters.length !== 1 || parameters[0]?.initializer?.getText(adapter) !== '"create"' ||
    parameters[0]?.type?.getText(adapter).replace(/\s/g, "") !== '"create"|"variant-updates"|"product-updates"|"price-preferences"|"price-preference-updates"|"price-preference-deletions"|"shipping-options"|"shipping-option-updates"' ||
    selections.length !== 1 || selected.length !== 1 || !exactMethods ||
    modules.length !== 1 || repositories.length !== 1 || repositories[0]?.arguments.map(argument => argument.getText(adapter).replace(/\s/g, "")).join(",") !== 'metadata.frame,mutable,lifecycle,preferences,shipping,shippingUpdates,preferenceDeletions?"deletions":preferenceUpdates?"updates":"store"' ||
    services.length !== 1 || service === undefined || nativeWorkflowProgram('const service = ' + service.getText(adapter), "Invalid Pricing selection") !== nativeWorkflowProgram(expectedService, "Invalid Pricing selection") ||
    moduleInput === undefined || !ts.isObjectLiteralExpression(moduleInput) || moduleInput.properties.some(property => !ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) ||
    profiles.length !== 1 || profile === undefined || !ts.isObjectLiteralExpression(profile) ||
    profile.properties.some(property => (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) || !ts.isIdentifier(property.name)) ||
    profileNames.length !== 1 || profileNames[0]?.initializer.getText(adapter).replace(/\s/g, "") !==
      'shippingUpdates?"pricing-shipping-option-updates":shipping?"pricing-shipping-options":preferenceDeletions?"pricing-price-preference-deletions":preferenceUpdates?"pricing-price-preference-updates":preferences?"pricing-price-preferences":lifecycle?"pricing-product-updates":mutable?"pricing-variant-updates":"pricing-base-prices"' ||
    admitted.length !== 1 || admitted[0]?.initializer?.getText(adapter).replace(/\s/g, "") !==
      'preferenceDeletions?[preferenceSoftDelete,preferenceRestore]:preferenceUpdates?[preferenceUpdateList,preferenceUpdate,preferenceUpdateUpsert]:shippingUpdates?[shippingUpdate,shippingListPrices,shippingListRules,shippingCreateRules,list,count,retrieve]:shipping?[create,list,count,retrieve,softDeletePriceSetsCommand,restorePriceSetsCommand,deletePriceSetsCommand]:preferences?[createPreference,preferenceList,preferenceUpsert,preferenceDelete]:[create,createList,createPreference,list,count,retrieve,calculate,...(mutable?[upsert,update]:[]),...(lifecycle?[softDeletePriceSetsCommand]:[])]' ||
    graphs.length !== 1 || graph === undefined || !ts.isConditionalExpression(graph) ||
    graph.condition.getText(adapter) !== "preferences" || graph.whenTrue.getText(adapter).replace(/\s/g, "") !== '{aliases:[],reads:[]}' ||
    policies.length !== 1 || policyProperties.length !== 2 || policySpread === undefined || !ts.isSpreadAssignment(policySpread) ||
    policySpread.expression.getText(adapter).replace(/\s/g, "") !==
      '(shipping?pricingShippingOptionPolicy(preferencePolicy,shippingOutput,shippingUpdates?shippingMutation:undefined,shippingUpdates?prepared:undefined):preferences?preferencePolicy:lifecycle?pricingLogicalProductUpdateEventPolicy(preferencePolicy):mutable?pricingLogicalMutationEventPolicy(preferencePolicy):pricingLogicalCreateEventPolicy(preferencePolicy))' ||
    commands === undefined || !ts.isPropertyAssignment(commands) || commands.name.getText(adapter) !== "commands" || commands.initializer.getText(adapter) !== "admitted")
    throw new Error("Unadmitted native Pricing workflow selection");

  // Keep the existing Product preference lookup grammar unchanged. The named
  // preference repository retains Store's four-pair lookup decoder and explicit
  // profile selection; standalone creation does not widen either read grammar.
  const repository = ts.createSourceFile("repository.ts", repositorySource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @type {ts.VariableDeclaration[]} */
  const lookups = [];
  /** @param {ts.Node} node */
  const visitRepository = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "decodePreferenceFind") lookups.push(node);
    ts.forEachChild(node, visitRepository);
  };
  visitRepository(repository);
  const lookup = lookups[0]?.initializer;
  if (lookups.length !== 1 || lookup === undefined || testPortProgram("const lookup = " + lookup.getText(repository)) !==
    testPortProgram('const lookup = commerceDecoder(Schema.Struct({where:Schema.Struct({$or:Schema.Array(Schema.Struct({attribute:Schema.String,value:Schema.String})).check(Schema.isMaxLength(2))}),options:Schema.Unknown}),"unsupportedProfile")'))
    throw new Error("Changed existing Pricing preference lookup admission");
}

/** The admitted ShippingProfile subset preserves two complete native bodies;
 * the duplicate-message and deletion cases remain in the pinned source.
 * @param {string} source @param {string} target */
export function verifyShippingProfileCreateTests(source, target) {
  const names = ["should create a new shipping profile", "should create multiple new shipping profiles"];
  /** @param {string} text */
  const tests = text => {
    const file = ts.createSourceFile("shipping.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    /** @type {Map<string, string>} */
    const bodies = new Map();
    /** @param {ts.Node} node */
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "it") {
        const name = node.arguments[0];
        if (name === undefined || !ts.isStringLiteral(name) || bodies.has(name.text)) throw new Error("Invalid ShippingProfile test selection");
        bodies.set(name.text, JSON.stringify(testPortProgram(node.getText(file) + ";")));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return bodies;
  };
  const original = tests(source), selected = tests(target);
  if (original.size !== 5 || selected.size !== names.length || names.some(name => !original.has(name) || selected.get(name) !== original.get(name))) {
    throw new Error("Changed selected native ShippingProfile test bodies");
  }
}

/** A marker can follow only its already-evaluated local declaration.
 * @param {ts.ExpressionStatement} node @param {string} name */
function isUnusedResultMarker(node, name) {
  const parent = node.parent;
  if (!ts.isBlock(parent) && !ts.isSourceFile(parent)) return false;
  let index = parent.statements.indexOf(node) - 1;
  while (index >= 0) {
    const previous = parent.statements[index];
    if (ts.isExpressionStatement(previous) && ts.isVoidExpression(previous.expression)
      && ts.isIdentifier(previous.expression.expression)) { index--; continue; }
    if (!ts.isVariableStatement(previous)) return false;
    /** @param {ts.BindingName} binding @returns {boolean} */
    const binds = binding => ts.isIdentifier(binding) ? binding.text === name
      : binding.elements.some(element => ts.isBindingElement(element) && binds(element.name));
    return previous.declarationList.declarations.some(declaration => binds(declaration.name));
  }
  return false;
}

/** Compare executable test structure after type erasure. Import changes are
 * limited to explicit Vitest globals; the exact admitted suite timeout moves to config.
 * A void marker may retain an original intentionally unused local result.
 * @param {string} source
 * @param {{ currencyTimeout?: boolean, salesChannelTimeout?: boolean, currencyStaticImports?: boolean }} options
 */
export function testPortProgram(source, options = {}) {
  const input = ts.createSourceFile("test.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  for (const node of input.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "vitest") continue;
    const clause = node.importClause;
    if (clause?.isTypeOnly) continue;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)
      || clause.namedBindings.elements.some(binding => !binding.isTypeOnly && (binding.propertyName || !vitestBindings.has(binding.name.text)))) {
      throw new Error("Unadmitted Vitest test-port import");
    }
  }
  const result = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleDetection: ts.ModuleDetectionKind.Force,
    removeComments: true, newLine: ts.NewLineKind.LineFeed,
  } });
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error("Invalid test-port syntax");
  const file = ts.createSourceFile("test.js", result.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  /** @param {ts.Node} node @returns {unknown} */
  function shape(node) {
    if (ts.isParenthesizedExpression(node)) return shape(node.expression);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "vitest") {
      const clause = node.importClause;
      if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)
        || clause.namedBindings.elements.some(binding => binding.propertyName || !vitestBindings.has(binding.name.text))) {
        throw new Error("Unadmitted Vitest test-port import");
      }
      return undefined;
    }
    // Type-only modules can emit this marker when all imports were erased.
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause
      && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0) return undefined;
    if (ts.isExpressionStatement(node)) {
      const expression = node.expression;
      if (ts.isVoidExpression(expression) && ts.isIdentifier(expression.expression) && isUnusedResultMarker(node, expression.expression.text)) return undefined;
      if ((options.currencyTimeout || options.salesChannelTimeout) && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
        && ts.isIdentifier(expression.expression.expression) && expression.expression.expression.text === "jest"
        && expression.expression.name.text === "setTimeout" && expression.arguments.length === 1
        && ts.isNumericLiteral(expression.arguments[0])
        && ((options.currencyTimeout && expression.arguments[0].text === "100000")
          || (options.salesChannelTimeout && expression.arguments[0].text === "30000"))) return undefined;
    }
    /** @type {unknown[]} */
    const children = [];
    ts.forEachChild(node, child => { const value = shape(child); if (value !== undefined) children.push(value); });
    const literal = ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : undefined;
    const spelling = options.currencyStaticImports && ts.isStringLiteral(node) && ts.isImportDeclaration(node.parent) ? currencyImports.get(node.text) ?? literal : literal;
    return [node.kind, spelling,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : undefined,
      ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : undefined,
      ts.isTemplateLiteralToken(node) ? node.rawText : undefined,
      ts.isMetaProperty(node) ? node.keywordToken : undefined,
      ts.isImportAttributes(node) ? node.token : undefined, children];
  }
  return JSON.stringify(shape(file));
}

/** @param {string} source @param {string} target @param {{ currencyTimeout?: boolean, salesChannelTimeout?: boolean, currencyStaticImports?: boolean }} options */
export function verifyTestPort(source, target, options = {}) {
  if (testPortProgram(source, options) !== testPortProgram(target, options)) {
    throw new Error("Test port changed executable scenario, assertion, or runtime import");
  }
}

/** Authenticate the complete Store root and step after only the portable import,
 * response-wrapper and transaction-covered declaration seams. The existing Link
 * callbacks remain native, including grouped empty endpoints and their inverse.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step
 * @param {string} nativeLink @param {string} link */
export function verifyStoreDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, link) {
  const failure = "Changed native Store deletion callback behavior";
  const expectedWorkflow = nativeWorkflow
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('WorkflowData, createWorkflow } from "@medusajs/framework/workflows-sdk"', 'WorkflowData, createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/delete-stores"')
    .replace("return deletedStores", "return new WorkflowResponse(deletedStores)");
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  deleteStoresStepId,", '  { name: deleteStoresStepId, compensation: "transactionCovered" },');
  if (testPortProgram(expectedWorkflow) !== testPortProgram(workflow) ||
    testPortProgram(expectedStep) !== testPortProgram(step)) throw new Error(failure);
  const original = inventoryDeletionCallbacks(nativeLink, "removeRemoteLinkStep", "createStep", [1, 2]);
  const promoted = inventoryDeletionCallbacks(link, "removeRemoteLinkStep", "createStep", [1, 2]);
  for (const [index, callback] of original.entries()) {
    if (testPortProgram("const callback = " + callback.text) !==
      testPortProgram("const callback = " + promoted[index]?.text)) throw new Error(failure);
  }
  const selected = promoted[0], options = selected?.call.arguments[0];
  if (selected === undefined || options === undefined ||
    testPortProgram("const options = " + options.getText(selected.file)) !==
    testPortProgram('const options = { name: removeRemoteLinkStepId, compensation: "transactionCovered" }') ||
    testPortProgram(inventoryNamedDeclaration(nativeLink, "removeRemoteLinkStepId").text) !==
    testPortProgram(inventoryNamedDeclaration(link, "removeRemoteLinkStepId").text)) throw new Error(failure);
}

/** Complete emitted Store creation graph and both native step files. Only
 * portable/direct imports, erased annotations and covered metadata may differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStore @param {string} store
 * @param {string} nativePreferences @param {string} preferences */
export function verifyStoreCreateCallbacks(nativeWorkflow, workflow, nativeStore, store, nativePreferences, preferences) {
  const failure = "Changed native Store creation callback behavior";
  const expectedWorkflow = nativeWorkflow
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/create-stores"')
    .replace('from "../../pricing"', 'from "../../pricing/steps/update-price-preferences-as-array"');
  /** @param {string} text @param {string} id */
  const covered = (text, id) => text
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace(`  ${id},`, `  { name: ${id}, compensation: "transactionCovered" },`);
  if (testPortProgram(expectedWorkflow) !== testPortProgram(workflow) ||
    testPortProgram(covered(nativeStore, "createStoresStepId")) !== testPortProgram(store) ||
    testPortProgram(covered(nativePreferences, "updatePricePreferencesAsArrayStepId")) !== testPortProgram(preferences)) throw new Error(failure);
}

/** Type erasure cannot authenticate the selected native workflow contracts.
 * Preserve their complete source, allowing only the named type-only HTTP import
 * relocation and line-ending representation. No parallel handwritten DTOs.
 * @param {string} nativeStore @param {string} store
 * @param {string} nativePricing @param {string} pricing
 * @param {string} nativePayload @param {string} payload */
export function verifyStoreCreationTypes(nativeStore, store, nativePricing, pricing, nativePayload, payload) {
  /** @param {string} text */
  const normalize = text => text.replace(/\r\n/g, "\n");
  const expectedStore = nativeStore.replace('from "../../http"', 'from "../../http/store/admin/payloads"');
  const expectedPricing = normalize(nativePricing).replace("  is_tax_inclusive?: boolean\n}\n\nexport interface UpdatePricePreferencesWorkflowInput",
    "  is_tax_inclusive?: boolean | undefined\n}\n\nexport interface UpdatePricePreferencesWorkflowInput");
  if (normalize(expectedStore) !== normalize(store) || expectedPricing !== normalize(pricing) ||
    normalize(nativePayload) !== normalize(payload)) throw new Error("Changed native Store creation type contract");
}

/** Authenticate the complete emitted native Line Item root and step. Only the
 * direct/portable imports, WorkflowResponse wrapper and covered metadata differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyReservationLineItemDeletionCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow
    .replace('WorkflowData, createWorkflow } from "@medusajs/framework/workflows-sdk"', 'WorkflowData, WorkflowResponse, createWorkflow } from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/delete-reservations-by-line-items"')
    .replace("return deleteReservationsByLineItemsStep(input.ids)", "return new WorkflowResponse(deleteReservationsByLineItemsStep(input.ids))");
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace("  deleteReservationsByLineItemsStepId,", '  { name: deleteReservationsByLineItemsStepId, compensation: "transactionCovered" },');
  const program = (/** @type {string} */ source) => nativeWorkflowProgram(source, "Invalid native Reservation Line Item callback syntax");
  if (program(expectedWorkflow) !== program(workflow) || program(expectedStep) !== program(step))
    throw new Error("Changed native Reservation Line Item deletion callback behavior");
}

/** Complete emitted runtime shape: no unused-result or test-runner exceptions.
 * @param {string} source @param {string} syntaxFailure */
function nativeWorkflowProgram(source, syntaxFailure) {
  const emitted = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
    throw new Error(syntaxFailure);
  const file = ts.createSourceFile("workflow.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  /** @param {ts.Node} node @returns {unknown} */
  const shape = node => {
    /** @type {unknown[]} */
    const children = [];
    ts.forEachChild(node, child => { children.push(shape(child)); });
    return [node.kind, ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : undefined,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : undefined,
      ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : undefined,
      ts.isTemplateLiteralToken(node) ? node.rawText : undefined,
      ts.isMetaProperty(node) ? node.keywordToken : undefined,
      ts.isImportAttributes(node) ? node.token : undefined, children];
  };
  return JSON.stringify(shape(file));
}

/** Authenticate the complete native Store update root, selectors, projections,
 * retained callback, transform and conditional Pricing branch.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyStoreUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/update-stores"')
    .replace('from "../../pricing"', 'from "../../pricing/steps/update-price-preferences-as-array"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  updateStoresStepId,", '  { name: updateStoresStepId, compensation: "transactionCovered" },');
  const failure = "Invalid native Store update callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, failure) !== nativeWorkflowProgram(workflow, failure) ||
    nativeWorkflowProgram(expectedStep, failure) !== nativeWorkflowProgram(step, failure))
    throw new Error("Changed native Store update callback behavior");
}

/** Authenticate the entire native ShippingProfile update root, selector reads,
 * returned array and retained preimages without altering native metadata behavior.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyShippingProfileUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  updateShippingProfilesStepId,", '  { name: updateShippingProfilesStepId, compensation: "transactionCovered" },');
  const failure = "Invalid native ShippingProfile update callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, failure) !== nativeWorkflowProgram(workflow, failure) ||
    nativeWorkflowProgram(expectedStep, failure) !== nativeWorkflowProgram(step, failure))
    throw new Error("Changed native ShippingProfile update callback behavior");
}


/** Authenticate the complete singular native ShippingProfile root, its pure
 * Product-Link guard, retained profile inverse and real common Link callbacks.
 * Only portable/direct imports, covered metadata and the void response differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step
 * @param {string} nativeLink @param {string} link */
export function verifyShippingProfileDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, link) {
  const failure = "Invalid native ShippingProfile deletion callback syntax";
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('  WorkflowData,\n', '  WorkflowData,\n  WorkflowResponse,\n')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "../steps"', 'from "../steps/delete-shipping-profile"')
    .replace('import { removeRemoteLinkStep, useQueryGraphStep } from "../../common"',
      'import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"\nimport { useQueryGraphStep } from "../../common/steps/use-query-graph"')
    .replace('    })\n  }\n)', '    })\n    return new WorkflowResponse(void 0)\n  }\n)');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('  deleteShippingProfilesStepId,', '  { name: deleteShippingProfilesStepId, compensation: "transactionCovered" },');
  const expectedLink = nativeLink.replace('  removeRemoteLinkStepId,', '  { name: removeRemoteLinkStepId, compensation: "transactionCovered" },');
  if (nativeWorkflowProgram(expectedWorkflow, failure) !== nativeWorkflowProgram(workflow, failure) ||
    nativeWorkflowProgram(expectedStep, failure) !== nativeWorkflowProgram(step, failure) ||
    nativeWorkflowProgram(expectedLink, failure) !== nativeWorkflowProgram(link, failure))
    throw new Error("Changed native ShippingProfile deletion callback behavior");
  // Query's private partial-record callback annotation is erased. Keep the
  // original public exported input types intact rather than widening their ABI.
  /** @param {string} source @param {string} name */
  const declaredType = (source, name) => {
    const parsed = ts.createSourceFile("shipping-profile.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = parsed.statements.filter(node => ts.isTypeAliasDeclaration(node) && node.name.text === name);
    if (declarations.length !== 1 || declarations[0] === undefined) throw new Error("Changed native ShippingProfile deletion public input type");
    return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, declarations[0], parsed);
  };
  for (const name of ["ValidateStepShippingProfileDeleteInput", "DeleteShippingProfilesWorkflowInput"])
    if (declaredType(nativeWorkflow, name) !== declaredType(workflow, name)) throw new Error("Changed native ShippingProfile deletion public input type");
  if (declaredType(nativeStep, "DeleteShippingProfilesStepInput") !== declaredType(step, "DeleteShippingProfilesStepInput"))
    throw new Error("Changed native ShippingProfile deletion public input type");
}

/** The complete native Type creation root and retained physical inverse. Only
 * direct portable imports and covered compensation metadata may differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyShippingOptionTypeCreateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/core-flows/events"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../../common"', 'from "../../common/steps/emit-event"')
    .replace('from "../steps"', 'from "../steps/create-shipping-option-types"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  createShippingOptionTypesStepId,", '  { name: createShippingOptionTypesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ShippingOptionType creation callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ShippingOptionType creation callback behavior");
  /** Retain original public type aliases despite their erased runtime status.
   * @param {string} source @param {string} name */
  const inputType = (source, name) => {
    const file = ts.createSourceFile("shipping-option-type.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = file.statements.filter(node => ts.isTypeAliasDeclaration(node) && node.name.text === name);
    const declaration = declarations[0];
    if (declarations.length !== 1 || declaration === undefined)
      throw new Error("Changed native ShippingOptionType creation public input type");
    return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, declaration, file);
  };
  if (inputType(nativeWorkflow, "CreateShippingOptionTypesWorkflowInput") !== inputType(workflow, "CreateShippingOptionTypesWorkflowInput")
    || inputType(nativeStep, "CreateShippingOptionTypesStepInput") !== inputType(step, "CreateShippingOptionTypesStepInput"))
    throw new Error("Changed native ShippingOptionType creation public input type");
}

/** Authenticate the generic native creation-result initializer. SQL-specific
 * descriptor types may be erased; the full function body must remain native.
 * @param {string} nativeRepository @param {string} relationOwner */
export function verifyNativeToManyInitialization(nativeRepository, relationOwner) {
  /** @param {string} source */
  const select = source => {
    const file = ts.createSourceFile("relations.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "fillEmptyToManyRelations");
    const declaration = declarations[0];
    if (declarations.length !== 1 || declaration === undefined || !ts.isFunctionDeclaration(declaration) || declaration.body === undefined)
      throw new Error("Changed native zero-to-many initialization extraction");
    return declaration.getText(file).replace(/^export\s+/, "");
  };
  const syntaxFailure = "Invalid native zero-to-many initialization syntax";
  if (nativeWorkflowProgram(select(nativeRepository), syntaxFailure) !== nativeWorkflowProgram(select(relationOwner), syntaxFailure))
    throw new Error("Changed native zero-to-many initialization extraction");
}

/** Select a complete native function, refusing ambiguous extraction anchors.
 * @param {string} source @param {string} name @param {string} failure */
function nativeHelperDeclaration(source, name, failure) {
  const file = ts.createSourceFile("native-helper.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declarations = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const declaration = declarations[0];
  if (declarations.length !== 1 || declaration === undefined || !ts.isFunctionDeclaration(declaration) || declaration.body === undefined)
    throw new Error(failure);
  return declaration.getText(file).replace(/^export\s+/, "");
}

/** The whole SQL-free scalar helper is native; only its export is added.
 * Comparing the complete target also refuses extra runtime imports or effects.
 * @param {string} nativeRepository @param {string} filterOwner */
export function verifyNativeFilterValue(nativeRepository, filterOwner) {
  const failure = "Changed native scalar filter-value extraction";
  const expected = "export " + nativeHelperDeclaration(nativeRepository, "coerceFilterValue", failure);
  if (nativeWorkflowProgram(expected, failure) !== nativeWorkflowProgram(filterOwner, failure)) throw new Error(failure);
}

/** Authenticate the complete nullable to-one initializer after descriptor type
 * erasure. Other relation helpers retain their separate source proofs.
 * @param {string} nativeRepository @param {string} relationOwner */
export function verifyNativeNullToOneInitialization(nativeRepository, relationOwner) {
  const failure = "Changed native nullable to-one initialization extraction";
  const native = nativeHelperDeclaration(nativeRepository, "fillNullToOneRelations", failure);
  const portable = nativeHelperDeclaration(relationOwner, "fillNullToOneRelations", failure);
  if (nativeWorkflowProgram(native, failure) !== nativeWorkflowProgram(portable, failure)) throw new Error(failure);
}

/** Native singleton/multiple-alias rules, including duplicate failure order.
 * mergeFieldAlias moves out of its class without changing its body. The exact
 * parseAlias array block takes its already-resolved parent entity as an argument;
 * its checked metadata lookup is the only removed native statement. The entire
 * extracted module must match, including the direct isString import relocation.
 * @param {string} nativeJoiner @param {string} aliasOwner */
export function verifyNativeJoinerFieldAlias(nativeJoiner, aliasOwner) {
  const failure = "Changed native Joiner field-alias extraction";
  const file = ts.createSourceFile("remote-joiner.ts", nativeJoiner, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const classes = file.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "RemoteJoiner");
  const owner = classes[0];
  if (classes.length !== 1 || owner === undefined || !ts.isClassDeclaration(owner)) throw new Error(failure);
  /** @param {string} name */
  const method = name => {
    const declarations = owner.members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
    const declaration = declarations[0];
    if (declarations.length !== 1 || declaration === undefined || !ts.isMethodDeclaration(declaration) || declaration.body === undefined)
      throw new Error(failure);
    return declaration;
  };
  const merge = method("mergeFieldAlias");
  const parse = method("parseAlias");
  if (merge.body === undefined || parse.body === undefined) throw new Error(failure);
  const selections = parse.body.statements.filter(statement => ts.isIfStatement(statement)
    && nativeWorkflowProgram(statement.expression.getText(file), failure) === nativeWorkflowProgram("Array.isArray(alias)", failure));
  const selection = selections[0];
  if (selections.length !== 1 || selection === undefined || !ts.isIfStatement(selection)
    || selection.elseStatement !== undefined || !ts.isBlock(selection.thenStatement)) throw new Error(failure);
  const entityLookup = selection.thenStatement.statements[0];
  if (entityLookup === undefined || nativeWorkflowProgram(entityLookup.getText(file), failure) !== nativeWorkflowProgram(
    'const currentPathEntity = parsedExpands.get([BASE_PATH, ...currentPath].join("."))?.entity', failure)) throw new Error(failure);
  const nativeSelection = `if (${selection.expression.getText(file)}) {\n${selection.thenStatement.statements.slice(1).map(statement => statement.getText(file)).join("\n")}\n}`;
  const expected = 'import { isString } from "@medusajs/utils/common/is-string"\n'
    + `export function mergeFieldAlias(${merge.parameters.map(parameter => parameter.getText(file)).join(", ")}) ${merge.body.getText(file)}\n`
    + `export function selectFieldAlias(value, currentPathEntity, currentPath) { let alias = value; ${nativeSelection}\nreturn alias; }`;
  if (nativeWorkflowProgram(expected, failure) !== nativeWorkflowProgram(aliasOwner, failure)) throw new Error(failure);
}

/** Preserve the complete native Type update root and its projected upsert
 * inverse. Only portable imports and covered step metadata may differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyShippingOptionTypeUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/core-flows/events"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/update-shipping-option-types"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  updateShippingOptionTypesStepId,", '  { name: updateShippingOptionTypesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ShippingOptionType update callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ShippingOptionType update callback behavior");
  /** @param {string} source @param {string} name */
  const declaredType = (source, name) => {
    const parsed = ts.createSourceFile("shipping-option-type.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = parsed.statements.filter(node => ts.isTypeAliasDeclaration(node) && node.name.text === name);
    if (declarations.length !== 1 || declarations[0] === undefined)
      throw new Error("Changed native ShippingOptionType update public input type");
    return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, declarations[0], parsed);
  };
  if (declaredType(nativeWorkflow, "UpdateShippingOptionTypesWorkflowInput") !== declaredType(workflow, "UpdateShippingOptionTypesWorkflowInput")
    || declaredType(nativeStep, "UpdateShippingOptionTypesStepInput") !== declaredType(step, "UpdateShippingOptionTypesStepInput"))
    throw new Error("Changed native ShippingOptionType update public input type");
}

/** Preserve the complete native Type deletion graph, Option guard, hook,
 * parallel Link/event siblings, void result and raw-ID restoration callback.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyShippingOptionTypeDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('import {\n  MedusaError,\n  Modules,\n  ShippingOptionTypeWorkflowEvents,\n} from "@medusajs/framework/utils"',
      'import { MedusaError } from "@medusajs/utils/common/errors"\nimport { Modules } from "@medusajs/utils/modules-sdk/definition"\nimport { ShippingOptionTypeWorkflowEvents } from "@medusajs/utils/core-flows/events"')
    .replaceAll('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/delete-shipping-option-types"')
    .replace('from "../../common"', 'from "../../common/steps/use-query-graph"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  deleteShippingOptionTypesStepId,", '  { name: deleteShippingOptionTypesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ShippingOptionType deletion callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ShippingOptionType deletion callback behavior");
  /** @param {string} source @param {string} name */
  const declaredType = (source, name) => {
    const parsed = ts.createSourceFile("shipping-option-type.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const declarations = parsed.statements.filter(node => ts.isTypeAliasDeclaration(node) && node.name.text === name);
    if (declarations.length !== 1 || declarations[0] === undefined)
      throw new Error("Changed native ShippingOptionType deletion public input type");
    return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, declarations[0], parsed);
  };
  if (declaredType(nativeWorkflow, "DeleteShippingOptionTypesWorkflowInput") !== declaredType(workflow, "DeleteShippingOptionTypesWorkflowInput")
    || declaredType(nativeStep, "DeleteShippingOptionTypesStepInput") !== declaredType(step, "DeleteShippingOptionTypesStepInput"))
    throw new Error("Changed native ShippingOptionType deletion public input type");
}

/** Preserve native creation, original type seam, full nested result and physical
 * inverse. Only direct imports and covered step metadata may differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step
 * @param {string} nativeTypes @param {string} types */
export function verifyServiceZoneCreateCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeTypes, types) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('import type {\n  FulfillmentWorkflow,\n  ServiceZoneDTO,\n} from "@medusajs/framework/types"',
      'import type * as FulfillmentWorkflow from "@medusajs/types/workflow/fulfillment/service-zones"\nimport type { ServiceZoneDTO } from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/create-service-zones"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  createServiceZonesStepId,", '  { name: createServiceZonesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ServiceZone creation callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ServiceZone creation callback behavior");
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("service-zone.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  if (typedProgram(expectedWorkflow) !== typedProgram(workflow) || typedProgram(expectedStep) !== typedProgram(step)
    || nativeTypes.replaceAll("\r\n", "\n") !== types.replaceAll("\r\n", "\n"))
    throw new Error("Changed native ServiceZone creation public contract");
}

/** Preserve native cascade deletion and raw restore, original public input and
 * the existing portable void-result representation seam.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyServiceZoneDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('import { WorkflowData, createWorkflow } from "@medusajs/framework/workflows-sdk"',
      'import { WorkflowData, WorkflowResponse, createWorkflow } from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/delete-service-zones"')
    .replace("    deleteServiceZonesStep(input.ids)\n", "    deleteServiceZonesStep(input.ids)\n    return new WorkflowResponse(void 0)\n");
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  deleteServiceZonesStepId,", '  { name: deleteServiceZonesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ServiceZone deletion callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ServiceZone deletion callback behavior");
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("service-zone-delete.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  if (typedProgram(expectedWorkflow) !== typedProgram(workflow) || typedProgram(expectedStep) !== typedProgram(step))
    throw new Error("Changed native ServiceZone deletion public contract");
}

/** Preserve native Profile creation, full returned rows, exact retained IDs and
 * physical inverse. Existing step adaptation is fixed, not changed by this root.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step
 * @param {string} nativeTypes @param {string} types */
export function verifyShippingProfileCreateCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeTypes, types) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/create-shipping-profiles"');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  createShippingProfilesStepId,", '  { name: createShippingProfilesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ShippingProfile creation callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ShippingProfile creation callback behavior");
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("shipping-profile-create.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  if (typedProgram(expectedWorkflow) !== typedProgram(workflow) || typedProgram(expectedStep) !== typedProgram(step))
    throw new Error("Changed native ShippingProfile creation public contract");
  /** @param {string} source */
  const creationTypes = source => {
    const parsed = ts.createSourceFile("shipping-profile-create-types.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const names = ["CreateShippingProfile", "CreateShippingProfilesWorkflowInput", "CreateShippingProfilesWorkflowOutput"];
    return names.map(name => {
      const declarations = parsed.statements.filter(node => (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === name);
      if (declarations.length !== 1 || declarations[0] === undefined) throw new Error("Changed native ShippingProfile creation public contract");
      return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, declarations[0], parsed);
    }).join("\n");
  };
  if (creationTypes(nativeTypes) !== creationTypes(types)) throw new Error("Changed native ShippingProfile creation public contract");
}

/** Preserve native Location/Set creation, endpoint links and physical inverse.
 * The only runtime representation seam is the existing explicit void response;
 * imports, erased types and transaction-covered step metadata are fixed below.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeSetStep @param {string} setStep
 * @param {string} nativeAssociation @param {string} association
 * @param {string} nativeDefinition @param {string} definition
 * @param {string} nativeTypes @param {string} types */
export function verifyLocationFulfillmentSetCallbacks(nativeWorkflow, workflow, nativeSetStep, setStep, nativeAssociation, association, nativeDefinition, definition, nativeTypes, types) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/workflows/stock-locations/mutations"')
    .replace("  transform,", "  transform,\n  WorkflowResponse,")
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('from "../../fulfillment"', 'from "../../fulfillment/steps/create-fulfillment-set"')
    .replace("        fulfillment_set_ids: [data.fulfillmentSet[0].id],",
      "        // @ts-expect-error Native creation assumes a first Set; preserve its missing-first property-read failure.\n        fulfillment_set_ids: [data.fulfillmentSet[0].id],")
    .replace("      input: data,\n    })", "      input: data,\n    })\n    return new WorkflowResponse(void 0)");
  const expectedSetStep = nativeSetStep.replaceAll("\r\n", "\n")
    .replace("import {", "import type {")
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  createFulfillmentSetsId,", '  { name: createFulfillmentSetsId, compensation: "transactionCovered" },');
  const expectedAssociation = nativeAssociation.replaceAll("\r\n", "\n")
    .replace('import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"',
      'import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"\nimport { Modules } from "@medusajs/utils/modules-sdk/definition"\nimport type { Link } from "@medusajs/modules-sdk/link"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  associateFulfillmentSetsWithLocationStepId,", '  { name: associateFulfillmentSetsWithLocationStepId, compensation: "transactionCovered" },')
    .replaceAll("container.resolve(ContainerRegistrationKeys.LINK)", 'container.resolve<Pick<Link, "create" | "dismiss">>(ContainerRegistrationKeys.LINK)');
  const expectedDefinition = nativeDefinition.replaceAll("\r\n", "\n")
    .replace("import { ModuleJoinerConfig }", "import type { ModuleJoinerConfig }")
    .replace('import { LINKS, Modules } from "@medusajs/framework/utils"',
      'import { Modules } from "@medusajs/framework/utils/portable"\nimport { composeLinkName } from "@medusajs/utils/link/compose-link-name"')
    .replaceAll("LINKS.LocationFulfillmentSet", 'composeLinkName(Modules.STOCK_LOCATION, "stock_location_id", Modules.FULFILLMENT, "fulfillment_set_id")');
  const pairs = [[expectedWorkflow, workflow], [expectedSetStep, setStep],
    [expectedAssociation, association], [expectedDefinition, definition], [nativeTypes, types]];
  const syntaxFailure = "Invalid native LocationFulfillmentSet callback syntax";
  for (const [expected, target] of pairs) {
    if (expected === undefined || target === undefined ||
      nativeWorkflowProgram(expected, syntaxFailure) !== nativeWorkflowProgram(target, syntaxFailure))
      throw new Error("Changed native LocationFulfillmentSet callback behavior");
  }
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("location-fulfillment-set.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  for (const [expected, target] of pairs) {
    if (expected === undefined || target === undefined || typedProgram(expected) !== typedProgram(target))
      throw new Error("Changed native LocationFulfillmentSet public contract");
  }
  const firstResultComment = "// @ts-expect-error Native creation assumes a first Set; preserve its missing-first property-read failure.";
  const normalizedWorkflow = workflow.replaceAll("\r\n", "\n");
  if (normalizedWorkflow.split(firstResultComment).length !== 2 ||
    !normalizedWorkflow.includes(firstResultComment + "\n        fulfillment_set_ids: [data.fulfillmentSet[0].id],"))
    throw new Error("Changed native LocationFulfillmentSet first-result type seam");
}

/** Preserve all native batch branches, public DTOs, real projected preimages,
 * absence and physical recreation. The named composer result expresses actual
 * empty-branch absence without leaking SDK brands; exported native DTOs remain
 * exact. Other seams are imports/metadata only.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeCreate @param {string} create
 * @param {string} nativeUpdate @param {string} update
 * @param {string} nativeDelete @param {string} deleted */
export function verifyShippingOptionRuleBatchCallbacks(nativeWorkflow, workflow, nativeCreate, create, nativeUpdate, update, nativeDelete, deleted) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('import {\n  BatchWorkflowInput,\n  BatchWorkflowOutput,\n',
      'import type { BatchWorkflowInput, BatchWorkflowOutput } from "@medusajs/types"\nimport type {\n')
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace('): WorkflowResponse<BatchShippingOptionRulesOutput> => {',
      '): WorkflowResponse<BatchShippingOptionRulesComposerResult> => {')
    .replace('export const batchShippingOptionRulesWorkflowId =',
      'type BatchShippingOptionRulesComposerResult = {\n  created: BatchShippingOptionRulesOutput["created"]\n  updated: BatchShippingOptionRulesOutput["updated"] | undefined\n  deleted: BatchShippingOptionRulesOutput["deleted"] | undefined\n}\n\nexport const batchShippingOptionRulesWorkflowId =')
    .replace('import {\n  createShippingOptionRulesStep,\n  deleteShippingOptionRulesStep,\n} from "../steps"',
      'import { createShippingOptionRulesStep } from "../steps/create-shipping-option-rules"\nimport { deleteShippingOptionRulesStep } from "../steps/delete-shipping-option-rules"');
  /** @param {string} source @param {"create"|"update"|"delete"} kind */
  const expectedStep = (source, kind) => {
    let expected = source.replaceAll("\r\n", "\n")
      .replace('import {', 'import type {')
      .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"')
      .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
      .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
      .replace(`  ${kind}ShippingOptionRulesStepId,`, `  { name: ${kind}ShippingOptionRulesStepId, compensation: "transactionCovered" },`);
    if (kind === "delete") expected = expected.replace("  RuleOperatorType,\n", "")
      .replace('from "@medusajs/types/fulfillment/index"',
        'from "@medusajs/types/fulfillment/index"\nimport type { RuleOperatorType } from "@medusajs/types/common/rule"');
    return expected;
  };
  const pairs = [[expectedWorkflow, workflow], [expectedStep(nativeCreate, "create"), create],
    [expectedStep(nativeUpdate, "update"), update], [expectedStep(nativeDelete, "delete"), deleted]];
  const syntaxFailure = "Invalid native ShippingOptionRule batch callback syntax";
  for (const [expected, target] of pairs) {
    if (expected === undefined || target === undefined ||
      nativeWorkflowProgram(expected, syntaxFailure) !== nativeWorkflowProgram(target, syntaxFailure))
      throw new Error("Changed native ShippingOptionRule batch callback behavior");
  }
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("shipping-option-rule-batch.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  for (const [expected, target] of pairs) {
    if (expected === undefined || target === undefined || typedProgram(expected) !== typedProgram(target))
      throw new Error("Changed native ShippingOptionRule batch public contract");
  }
}

/** Preserve the complete native Set/Link deletion topology, raw-ID restoration,
 * public input aliases and established portable void-result representation.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step */
export function verifyFulfillmentSetDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('import { createWorkflow, WorkflowData } from "@medusajs/framework/workflows-sdk"',
      'import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/workflows-sdk"')
    .replace('from "../steps"', 'from "../steps/delete-fulfillment-sets"')
    .replace('from "../../common"', 'from "../../common/steps/remove-remote-links"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('      [Modules.FULFILLMENT]: { fulfillment_set_id: input.ids },\n    })',
      '      [Modules.FULFILLMENT]: { fulfillment_set_id: input.ids },\n    })\n    return new WorkflowResponse(void 0)');
  const expectedStep = nativeStep
    .replace('from "@medusajs/framework/types"', 'from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  deleteFulfillmentSetsStepId,", '  { name: deleteFulfillmentSetsStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native FulfillmentSet deletion callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native FulfillmentSet deletion callback behavior");
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("fulfillment-set-delete.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  if (typedProgram(expectedWorkflow) !== typedProgram(workflow) || typedProgram(expectedStep) !== typedProgram(step))
    throw new Error("Changed native FulfillmentSet deletion public contract");
}

/** Preserve the full native update/list/projection/upsert contract. Only narrow
 * imports and the existing transaction-covered metadata may differ.
 * @param {string} nativeWorkflow @param {string} workflow
 * @param {string} nativeStep @param {string} step
 * @param {string} nativeTypes @param {string} types */
export function verifyServiceZoneUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeTypes, types) {
  const expectedWorkflow = nativeWorkflow.replaceAll("\r\n", "\n")
    .replace('import type {\n  FulfillmentWorkflow,\n  ServiceZoneDTO,\n} from "@medusajs/framework/types"',
      'import type * as FulfillmentWorkflow from "@medusajs/types/workflow/fulfillment/service-zones"\nimport type { ServiceZoneDTO } from "@medusajs/types/fulfillment/index"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  const expectedStep = nativeStep.replaceAll("\r\n", "\n")
    .replace('import {\n  FulfillmentWorkflow,\n  IFulfillmentModuleService,\n} from "@medusajs/framework/types"',
      'import type * as FulfillmentWorkflow from "@medusajs/types/workflow/fulfillment/service-zones"\nimport type { IFulfillmentModuleService } from "@medusajs/types/fulfillment/index"')
    .replace('import {\n  Modules,\n  getSelectsAndRelationsFromObjectArray,\n} from "@medusajs/framework/utils"',
      'import { Modules } from "@medusajs/utils/modules-sdk/definition"\nimport { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array"')
    .replace('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replace("  updateServiceZonesStepId,", '  { name: updateServiceZonesStepId, compensation: "transactionCovered" },');
  const syntaxFailure = "Invalid native ServiceZone update callback syntax";
  if (nativeWorkflowProgram(expectedWorkflow, syntaxFailure) !== nativeWorkflowProgram(workflow, syntaxFailure)
    || nativeWorkflowProgram(expectedStep, syntaxFailure) !== nativeWorkflowProgram(step, syntaxFailure))
    throw new Error("Changed native ServiceZone update callback behavior");
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("service-zone-update.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  if (typedProgram(expectedWorkflow) !== typedProgram(workflow) || typedProgram(expectedStep) !== typedProgram(step)
    || nativeTypes.replaceAll("\r\n", "\n") !== types.replaceAll("\r\n", "\n"))
    throw new Error("Changed native ServiceZone update public contract");
}

/** Authenticate native metadata-only scalar-field projection extraction,
 * including raw aliases and virtual terminal fields. No SQL body is retained.
 * @param {string} nativeRepository @param {string} relationOwner */
export function verifyNativeRelationScalarFields(nativeRepository, relationOwner) {
  /** @param {string} source @param {string} name @param {boolean} isInterface */
  const select = (source, name, isInterface = false) => {
    const file = ts.createSourceFile("relations.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const candidates = isInterface ? file.statements.filter(ts.isInterfaceDeclaration) : file.statements.filter(ts.isFunctionDeclaration);
    const declarations = candidates.filter(node => node.name?.text === name);
    const declaration = declarations[0];
    if (declarations.length !== 1 || declaration === undefined)
      throw new Error("Changed native relation scalar-field extraction");
    return declaration.getText(file).replace(/^export\s+/, "");
  };
  const native = select(nativeRepository, "relationScalarFieldPaths");
  const portable = select(relationOwner, "relationScalarFieldPaths");
  const syntaxFailure = "Invalid native relation scalar-field extraction syntax";
  if (nativeWorkflowProgram(native, syntaxFailure) !== nativeWorkflowProgram(portable, syntaxFailure))
    throw new Error("Changed native relation scalar-field extraction");
  const expected = native
    .replace("descriptors: Map<string, RelationDescriptor>", "descriptors: ReadonlyMap<string, ScalarFieldRelationDescriptor>")
    .replace("descriptorsByModel: Map<string, Map<string, RelationDescriptor>>", "descriptorsByModel: ReadonlyMap<string, ReadonlyMap<string, ScalarFieldRelationDescriptor>>")
    .replace("currentModel: PortableEntity | undefined", 'currentModel: ScalarFieldRelationDescriptor["targetModel"] | undefined');
  const expectedInterface = `interface ScalarFieldRelationDescriptor {
    readonly targetModel: { parse(): { schema: Readonly<Record<string, unknown>> } }
    readonly relationship: { readonly targetModel: string }
  }`;
  /** @param {string} source */
  const typedProgram = source => ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(ts.createSourceFile("relation-fields.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  if (typedProgram(expected) !== typedProgram(portable)
    || typedProgram(expectedInterface) !== typedProgram(select(relationOwner, "ScalarFieldRelationDescriptor", true)))
    throw new Error("Changed native relation scalar-field public contract");
}
