#!/usr/bin/env node
// @ts-check
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const repoRoot = process.cwd();
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const ignoredDirectoryNames = new Set([".turbo", "node_modules"]);
const rootArtifactDirectoryNames = new Set([".wrangler", "build", "coverage", "dist"]);
const forbiddenInternalPackages = new Set([
  "@internal/cache",
  "@internal/compute",
  "@internal/metrics-pipeline",
  "@internal/redis",
  "@internal/run-engine",
  "@internal/run-ops-database",
  "@internal/run-store",
  "@internal/testcontainers",
  "@internal/tracing",
  "supervisor",
]);

if (isCliEntrypoint()) {
  const report = analyzeTriggerCompatibilityBoundary(
    discoverWorkspaceManifests(),
    discoverWorkspaceSources(),
  );

  if (report.errors.length > 0) {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Trigger compatibility boundary check passed.");
  }
}

/**
 * @param {{ relativePath: string; manifest: unknown }[]} manifests
 * @param {{ relativePath: string; text: string }[]} sources
 */
export function analyzeTriggerCompatibilityBoundary(manifests, sources) {
  /** @type {string[]} */
  const errors = [];

  for (const { relativePath, manifest } of manifests) {
    if (!isRecord(manifest)) {
      errors.push(`${relativePath}: package manifest must be an object.`);
      continue;
    }

    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      if (!isRecord(dependencies)) continue;

      for (const [name, value] of Object.entries(dependencies)) {
        if (isForbiddenModuleSpecifier(name) || (typeof value === "string" && isForbiddenDependencyReference(value))) {
          errors.push(`${relativePath}: ${field} must not reference Trigger compatibility dependency "${name}".`);
        }
      }
    }
  }

  for (const { relativePath, text } of sources) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(relativePath),
    );

    visit(sourceFile);

    /** @param {ts.Node} node */
    function visit(node) {
      const specifier = moduleSpecifierForNode(node);
      if (specifier !== undefined && isForbiddenModuleSpecifier(specifier)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} must not import Trigger compatibility module "${specifier}".`);
      }
      ts.forEachChild(node, visit);
    }
  }

  return { errors };
}

/** @returns {{ relativePath: string; manifest: unknown }[]} */
export function discoverWorkspaceManifests() {
  return [repoRoot, ...discoverWorkspaceDirectories()].map((directory) => {
    const manifestPath = path.join(directory, "package.json");
    return {
      relativePath: normalizePath(path.relative(repoRoot, manifestPath)),
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    };
  });
}

/** @returns {{ relativePath: string; text: string }[]} */
export function discoverWorkspaceSources() {
  const sourceRoots = [
    ...discoverWorkspaceDirectories(),
    path.join(repoRoot, "integration"),
    path.join(repoRoot, "scripts"),
  ].filter(existsSync);

  return sourceRoots.flatMap((directory) => {
    return collectFiles(directory).map((file) => ({
      relativePath: normalizePath(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    }));
  });
}

/** @returns {string[]} */
function discoverWorkspaceDirectories() {
  return ["apps", "packages"].flatMap((workspaceRoot) => {
    const absoluteRoot = path.join(repoRoot, workspaceRoot);
    return readdirSync(absoluteRoot)
      .map((entry) => path.join(absoluteRoot, entry))
      .filter((entry) => lstatSync(entry).isDirectory() && existsSync(path.join(entry, "package.json")));
  });
}

/**
 * @param {string} directory
 * @param {string} [sourceRoot]
 * @returns {string[]}
 */
export function collectFiles(directory, sourceRoot = directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const stats = lstatSync(absolutePath);
    if (stats.isDirectory()) {
      if (
        ignoredDirectoryNames.has(entry)
        || (directory === sourceRoot && rootArtifactDirectoryNames.has(entry))
      ) {
        return [];
      }
      return collectFiles(absolutePath, sourceRoot);
    }
    if (stats.isFile() && sourceExtensions.has(path.extname(absolutePath))) return [absolutePath];
    return [];
  });
}

/** @param {ts.Node} node */
function moduleSpecifierForNode(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0 || !ts.isStringLiteralLike(node.arguments[0])) {
    return undefined;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
    return node.arguments[0].text;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const owner = node.expression.expression;
    if ((ts.isIdentifier(owner) && owner.text === "module" && node.expression.name.text === "require") || (ts.isIdentifier(owner) && owner.text === "require" && node.expression.name.text === "resolve")) {
      return node.arguments[0].text;
    }
  }
  return undefined;
}

/** @param {string} specifier */
function isForbiddenModuleSpecifier(specifier) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  return normalized === "@trigger.dev" || normalized.startsWith("@trigger.dev/") || [...forbiddenInternalPackages].some((name) => normalized === name || normalized.startsWith(`${name}/`)) || normalized.includes("third_party/trigger.dev");
}

/** @param {string} reference */
function isForbiddenDependencyReference(reference) {
  const normalized = reference.replaceAll("\\", "/");
  const filePath = normalized.startsWith("file:") ? normalized.slice(5) : normalized;
  if (path.posix.normalize(filePath).includes("third_party/trigger.dev")) return true;

  let target = normalized;
  while (target.startsWith("npm:") || target.startsWith("workspace:")) {
    target = target.slice(target.indexOf(":") + 1);
  }

  return target === "@trigger.dev" || target.startsWith("@trigger.dev/") || [...forbiddenInternalPackages].some((name) => target === name || target.startsWith(`${name}@`) || target.startsWith(`${name}/`));
}

/** @param {string} file */
function scriptKindForPath(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} value */
function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
