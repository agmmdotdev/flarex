#!/usr/bin/env node
// @ts-check
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

/**
 * @typedef {{
 *   relativePath: string;
 *   text: string;
 *   scriptKind?: ts.ScriptKind;
 * }} SourceInput
 *
 * @typedef {{
 *   errors: string[];
 * }} StandardApplicationDefinitionBoundaryReport
 *
 * @typedef {{
 *   isDirectory: () => boolean;
 *   isFile: () => boolean;
 *   isSymbolicLink: () => boolean;
 * }} SourceEntryStats
 *
 * @typedef {{
 *   readDirectory: (root: string) => string[];
 *   readStats: (file: string) => SourceEntryStats;
 * }} SourceTreeReader
 *
 * @typedef {{
 *   errors: string[];
 *   files: string[];
 * }} SourceDiscoveryReport
 */

const repoRoot = process.cwd();
const packageRoot = path.join(
  repoRoot,
  "packages",
  "standard-application-definition",
);
const productionSourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const expectedRuntimeDependencies = new Map([
  ["@flarex/analysis", "workspace:*"],
  ["@flarex/declarative-materializer", "workspace:*"],
  ["@flarex/declarative-program", "workspace:*"],
  ["@flarex/durable-task", "workspace:*"],
  ["@flarex/utils", "workspace:*"],
  ["effect", "catalog:"],
  ["flarex-protocol", "workspace:*"],
]);
const shippedDefinitionAllowedProductionImports = new Set([
  "@flarex/declarative-materializer/v1",
  "@flarex/declarative-program/v1",
  "effect",
]);
const taskDefinitionAllowedProductionImports = new Set([
  ...shippedDefinitionAllowedProductionImports,
  "@flarex/analysis/internal/private-sha256-v1",
  "@flarex/durable-task/internal/run-attempt-v1",
  "@flarex/utils/bytes",
  "flarex-protocol/json",
  "flarex-protocol/validator-json",
]);
const admittedDurableTaskDefinitionSymbols = new Set([
  "RunAttemptPolicyV1",
  "RunAttemptPolicyV1Schema",
  "TaskComputeProfileRefV1",
  "TaskComputeProfileRefV1Schema",
  "TaskDefinitionRevisionIdV1",
  "TaskDefinitionRevisionIdV1Schema",
]);
const standardApplicationDefinitionSourceRoot =
  "packages/standard-application-definition/src";
/** @type {SourceTreeReader} */
const nodeSourceTreeReader = {
  readDirectory(root) {
    return readdirSync(root);
  },
  readStats(file) {
    return lstatSync(file);
  },
};

