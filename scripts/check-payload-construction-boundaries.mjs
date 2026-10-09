// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const allowedPersistence = new Set([
  "internal/cms-adapter", "internal/cms-execution", "internal/execution-diagnostics",
  "internal/logical-participant-admission", "internal/logical-participant-errors", "internal/session-journal",
]);
const constructionNames = new Set([
  "CmsHostInput", "SourceCmsHostInput", "CmsReadHostInput", "PayloadHostInput", "PayloadReadHostInput",
  "makeCmsHost", "makeCmsReadHost", "makeCmsCommandBinding", "makeCmsReadBinding",
  "getCmsCommand", "makeBorrowedCmsAttempt", "makeApplicationServing", "makeApplicationReadServing",
  "createSessionJournalStorePersistence", "createAppDeveloperIndexQueryPortV1",
  "issuePreparedFiniteSessionJournalEntry", "issueFrozenFiniteAttempt",
]);

/** All import forms use the same boundary, including erased types/re-exports.
 * @param {string} relativePath
 * @param {string} text
 * @returns {string[]}
 */
export function inspectPayloadConstructionBoundary(relativePath, text) {
  /** @type {string[]} */
  const errors = [];
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** @param {ts.Node} node */
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined)
      specifier = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      specifier = node.moduleReference.expression;
    if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
      const module = specifier.text;
      const persistence = module === "@flarex/persistence-postgres" ||
        module.startsWith("@flarex/persistence-postgres/");
      const resolved = module.startsWith(".")
        ? path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), module)) : module;
      if (persistence &&
        !allowedPersistence.has(module.slice("@flarex/persistence-postgres/".length)))
        errors.push(`${relativePath}: privileged persistence import ${module}`);
      if (persistence && ts.isImportTypeNode(node) &&
        node.qualifier !== undefined) {
        const name = ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.right.text;
        if (constructionNames.has(name)) errors.push(`${relativePath}: adapter borrows construction owner ${name}`);
      }
      if (persistence &&
        (ts.isCallExpression(node) || ts.isImportEqualsDeclaration(node)))
        errors.push(`${relativePath}: dynamic persistence namespace hides imported authority`);
      if (resolved.startsWith("packages/persistence-postgres/"))
        errors.push(`${relativePath}: source-relative persistence bypass ${module}`);
      if (/(?:^|\/)testing(?:\/|\.|$)/.test(resolved) || /\/internal\/testing$/.test(module))
        errors.push(`${relativePath}: test machinery in ordinary construction ${module}`);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        persistence) {
        const clause = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        if (clause !== undefined && (ts.isNamedImports(clause) || ts.isNamedExports(clause))) {
          for (const name of clause.elements) {
            const original = (name.propertyName ?? name.name).text;
            if (constructionNames.has(original)) errors.push(`${relativePath}: adapter borrows construction owner ${original}`);
          }
        } else if (ts.isExportDeclaration(node) || (clause !== undefined && ts.isNamespaceImport(clause)))
          errors.push(`${relativePath}: persistence namespace hides imported authority`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

/** @param {string} directory @returns {string[]} */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? files(name) : name.endsWith(".ts") ? [name] : [];
  });
}
export function checkPayloadConstructionBoundaries(root = process.cwd()) {
  const failures = files(path.join(root, "packages/payload-adapter/src")).flatMap(file => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative.includes("/testing/") || relative.endsWith("/testing.ts")) return [];
    return inspectPayloadConstructionBoundary(relative, readFileSync(file, "utf8"));
  });
  if (failures.length > 0) throw new Error(failures.join("\n"));
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPayloadConstructionBoundaries();
  console.log("Payload construction boundaries passed");
}
