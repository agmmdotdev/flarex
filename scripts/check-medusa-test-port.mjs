// @ts-check
import ts from "@typescript/typescript6";

const vitestBindings = new Set(["afterAll", "afterEach", "beforeAll", "beforeEach", "describe", "expect", "it", "test", "vi"]);
const currencyImports = new Map([["../index", "@medusajs/currency/index"], ["../static-manifest", "@medusajs/currency/static-manifest"], ["../models", "@medusajs/currency/models"]]);

/** Two unchanged native item creation bodies; all other Inventory methods remain deferred.
 * @param {string} source @param {string} target */
export function verifyInventoryCreateTests(source, target) {
  const names = new Set(["should create an inventory item", "should create inventory items from array"]);
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
          bodies.set(name.text, JSON.stringify(testPortProgram(node.getText(file) + ";")));
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

/** Pricing admits creation methods and an explicit variant-update profile. Other calls
 * share the workflow binder's runtime refusal boundary.
 * @param {string} source @param {string} target */
export function verifyPricingWorkflowSelection(source, target) {
  const contract = ts.createSourceFile("native.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declaration = contract.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === "IPricingModuleService");
  if (declaration === undefined || !ts.isInterfaceDeclaration(declaration)) throw new Error("Missing native Pricing interface");
  const methods = new Set(declaration.members.filter(ts.isMethodSignature).map(member => member.name.getText(contract)));
  if (!methods.has("createPriceSets") || !methods.has("createPriceLists") || !methods.has("createPricePreferences"))
    throw new Error("Missing native Pricing creation methods");
  const adapter = ts.createSourceFile("adapter.ts", target, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @type {ts.CallExpression[]} */
  const selections = [];
  /** @type {ts.VariableDeclaration[]} */
  const admissions = [];
  /** @type {ts.ParameterDeclaration[]} */
  const parameters = [];
  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineWorkflowModule") selections.push(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "mutable") admissions.push(node);
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
  const properties = initializer !== undefined && ts.isObjectLiteralExpression(initializer) ? [...initializer.properties] : [];
  const spread = properties.pop();
  const selectedMethods = properties.map(property => ts.isShorthandPropertyAssignment(property) ? property.name.text : null);
  const expression = spread !== undefined && ts.isSpreadAssignment(spread) ? spread.expression : undefined;
  const conditional = expression !== undefined && ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  const updateMethods = conditional !== undefined && ts.isConditionalExpression(conditional) &&
    ts.isIdentifier(conditional.condition) && conditional.condition.text === "mutable" &&
    ts.isObjectLiteralExpression(conditional.whenTrue) && ts.isObjectLiteralExpression(conditional.whenFalse) && conditional.whenFalse.properties.length === 0
    ? conditional.whenTrue.properties.map(property => ts.isShorthandPropertyAssignment(property) ? property.name.text : null) : [];
  if (admissions.length !== 1 || admissions[0]?.initializer?.getText(adapter).replace(/\s/g, "") !== 'admission==="variant-updates"' ||
    parameters.length !== 1 || parameters[0]?.initializer?.getText(adapter) !== '"create"' ||
    selections.length !== 1 || selected.length !== 1 || selectedMethods.length !== 3 ||
    selectedMethods.includes(null) || new Set(selectedMethods).size !== 3 ||
    !selectedMethods.includes("createPriceSets") || !selectedMethods.includes("createPriceLists") ||
    !selectedMethods.includes("createPricePreferences") || updateMethods.length !== 3 || new Set(updateMethods).size !== 3 ||
    !updateMethods.includes("upsertPriceSets") || !updateMethods.includes("updatePriceSets") || !updateMethods.includes("listPriceSets"))
    throw new Error("Unadmitted native Pricing workflow selection");
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
