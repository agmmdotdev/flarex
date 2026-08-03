#!/usr/bin/env node
// @ts-check
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const repoRoot = process.cwd();
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const durableTaskManifestPath = "packages/durable-task/package.json";
const durableTaskSourcePrefix = "packages/durable-task/";
const durableTaskAllowedExport = "./internal/run-attempt-v1";
const expectedTargetPackage = "@flarex/durable-task";
const forbiddenDurableTaskPackages = new Set([
  "@prisma/client",
  "@redis/client",
  "@kubernetes/client-node",
  "bullmq",
  "dockerode",
  "ioredis",
  "prisma",
  "redis",
  "redlock",
]);
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
        if (
          relativePath !== durableTaskManifestPath
          && (isDurableTaskPackageSpecifier(name)
            || (typeof value === "string" && isDurableTaskDependencyReference(value, relativePath)))
        ) {
          errors.push(`${relativePath}: ${field} must not activate @flarex/durable-task before host admission.`);
        }
      }
    }

    if (relativePath === durableTaskManifestPath) {
      errors.push(...analyzeDurableTaskManifest(manifest));
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
      if (
        specifier !== undefined
        && relativePath.startsWith(durableTaskSourcePrefix)
        && isProductionSource(relativePath)
        && !isForbiddenModuleSpecifier(specifier)
        && !isDurableTaskCompatibilityHarnessSpecifier(specifier, relativePath)
        && !isAllowedDurableTaskProductionSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} must not import non-portable durable-task module "${specifier}".`);
      }
      if (relativePath.startsWith(durableTaskSourcePrefix) && isProductionSource(relativePath)) {
        const prohibitedGlobal = prohibitedDurableTaskGlobalForNode(node);
        if (prohibitedGlobal !== undefined) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          errors.push(`${relativePath}:${line} must not use prohibited durable-task global "${prohibitedGlobal}".`);
        }
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isDurableTaskCompatibilityHarnessSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} production source must not import durable-task compatibility harness "${specifier}".`);
      }
      if (
        specifier !== undefined
        && !relativePath.startsWith(durableTaskSourcePrefix)
        && isProductionSource(relativePath)
        && isDurableTaskProductionSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate @flarex/durable-task before host admission.`);
      }
      ts.forEachChild(node, visit);
    }
  }

  return { errors };
}

/** @param {Readonly<Record<string, unknown>>} manifest */
export function analyzeDurableTaskManifest(manifest) {
  /** @type {string[]} */
  const errors = [];
  if (manifest.name !== expectedTargetPackage) {
    errors.push(`${durableTaskManifestPath}: name must be ${expectedTargetPackage}.`);
  }
  if (manifest.version !== "0.0.1") {
    errors.push(`${durableTaskManifestPath}: version must be 0.0.1 during the private vertical.`);
  }
  if (manifest.private !== true) {
    errors.push(`${durableTaskManifestPath}: private must remain true during the private vertical.`);
  }
  if (manifest.type !== "module") {
    errors.push(`${durableTaskManifestPath}: type must be module.`);
  }

  const exportsField = manifest.exports;
  if (
    !isRecord(exportsField)
    || Object.keys(exportsField).length !== 1
    || exportsField[durableTaskAllowedExport] !== "./src/runAttempt/v1.ts"
  ) {
    errors.push(`${durableTaskManifestPath}: exports must contain only ${durableTaskAllowedExport}.`);
  }

  const dependencies = manifest.dependencies;
  if (
    !isRecord(dependencies)
    || Object.keys(dependencies).length !== 1
    || dependencies.effect !== "catalog:"
  ) {
    errors.push(`${durableTaskManifestPath}: runtime dependencies must contain only root-catalog effect.`);
  }

  for (const field of ["optionalDependencies", "peerDependencies"]) {
    const values = manifest[field];
    if (values !== undefined && (!isRecord(values) || Object.keys(values).length > 0)) {
      errors.push(`${durableTaskManifestPath}: ${field} must be absent or empty.`);
    }
  }

  for (const field of dependencyFields) {
    const values = manifest[field];
    if (!isRecord(values)) continue;
    for (const [name, value] of Object.entries(values)) {
      if (
        isForbiddenDurableTaskPackage(name)
        || (typeof value === "string" && isForbiddenDurableTaskDependencyReference(value))
      ) {
        errors.push(`${durableTaskManifestPath}: ${field} must not contain non-portable dependency "${name}".`);
      }
    }
  }

  const files = manifest.files;
  const expectedFiles = ["src", "THIRD_PARTY_NOTICES.md", "trigger-source-map.json", "licenses"];
  if (!Array.isArray(files) || JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    errors.push(`${durableTaskManifestPath}: files must exactly match the admitted distribution list.`);
  }
  return errors;
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

/** @param {string} specifier @param {string} relativePath */
function isAllowedDurableTaskProductionSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  if (normalized === "effect" || normalized.startsWith("effect/")) return true;
  return specifier.replaceAll("\\", "/").startsWith(".")
    && resolved.startsWith("packages/durable-task/src/")
    && !resolved.includes("/generated/prisma")
    && !resolved.includes("/.prisma/client");
}

/** @param {string} packageName */
function isForbiddenDurableTaskPackage(packageName) {
  return forbiddenDurableTaskPackages.has(packageName)
    || packageName.startsWith("@prisma/adapter-");
}

/** @param {string} reference */
function isForbiddenDurableTaskDependencyReference(reference) {
  const packageName = packageNameFromDependencyReference(reference);
  return packageName !== undefined && isForbiddenDurableTaskPackage(packageName);
}

/** @param {string} reference @param {string} manifestPath */
function isDurableTaskDependencyReference(reference, manifestPath) {
  if (packageNameFromDependencyReference(reference) === expectedTargetPackage) return true;
  let target = reference.replaceAll("\\", "/");
  while (target.startsWith("workspace:")) target = target.slice("workspace:".length);
  let localPathReference = false;
  if (target.startsWith("file:")) {
    localPathReference = true;
    target = target.slice("file:".length);
  } else if (target.startsWith("link:")) {
    localPathReference = true;
    target = target.slice("link:".length);
  }
  localPathReference ||= target.startsWith(".")
    || target.startsWith("/")
    || /^[A-Za-z]:\//.test(target)
    || target.toLowerCase().startsWith("packages/");
  if (!localPathReference) return false;
  const resolved = target.startsWith(".")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(manifestPath), target))
    : path.posix.normalize(target);
  const comparable = resolved.toLowerCase();
  return comparable === "packages/durable-task"
    || comparable.startsWith("packages/durable-task/")
    || comparable.endsWith("/packages/durable-task")
    || comparable.includes("/packages/durable-task/");
}

/** @param {string} reference */
function packageNameFromDependencyReference(reference) {
  let target = reference.replaceAll("\\", "/");
  while (target.startsWith("npm:") || target.startsWith("workspace:")) {
    target = target.slice(target.indexOf(":") + 1);
  }
  if (target.startsWith("file:") || target.startsWith("link:") || target.startsWith(".")) {
    return undefined;
  }
  if (target.startsWith("@")) {
    const slash = target.indexOf("/");
    if (slash < 0) return target;
    const version = target.indexOf("@", slash + 1);
    return version < 0 ? target : target.slice(0, version);
  }
  const version = target.indexOf("@");
  const slash = target.indexOf("/");
  const end = [version, slash].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  return end === undefined ? target : target.slice(0, end);
}

/** @param {string} relativePath */
function isProductionSource(relativePath) {
  if (!relativePath.startsWith("apps/") && !relativePath.startsWith("packages/")) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) return false;
  if (relativePath.includes("/src/")) return true;
  return !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(relativePath);
}

/** @param {string} specifier @param {string} relativePath */
function isDurableTaskCompatibilityHarnessSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return resolved.includes("integration/durable-task-compatibility")
    || resolved.includes("durable-task-compatibility/")
    || resolved.includes("packages/durable-task/test/compatibility");
}

/** @param {string} specifier @param {string} relativePath */
function isDurableTaskProductionSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return isDurableTaskPackageSpecifier(normalized)
    || resolved === "packages/durable-task"
    || resolved.startsWith("packages/durable-task/");
}

/** @param {string} specifier */
function isDurableTaskPackageSpecifier(specifier) {
  return specifier === expectedTargetPackage || specifier.startsWith(`${expectedTargetPackage}/`);
}

/** @param {string} specifier @param {string} relativePath */
function resolveRepositorySpecifier(specifier, relativePath) {
  const portable = specifier.replaceAll("\\", "/");
  if (!portable.startsWith(".")) return path.posix.normalize(portable);
  return path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), portable));
}

/** @param {ts.Node} node */
function prohibitedDurableTaskGlobalForNode(node) {
  const memberPath = normalizedGlobalMemberPath(node);
  if (memberPath?.length === 2 && memberPath[0] === "Date" && memberPath[1] === "now") {
    return "Date.now";
  }
  if (memberPath?.length === 2 && memberPath[0] === "Math" && memberPath[1] === "random") {
    return "Math.random";
  }
  if (
    memberPath?.length === 1
    && memberPath[0] === "process"
    && isProcessReferenceNode(node)
  ) return "process";

  if (
    (ts.isNewExpression(node) || ts.isCallExpression(node))
    && isExactGlobalMember(node.expression, "Date")
    && (node.arguments === undefined || node.arguments.length === 0)
  ) {
    return ts.isNewExpression(node) ? "new Date()" : "Date()";
  }
  if (
    ts.isVariableDeclaration(node)
    && ts.isObjectBindingPattern(node.name)
    && node.initializer !== undefined
  ) {
    if (isExactGlobalMember(node.initializer, "Date") && bindingPatternSelects(node.name, "now")) {
      return "Date.now";
    }
    if (isExactGlobalMember(node.initializer, "Math") && bindingPatternSelects(node.name, "random")) {
      return "Math.random";
    }
  }
  return undefined;
}

/** @param {ts.Node} node @returns {string[] | undefined} */
function normalizedGlobalMemberPath(node) {
  const members = staticMemberPath(node);
  return members?.[0] === "globalThis" ? members.slice(1) : members;
}

/** @param {ts.Node} node @returns {string[] | undefined} */
function staticMemberPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const owner = staticMemberPath(node.expression);
    return owner === undefined ? undefined : [...owner, node.name.text];
  }
  if (
    ts.isElementAccessExpression(node)
    && node.argumentExpression !== undefined
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    const owner = staticMemberPath(node.expression);
    return owner === undefined ? undefined : [...owner, node.argumentExpression.text];
  }
  return undefined;
}

/** @param {ts.Node} node @param {string} member */
function isExactGlobalMember(node, member) {
  const path = normalizedGlobalMemberPath(node);
  return path?.length === 1 && path[0] === member;
}

/** @param {ts.Node} node */
function isProcessReferenceNode(node) {
  if (!ts.isIdentifier(node)) return true;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) return false;
  if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false;
  return true;
}

/** @param {ts.ObjectBindingPattern} pattern @param {string} member */
function bindingPatternSelects(pattern, member) {
  return pattern.elements.some((element) => {
    if (element.propertyName !== undefined) {
      return (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        && element.propertyName.text === member;
    }
    return ts.isIdentifier(element.name) && element.name.text === member;
  });
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