if (isCliEntrypoint()) {
  /** @type {unknown} */
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const sourceRoot = path.join(packageRoot, "src");
  const sourceDiscovery = collectProductionSourceFiles(sourceRoot);
  const report = analyzeStandardApplicationDefinitionBoundary(
    manifest,
    sourceDiscovery.files.map((file) => ({
      relativePath: normalizePath(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
      scriptKind: scriptKindForPath(file),
    })),
  );
  report.errors.unshift(...sourceDiscovery.errors);

  if (report.errors.length > 0) {
    console.error(report.errors.join("\n\n"));
    process.exitCode = 1;
  } else {
    console.log("Standard Application definition boundary check passed.");
    console.log(
      "Allowed package exports: ./v1, ./internal/task-definition-v1",
    );
    console.log(
      `Allowed runtime dependencies: ${expectedRuntimeDependencies.size}`,
    );
  }
}

/**
 * @param {unknown} manifest
 * @param {SourceInput[]} sources
 * @returns {StandardApplicationDefinitionBoundaryReport}
 */
export function analyzeStandardApplicationDefinitionBoundary(
  manifest,
  sources,
) {
  /** @type {string[]} */
  const errors = [];

  if (!isRecord(manifest)) {
    return {
      errors: ["Standard Application definition manifest must be an object."],
    };
  }

  if (manifest.name !== "@flarex/standard-application-definition") {
    errors.push(
      "Standard Application definition manifest must retain its package name.",
    );
  }

  collectExportErrors(manifest.exports, errors);
  collectRuntimeDependencyErrors(manifest, errors);

  for (const source of sources) {
    collectSourceImportErrors(source, errors);
  }

  return { errors };
}

/**
 * @param {string} root
 * @param {SourceTreeReader} [reader]
 * @returns {SourceDiscoveryReport}
 */
export function collectProductionSourceFiles(
  root,
  reader = nodeSourceTreeReader,
) {
  /** @type {SourceDiscoveryReport} */
  const report = { errors: [], files: [] };
  const rootStats = reader.readStats(root);
  if (rootStats.isSymbolicLink()) {
    report.errors.push(
      `Standard Application definition source root must not be a symbolic link: ${normalizePath(root)}.`,
    );
    return report;
  }
  if (!rootStats.isDirectory()) {
    report.errors.push(
      `Standard Application definition source root must be a directory: ${normalizePath(root)}.`,
    );
    return report;
  }
  visitDirectory(root);
  return report;

  /** @param {string} directory */
  function visitDirectory(directory) {
    for (const entry of reader.readDirectory(directory)) {
      const absolutePath = path.join(directory, entry);
      const stats = reader.readStats(absolutePath);
      if (stats.isSymbolicLink()) {
        report.errors.push(
          `Standard Application definition source tree must not contain symbolic link ${normalizePath(absolutePath)}.`,
        );
      } else if (stats.isDirectory()) {
        visitDirectory(absolutePath);
      } else if (stats.isFile()) {
        if (isSupportedProductionSourceFile(absolutePath)) {
          report.files.push(absolutePath);
        } else {
          report.errors.push(
            `Standard Application definition source tree contains unsupported source file ${normalizePath(absolutePath)}.`,
          );
        }
      } else {
        report.errors.push(
          `Standard Application definition source tree contains unsupported entry ${normalizePath(absolutePath)}.`,
        );
      }
    }
  }
}

/**
 * @param {unknown} exportsValue
 * @param {string[]} errors
 */
function collectExportErrors(exportsValue, errors) {
  if (!isRecord(exportsValue)) {
    errors.push(
      "Standard Application definition package must expose only the explicit ./v1 and ./internal/task-definition-v1 subpaths.",
    );
    return;
  }

  const exportNames = Object.keys(exportsValue).sort();
  if (
    exportNames.length !== 2
    || exportNames[0] !== "./internal/task-definition-v1"
    || exportNames[1] !== "./v1"
    || exportsValue["./internal/task-definition-v1"] !==
      "./src/taskDefinition/v1.ts"
    || exportsValue["./v1"] !== "./src/v1.ts"
  ) {
    errors.push(
      "Standard Application definition package must expose exactly ./v1 and ./internal/task-definition-v1 with no package root.",
    );
  }
}

/**
 * @param {Readonly<Record<string, unknown>>} manifest
 * @param {string[]} errors
 */
function collectRuntimeDependencyErrors(manifest, errors) {
  const dependencies = manifest.dependencies;
  if (!isRecord(dependencies)) {
    errors.push(
      "Standard Application definition runtime dependencies must be an object.",
    );
  } else {
    const dependencyNames = Object.keys(dependencies).sort();
    const expectedNames = Array.from(expectedRuntimeDependencies.keys()).sort();

    if (
      dependencyNames.length !== expectedNames.length
      || dependencyNames.some((name, index) => name !== expectedNames[index])
    ) {
      errors.push(
        `Standard Application definition runtime dependencies must be exactly: ${expectedNames.join(", ")}.`,
      );
    }

    for (const [dependencyName, expectedSpecifier] of expectedRuntimeDependencies) {
      if (dependencies[dependencyName] !== expectedSpecifier) {
        errors.push(
          `Standard Application definition dependency ${dependencyName} must use ${expectedSpecifier}.`,
        );
      }
    }
  }

  for (const dependencyField of ["optionalDependencies", "peerDependencies"]) {
    const fieldValue = manifest[dependencyField];
    if (fieldValue === undefined) {
      continue;
    }
    if (!isRecord(fieldValue) || Object.keys(fieldValue).length > 0) {
      errors.push(
        `Standard Application definition package must not declare ${dependencyField}.`,
      );
    }
  }
}

/**
 * @param {SourceInput} source
 * @param {string[]} errors
 */
function collectSourceImportErrors(source, errors) {
  const sourceFile = ts.createSourceFile(
    source.relativePath,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    source.scriptKind ?? scriptKindForPath(source.relativePath),
  );

  const preprocessed = ts.preProcessFile(source.text, true, true);
  for (const directive of [
    ...preprocessed.referencedFiles,
    ...preprocessed.typeReferenceDirectives,
  ]) {
    collectSpecifierError(directive.fileName, directive.pos);
  }

  /** @type {Set<ts.Node>} */
  const visitedJsDoc = new Set();
  const admittedDurableTaskLocalBindings = collectAdmittedDurableTaskLocalBindings(
    sourceFile,
  );
  visit(sourceFile);

  /** @param {ts.Node} node */
  function visit(node) {
    if (isLocalBindingReExport(node, admittedDurableTaskLocalBindings)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      errors.push(
        `${source.relativePath}:${line + 1} re-exports an admitted durable-task binding.`,
      );
    }
    const moduleReference = moduleReferenceFromNode(node);
    if (moduleReference !== undefined) {
      if (moduleReference.kind === "nonLiteralDynamicImport") {
        collectNonLiteralError("dynamic import", node.getStart(sourceFile));
      } else if (moduleReference.kind === "nonLiteralRequire") {
        collectNonLiteralError("require", node.getStart(sourceFile));
      } else if (moduleReference.kind === "nonLiteralRequireResolve") {
        collectNonLiteralError("require.resolve", node.getStart(sourceFile));
      } else {
        collectSpecifierError(
          moduleReference.specifier,
          node.getStart(sourceFile),
        );
        collectDurableTaskSymbolError(moduleReference.specifier, node);
      }
    }

    for (const jsDoc of ts.getJSDocCommentsAndTags(node)) {
      if (!visitedJsDoc.has(jsDoc)) {
        visitedJsDoc.add(jsDoc);
        visitJsDoc(jsDoc);
      }
    }
    ts.forEachChild(node, visit);
  }

  /** @param {ts.Node} node */
  function visitJsDoc(node) {
    const moduleReference = moduleReferenceFromNode(node);
    if (moduleReference?.kind === "module") {
      collectSpecifierError(
        moduleReference.specifier,
        node.getStart(sourceFile),
      );
    }
    ts.forEachChild(node, visitJsDoc);
  }

  /**
   * @param {string} specifier
   * @param {number} position
   */
  function collectSpecifierError(specifier, position) {
    if (!isAllowedProductionImport(specifier, source.relativePath)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(position);
      errors.push(
        `${source.relativePath}:${line + 1} imports forbidden module ${JSON.stringify(specifier)}.`,
      );
    }
  }

  /**
   * @param {"dynamic import" | "require" | "require.resolve"} operation
   * @param {number} position
   */
  function collectNonLiteralError(operation, position) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);
    errors.push(
      `${source.relativePath}:${line + 1} uses a non-literal ${operation}.`,
    );
  }

  /**
   * @param {string} specifier
   * @param {ts.Node} node
   */
  function collectDurableTaskSymbolError(specifier, node) {
    if (
      specifier !== "@flarex/durable-task/internal/run-attempt-v1"
      || isAdmittedDurableTaskDefinitionImport(node)
    ) {
      return;
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    errors.push(
      `${source.relativePath}:${line + 1} imports forbidden durable-task symbols from ${JSON.stringify(specifier)}.`,
    );
  }
}

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {ReadonlySet<string>}
 */
