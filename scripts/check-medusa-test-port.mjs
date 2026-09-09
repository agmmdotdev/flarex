// @ts-check
import ts from "@typescript/typescript6";

const vitestBindings = new Set(["afterAll", "afterEach", "beforeAll", "beforeEach", "describe", "expect", "it", "test", "vi"]);
const currencyImports = new Map([["../index", "@medusajs/currency/index"], ["../static-manifest", "@medusajs/currency/static-manifest"], ["../models", "@medusajs/currency/models"]]);

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
 * limited to explicit Vitest globals; the Currency timeout moves to config.
 * A void marker may retain an original intentionally unused local result.
 * @param {string} source
 * @param {{ currencyTimeout?: boolean, currencyStaticImports?: boolean }} options
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
      if (options.currencyTimeout && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
        && ts.isIdentifier(expression.expression.expression) && expression.expression.expression.text === "jest"
        && expression.expression.name.text === "setTimeout" && expression.arguments.length === 1
        && ts.isNumericLiteral(expression.arguments[0]) && expression.arguments[0].text === "100000") return undefined;
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

/** @param {string} source @param {string} target @param {{ currencyTimeout?: boolean, currencyStaticImports?: boolean }} options */
export function verifyTestPort(source, target, options = {}) {
  if (testPortProgram(source, options) !== testPortProgram(target, options)) {
    throw new Error("Test port changed executable scenario, assertion, or runtime import");
  }
}
