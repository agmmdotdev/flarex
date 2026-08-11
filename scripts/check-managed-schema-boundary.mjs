#!/usr/bin/env node
// @ts-check
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const repoRoot = process.cwd();
const packageRoot = path.join(repoRoot, "packages", "managed-schema");
const sourceRoot = path.join(packageRoot, "src");
const normalizedSourceRoot = "packages/managed-schema/src";
const supportedExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const allowedImports = new Set([
  "flarex-protocol/schema-manifest",
  "flarex-protocol/validator-json",
]);
const expectedDependencies = Object.freeze({
  "flarex-protocol": "workspace:*",
});
const expectedDevDependencies = Object.freeze({
  typescript: "catalog:",
  vitest: "catalog:",
});

/**
 * @typedef {{ relativePath: string; text: string }} ManagedSchemaSourceInput
 * @typedef {{ errors: string[] }} ManagedSchemaBoundaryReport
 * @typedef {{ errors: string[]; files: string[] }} SourceDiscoveryReport
 * @typedef {{
 *   isDirectory: () => boolean;
 *   isFile: () => boolean;
 *   isSymbolicLink: () => boolean;
 * }} SourceEntryStats
 * @typedef {{
 *   readDirectory: (root: string) => string[];
 *   readStats: (file: string) => SourceEntryStats;
 * }} SourceTreeReader
 */

/** @type {SourceTreeReader} */
const nodeSourceTreeReader = {
  readDirectory: (root) => readdirSync(root),
  readStats: (file) => lstatSync(file),
};

if (isCliEntrypoint()) {
  /** @type {unknown} */
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const discovered = collectManagedSchemaSourceFiles(sourceRoot);
  const report = analyzeManagedSchemaBoundary(
    manifest,
    discovered.files.map((file) => ({
      relativePath: normalizePath(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    })),
  );
  report.errors.unshift(...discovered.errors);

  if (report.errors.length > 0) {
    console.error(report.errors.join("\n\n"));
    process.exitCode = 1;
  } else {
    console.log("Managed schema package boundary check passed.");
    console.log("Allowed package export: ./compatibility");
    console.log("Allowed production dependency: flarex-protocol");
  }
}

/**
 * @param {unknown} manifest
 * @param {ManagedSchemaSourceInput[]} sources
 * @returns {ManagedSchemaBoundaryReport}
 */
export function analyzeManagedSchemaBoundary(manifest, sources) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(manifest)) {
    return { errors: ["Managed schema package manifest must be an object."] };
  }
  if (manifest.name !== "@flarex/managed-schema") {
    errors.push("Managed schema package must retain its approved package name.");
  }
  collectExactRecordErrors(
    manifest.exports,
    { "./compatibility": "./src/Compatibility.ts" },
    "exports",
    errors,
  );
  collectExactRecordErrors(
    manifest.dependencies,
    expectedDependencies,
    "runtime dependencies",
    errors,
  );
  collectExactRecordErrors(
    manifest.devDependencies,
    expectedDevDependencies,
    "development dependencies",
    errors,
  );
  for (const field of ["optionalDependencies", "peerDependencies"]) {
    const value = manifest[field];
    if (value !== undefined && (!isRecord(value) || Object.keys(value).length > 0)) {
      errors.push(`Managed schema package must not declare ${field}.`);
    }
  }
  for (const source of sources) collectSourceErrors(source, errors);
  return { errors };
}

/**
 * @param {string} root
 * @param {SourceTreeReader} [reader]
 * @returns {SourceDiscoveryReport}
 */
export function collectManagedSchemaSourceFiles(
  root,
  reader = nodeSourceTreeReader,
) {
  /** @type {SourceDiscoveryReport} */
  const report = { errors: [], files: [] };
  const rootStats = reader.readStats(root);
  if (rootStats.isSymbolicLink()) {
    report.errors.push(
      `Managed schema source root must not be a symbolic link: ${normalizePath(root)}.`,
    );
    return report;
  }
  if (!rootStats.isDirectory()) {
    report.errors.push(
      `Managed schema source root must be a directory: ${normalizePath(root)}.`,
    );
    return report;
  }
  visit(root);
  return report;

  /** @param {string} directory */
  function visit(directory) {
    for (const entry of reader.readDirectory(directory)) {
      const absolutePath = path.join(directory, entry);
      const stats = reader.readStats(absolutePath);
      if (stats.isSymbolicLink()) {
        report.errors.push(
          `Managed schema source tree must not contain symbolic link ${normalizePath(absolutePath)}.`,
        );
      } else if (stats.isDirectory()) {
        visit(absolutePath);
      } else if (
        stats.isFile()
        && supportedExtensions.has(path.extname(absolutePath))
      ) {
        report.files.push(absolutePath);
      } else {
        report.errors.push(
          `Managed schema source tree contains unsupported entry ${normalizePath(absolutePath)}.`,
        );
      }
    }
  }
}

/**
 * @param {unknown} actual
 * @param {Readonly<Record<string, string>>} expected
 * @param {string} label
 * @param {string[]} errors
 */