function collectAdmittedDurableTaskLocalBindings(sourceFile) {
  const bindings = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || statement.moduleSpecifier === undefined
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !==
        "@flarex/durable-task/internal/run-attempt-v1"
      || !isAdmittedDurableTaskDefinitionImport(statement)
    ) {
      continue;
    }
    const namedImports = statement.importClause?.namedBindings;
    if (namedImports !== undefined && ts.isNamedImports(namedImports)) {
      for (const element of namedImports.elements) bindings.add(element.name.text);
    }
  }
  return bindings;
}

/**
 * @param {ts.Node} node
 * @param {ReadonlySet<string>} importedBindings
 */
function isLocalBindingReExport(node, importedBindings) {
  if (
    ts.isExportDeclaration(node)
    && node.moduleSpecifier === undefined
    && node.exportClause !== undefined
    && ts.isNamedExports(node.exportClause)
  ) {
    return node.exportClause.elements.some((element) =>
      importedBindings.has(element.propertyName?.text ?? element.name.text)
    );
  }
  return ts.isExportAssignment(node)
    && !node.isExportEquals
    && ts.isIdentifier(node.expression)
    && importedBindings.has(node.expression.text);
}

/**
 * @typedef {{
 *   kind: "module";
 *   specifier: string;
 * } | {
 *   kind: "nonLiteralDynamicImport";
 * } | {
 *   kind: "nonLiteralRequire";
 * } | {
 *   kind: "nonLiteralRequireResolve";
 * }} ModuleReference
 */

