// @ts-check
import ts from "@typescript/typescript6";

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

/** Pricing retains its original creation/update profiles and a separately named
 * Store preference profile. Selection must not grant either branch the other's
 * methods, graph or receipt policy.
 * @param {string} source @param {string} target @param {string} repositorySource */
export function verifyPricingWorkflowSelection(source, target, repositorySource) {
  const contract = ts.createSourceFile("native.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declaration = contract.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === "IPricingModuleService");
  if (declaration === undefined || !ts.isInterfaceDeclaration(declaration)) throw new Error("Missing native Pricing interface");
  const methods = new Set(declaration.members.filter(ts.isMethodSignature).map(member => member.name.getText(contract)));
  if (["createPriceSets", "createPriceLists", "createPricePreferences", "listPricePreferences", "upsertPricePreferences", "deletePricePreferences"]
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
  const admitted = [];
  /** @type {ts.VariableDeclaration[]} */
  const graphs = [];
  /** @type {ts.CallExpression[]} */
  const modules = [];
  /** @type {ts.CallExpression[]} */
  const repositories = [];
  /** @type {ts.ParameterDeclaration[]} */
  const parameters = [];
  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineWorkflowModule") selections.push(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineCommerceModule") modules.push(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "preparePricingRepository") repositories.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "mutable") admissions.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "lifecycle") lifecycles.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "preferences") preferences.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "admitted") admitted.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "graph") graphs.push(node);
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === "admission") parameters.push(node);
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
  const methodBranches = initializer !== undefined && ts.isObjectLiteralExpression(initializer) ? [...initializer.properties] : [];
  const preferenceBranch = methodBranches[0], ordinaryBranch = methodBranches[1];
  const preferenceExpression = preferenceBranch !== undefined && ts.isSpreadAssignment(preferenceBranch) ? preferenceBranch.expression : undefined;
  const preferenceConditional = preferenceExpression !== undefined && ts.isParenthesizedExpression(preferenceExpression) ? preferenceExpression.expression : preferenceExpression;
  const preferenceSelection = preferenceConditional !== undefined && ts.isConditionalExpression(preferenceConditional)
    && ts.isIdentifier(preferenceConditional.condition) && preferenceConditional.condition.text === "preferences"
    && ts.isObjectLiteralExpression(preferenceConditional.whenFalse) && preferenceConditional.whenFalse.properties.length === 0
    ? preferenceConditional : undefined;
  const preferenceMethods = preferenceSelection !== undefined && ts.isObjectLiteralExpression(preferenceSelection.whenTrue)
    ? preferenceSelection.whenTrue.properties.map(property => ts.isShorthandPropertyAssignment(property) ? property.name.text : null) : [];
  const ordinaryExpression = ordinaryBranch !== undefined && ts.isSpreadAssignment(ordinaryBranch) ? ordinaryBranch.expression : undefined;
  const ordinaryConditional = ordinaryExpression !== undefined && ts.isParenthesizedExpression(ordinaryExpression) ? ordinaryExpression.expression : ordinaryExpression;
  const ordinarySelection = ordinaryConditional !== undefined && ts.isConditionalExpression(ordinaryConditional)
    && ts.isPrefixUnaryExpression(ordinaryConditional.condition) && ordinaryConditional.condition.operator === ts.SyntaxKind.ExclamationToken
    && ts.isIdentifier(ordinaryConditional.condition.operand) && ordinaryConditional.condition.operand.text === "preferences"
    && ts.isObjectLiteralExpression(ordinaryConditional.whenFalse) && ordinaryConditional.whenFalse.properties.length === 0
    ? ordinaryConditional.whenTrue : undefined;
  const properties = ordinarySelection !== undefined && ts.isObjectLiteralExpression(ordinarySelection) ? [...ordinarySelection.properties] : [];
  const lifecycleSpread = properties.pop();
  const spread = properties.pop();
  const selectedMethods = properties.map(property => ts.isShorthandPropertyAssignment(property) ? property.name.text : null);
  const expression = spread !== undefined && ts.isSpreadAssignment(spread) ? spread.expression : undefined;
  const conditional = expression !== undefined && ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  const updateMethods = conditional !== undefined && ts.isConditionalExpression(conditional) &&
    ts.isIdentifier(conditional.condition) && conditional.condition.text === "mutable" &&
    ts.isObjectLiteralExpression(conditional.whenTrue) && ts.isObjectLiteralExpression(conditional.whenFalse) && conditional.whenFalse.properties.length === 0
    ? conditional.whenTrue.properties.map(property => ts.isShorthandPropertyAssignment(property) ? property.name.text : null) : [];
  const lifecycleExpression = lifecycleSpread !== undefined && ts.isSpreadAssignment(lifecycleSpread) ? lifecycleSpread.expression : undefined;
  const lifecycleConditional = lifecycleExpression !== undefined && ts.isParenthesizedExpression(lifecycleExpression) ? lifecycleExpression.expression : lifecycleExpression;
  const lifecycleMethods = lifecycleConditional !== undefined && ts.isConditionalExpression(lifecycleConditional) &&
    ts.isIdentifier(lifecycleConditional.condition) && lifecycleConditional.condition.text === "lifecycle" &&
    ts.isObjectLiteralExpression(lifecycleConditional.whenTrue) && ts.isObjectLiteralExpression(lifecycleConditional.whenFalse) && lifecycleConditional.whenFalse.properties.length === 0
    ? lifecycleConditional.whenTrue.properties.map(property => ts.isShorthandPropertyAssignment(property) ? property.name.text : null) : [];
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
  if (admissions.length !== 1 || admissions[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="variant-updates"||admission==="product-updates"' ||
    lifecycles.length !== 1 || lifecycles[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="product-updates"' ||
    preferences.length !== 1 || preferences[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="store-preferences"' ||
    parameters.length !== 1 || parameters[0]?.initializer?.getText(adapter) !== '"create"' ||
    parameters[0]?.type?.getText(adapter).replace(/\s/g, "") !== '"create"|"variant-updates"|"product-updates"|"store-preferences"' ||
    selections.length !== 1 || selected.length !== 1 || methodBranches.length !== 2 || selectedMethods.length !== 3 ||
    selectedMethods.includes(null) || new Set(selectedMethods).size !== 3 ||
    !selectedMethods.includes("createPriceSets") || !selectedMethods.includes("createPriceLists") ||
    !selectedMethods.includes("createPricePreferences") || updateMethods.length !== 3 || new Set(updateMethods).size !== 3 ||
    !updateMethods.includes("upsertPriceSets") || !updateMethods.includes("updatePriceSets") || !updateMethods.includes("listPriceSets") ||
    lifecycleMethods.length !== 1 || lifecycleMethods[0] !== "softDeletePriceSets" ||
    preferenceMethods.length !== 3 || new Set(preferenceMethods).size !== 3 || preferenceMethods.includes(null) ||
    !preferenceMethods.includes("listPricePreferences") || !preferenceMethods.includes("upsertPricePreferences") || !preferenceMethods.includes("deletePricePreferences") ||
    modules.length !== 1 || repositories.length !== 1 || repositories[0]?.arguments.map(argument => argument.getText(adapter)).join(",") !== "metadata.frame,mutable,lifecycle,preferences" ||
    moduleInput === undefined || !ts.isObjectLiteralExpression(moduleInput) || moduleInput.properties.some(property => !ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) ||
    profiles.length !== 1 || profile === undefined || !ts.isObjectLiteralExpression(profile) ||
    profile.properties.some(property => (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) || !ts.isIdentifier(property.name)) ||
    profileNames.length !== 1 || profileNames[0]?.initializer.getText(adapter).replace(/\s/g, "") !==
      'preferences?"pricing-store-preferences":lifecycle?"pricing-product-updates":mutable?"pricing-variant-updates":"pricing-base-prices"' ||
    admitted.length !== 1 || admitted[0]?.initializer?.getText(adapter).replace(/\s/g, "") !==
      'preferences?[preferenceList,preferenceUpsert,preferenceDelete]:[create,createList,createPreference,list,count,retrieve,calculate,...(mutable?[upsert,update]:[]),...(lifecycle?[softDeletePriceSetsCommand]:[])]' ||
    graphs.length !== 1 || graph === undefined || !ts.isConditionalExpression(graph) ||
    graph.condition.getText(adapter) !== "preferences" || graph.whenTrue.getText(adapter).replace(/\s/g, "") !== '{aliases:[],reads:[]}' ||
    policies.length !== 1 || policyProperties.length !== 2 || policySpread === undefined || !ts.isSpreadAssignment(policySpread) ||
    policySpread.expression.getText(adapter).replace(/\s/g, "") !==
      '(preferences?pricingStorePreferencePolicy(preferenceContracts):lifecycle?pricingLogicalProductUpdateEventPolicy():mutable?pricingLogicalMutationEventPolicy():pricingLogicalCreateEventPolicy())' ||
    commands === undefined || !ts.isPropertyAssignment(commands) || commands.name.getText(adapter) !== "commands" || commands.initializer.getText(adapter) !== "admitted")
    throw new Error("Unadmitted native Pricing workflow selection");

  // Keep the old Product preference lookup grammar unchanged. The named Store
  // repository has its own four-pair decoder, selected only by its explicit flag.
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
  // Unlike test ports, executable workflow files admit no unused-result or
  // test-runner exceptions. Every emitted statement and import participates.
  /** @param {string} source */
  const program = source => {
    const emitted = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
      newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
    } });
    if (emitted.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
      throw new Error("Invalid native Reservation Line Item callback syntax");
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
  };
  if (program(expectedWorkflow) !== program(workflow) || program(expectedStep) !== program(step))
    throw new Error("Changed native Reservation Line Item deletion callback behavior");
}