function collectExactRecordErrors(actual, expected, label, errors) {
  if (!isRecord(actual)) {
    errors.push(`Managed schema package ${label} must be an object.`);
    return;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    errors.push(
      `Managed schema package ${label} must be exactly: ${expectedKeys.join(", ")}.`,
    );
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      errors.push(
        `Managed schema package ${label} entry ${key} must be ${expected[key]}.`,
      );
    }
  }
}

/**
 * @param {ManagedSchemaSourceInput} source
 * @param {string[]} errors
 */
function collectSourceErrors(source, errors) {
  const sourceFile = ts.createSourceFile(
    source.relativePath,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const preprocessed = ts.preProcessFile(source.text, true, true);
  for (const directive of [
    ...preprocessed.referencedFiles,
    ...preprocessed.typeReferenceDirectives,
  ]) collectSpecifierError(directive.fileName, directive.pos);
  /** @type {Set<ts.Node>} */
  const visitedJsDoc = new Set();
  visit(sourceFile);

  /** @param {ts.Node} node */
  function visit(node) {
    const reference = moduleReferenceFromNode(node);
    if (reference?.kind === "nonLiteral") {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      errors.push(
        `${source.relativePath}:${line + 1} uses a non-literal module reference.`,
      );
    } else if (reference?.kind === "module") {
      collectSpecifierError(reference.specifier, node.getStart(sourceFile));
      collectProtocolReferenceKindError(node, reference.specifier);
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
    const reference = moduleReferenceFromNode(node);
    if (reference?.kind === "module") {
      collectSpecifierError(reference.specifier, node.getStart(sourceFile));
    }
    ts.forEachChild(node, visitJsDoc);
  }

  /** @param {string} specifier @param {number} position */
  function collectSpecifierError(specifier, position) {
    if (isAllowedImport(specifier, source.relativePath)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);
    errors.push(
      `${source.relativePath}:${line + 1} imports forbidden module ${JSON.stringify(specifier)}.`,
    );
  }

  /** @param {ts.Node} node @param {string} specifier */
  function collectProtocolReferenceKindError(node, specifier) {
    if (!allowedImports.has(specifier)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    if (ts.isExportDeclaration(node)) {
      errors.push(
        `${source.relativePath}:${line + 1} re-exports protocol owner ${JSON.stringify(specifier)}.`,
      );
    } else if (
      ts.isCallExpression(node)
      || ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      || ts.isImportDeclaration(node)
        && !isTypeOnlyImportDeclaration(node)
    ) {
      errors.push(
        `${source.relativePath}:${line + 1} value-imports protocol owner ${JSON.stringify(specifier)}.`,
      );
    }
  }
}

/** @param {ts.ImportDeclaration} declaration */
function isTypeOnlyImportDeclaration(declaration) {
  const clause = declaration.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  return bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.length > 0
    && bindings.elements.every((element) => element.isTypeOnly);
}

/**
 * @typedef {{ kind: "module"; specifier: string } | { kind: "nonLiteral" }} ModuleReference
 * @param {ts.Node} node
 * @returns {ModuleReference | undefined}
 */
function moduleReferenceFromNode(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined
    && ts.isStringLiteralLike(node.moduleSpecifier)
  ) return { kind: "module", specifier: node.moduleSpecifier.text };
  if (
    ts.isImportEqualsDeclaration(node)
    && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression !== undefined
    && ts.isStringLiteralLike(node.moduleReference.expression)
  ) return {
    kind: "module",
    specifier: node.moduleReference.expression.text,
  };
  if (
    ts.isImportTypeNode(node)
    && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteralLike(node.argument.literal)
  ) return { kind: "module", specifier: node.argument.literal.text };
  if (
    ts.isJSDocImportTag(node)
    && ts.isStringLiteralLike(node.moduleSpecifier)
  ) return { kind: "module", specifier: node.moduleSpecifier.text };
  if (
    ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [argument] = node.arguments;
    return argument !== undefined && ts.isStringLiteralLike(argument)
      ? { kind: "module", specifier: argument.text }
      : { kind: "nonLiteral" };
  }
  if (ts.isCallExpression(node) && isRequireLike(node.expression)) {
    const [argument] = node.arguments;
    return argument !== undefined && ts.isStringLiteralLike(argument)
      ? { kind: "module", specifier: argument.text }
      : { kind: "nonLiteral" };
  }
  return undefined;
}

/** @param {ts.LeftHandSideExpression} expression */
function isRequireLike(expression) {
  return ts.isIdentifier(expression) && expression.text === "require"
    || ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === "module"
      && expression.name.text === "require"
    || ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === "require"
      && expression.name.text === "resolve";
}

/** @param {string} specifier @param {string} sourcePath */
function isAllowedImport(specifier, sourcePath) {
  if (specifier.includes("\\")) return false;
  if (allowedImports.has(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(sourcePath.replaceAll("\\", "/")),
    specifier,
  ));
  return resolved === normalizedSourceRoot
    || resolved.startsWith(`${normalizedSourceRoot}/`);
}

/** @param {unknown} value @returns {value is Readonly<Record<string, unknown>>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCliEntrypoint() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined
    && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

/** @param {string} value */
function normalizePath(value) {
  return value.split(path.sep).join("/");
}