/**
 * @param {ts.Node} node
 * @returns {ModuleReference | undefined}
 */
function moduleReferenceFromNode(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined
    && ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return { kind: "module", specifier: node.moduleSpecifier.text };
  }

  if (
    ts.isImportEqualsDeclaration(node)
    && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression !== undefined
    && ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return {
      kind: "module",
      specifier: node.moduleReference.expression.text,
    };
  }

  if (
    ts.isImportTypeNode(node)
    && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteralLike(node.argument.literal)
  ) {
    return {
      kind: "module",
      specifier: node.argument.literal.text,
    };
  }

  if (
    ts.isJSDocImportTag(node)
    && ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return {
      kind: "module",
      specifier: node.moduleSpecifier.text,
    };
  }

  if (
    ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [argument] = node.arguments;
    if (argument === undefined || !ts.isStringLiteralLike(argument)) {
      return { kind: "nonLiteralDynamicImport" };
    }
    return { kind: "module", specifier: argument.text };
  }

  if (
    ts.isCallExpression(node)
    && isDirectRequireExpression(node.expression)
  ) {
    const [argument] = node.arguments;
    if (argument === undefined || !ts.isStringLiteralLike(argument)) {
      return { kind: "nonLiteralRequire" };
    }
    return { kind: "module", specifier: argument.text };
  }

  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "require"
    && node.expression.name.text === "resolve"
  ) {
    const [argument] = node.arguments;
    if (argument === undefined || !ts.isStringLiteralLike(argument)) {
      return { kind: "nonLiteralRequireResolve" };
    }
    return { kind: "module", specifier: argument.text };
  }

  return undefined;
}

/**
 * @param {ts.LeftHandSideExpression} expression
 * @returns {boolean}
 */
function isDirectRequireExpression(expression) {
  return (
    ts.isIdentifier(expression)
    && expression.text === "require"
  ) || (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "module"
    && expression.name.text === "require"
  );
}

/**
 * @param {string} specifier
 * @param {string} relativePath
 * @returns {boolean}
 */
function isAllowedProductionImport(specifier, relativePath) {
  if (specifier.includes("\\")) {
    return false;
  }
  const normalizedSourcePath = relativePath.replaceAll("\\", "/");
  const allowedImports = normalizedSourcePath.startsWith(
      `${standardApplicationDefinitionSourceRoot}/taskDefinition/`,
    )
    ? taskDefinitionAllowedProductionImports
    : shippedDefinitionAllowedProductionImports;
  if (allowedImports.has(specifier)) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolvedImportPath = path.posix.normalize(path.posix.join(
    path.posix.dirname(normalizedSourcePath),
    specifier,
  ));
  return resolvedImportPath === standardApplicationDefinitionSourceRoot
    || resolvedImportPath.startsWith(
      `${standardApplicationDefinitionSourceRoot}/`,
    );
}

/** @param {ts.Node} node */
function isAdmittedDurableTaskDefinitionImport(node) {
  if (!ts.isImportDeclaration(node)) return false;
  const clause = node.importClause;
  if (
    clause === undefined || clause.name !== undefined
    || clause.namedBindings === undefined
    || !ts.isNamedImports(clause.namedBindings)
    || clause.namedBindings.elements.length === 0
  ) {
    return false;
  }
  return clause.namedBindings.elements.every((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    return admittedDurableTaskDefinitionSymbols.has(importedName);
  });
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @returns {boolean} */
function isCliEntrypoint() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined
    && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isSupportedProductionSourceFile(file) {
  return productionSourceExtensions.has(path.extname(file));
}

/**
 * @param {string} file
 * @returns {ts.ScriptKind}
 */
function scriptKindForPath(file) {
  switch (path.extname(file)) {
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return value.split(path.sep).join("/");
}
