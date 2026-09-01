#!/usr/bin/env node
// @ts-check
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const islandPrefix = "third_party/medusa/upstream/";

/**
 * @typedef {{ readonly relativePath: string, readonly manifest: Readonly<Record<string, unknown>> }} ManifestInput
 * @typedef {{ readonly relativePath: string, readonly text: string }} SourceInput
 * @typedef {{ readonly relativePath: string, readonly target: string }} SymlinkInput
 * @typedef {{
 *   readonly rootManifests: readonly ManifestInput[],
 *   readonly rootSources: readonly SourceInput[],
 *   readonly rootConfigs?: readonly SourceInput[],
 *   readonly rootSymlinks?: readonly SymlinkInput[],
 *   readonly rootToolSources?: readonly SourceInput[],
 *   readonly islandManifests: readonly ManifestInput[],
 *   readonly islandSources: readonly SourceInput[],
 *   readonly islandConfigs?: readonly SourceInput[],
 *   readonly islandSymlinks?: readonly SymlinkInput[],
 *   readonly islandWorkspaceText?: string,
 *   readonly rootWorkspaceText: string,
 *   readonly rootScripts: Readonly<Record<string, unknown>>,
 * }} BoundaryInput
 */

/** @param {BoundaryInput} input */
export function analyzeMedusaSourceIslandBoundary(input) {
  /** @type {string[]} */
  const errors = [];
  const rootPackageNames = new Set(input.rootManifests.flatMap(({ manifest }) =>
    typeof manifest.name === "string" ? [manifest.name] : []
  ));

  if (workspaceIncludesIsland(input.rootWorkspaceText)) {
    errors.push(
      "pnpm-workspace.yaml must not include the Medusa source island.",
    );
  }
  if (
    workspaceConfigReferences(
      input.rootWorkspaceText,
      (value) =>
        isMedusaPackage(value)
        || normalized(value).includes("@medusajs/")
        || referencesIsland(value)
        || escapesIntoIsland(value, "pnpm-workspace.yaml"),
    )
  ) {
    errors.push(
      "pnpm-workspace.yaml must not resolve Medusa or the Medusa source island.",
    );
  }
  if (
    input.islandWorkspaceText !== undefined
    && islandWorkspaceEscapes(input.islandWorkspaceText)
  ) {
    errors.push(
      "third_party/medusa/upstream/pnpm-workspace.yaml must not include paths outside the Medusa source island.",
    );
  }
  if (
    input.islandWorkspaceText !== undefined
    && workspaceConfigReferences(
      input.islandWorkspaceText,
      (value) =>
        isRootPackageSpecifier(value, rootPackageNames)
        || escapesIsland(
          value,
          "third_party/medusa/upstream/pnpm-workspace.yaml",
        ),
    )
  ) {
    errors.push(
      "third_party/medusa/upstream/pnpm-workspace.yaml must not resolve Flarex or escape the Medusa source island.",
    );
  }

  for (const [name, value] of Object.entries(input.rootScripts)) {
    if (
      !name.startsWith("medusa:")
      && typeof value === "string"
      && (referencesIsland(value) || referencesMedusaCommand(value))
    ) {
      errors.push(
        `package.json: non-Medusa script "${name}" must not enter the Medusa source island.`,
      );
    }
  }
  for (const { relativePath, manifest } of input.rootManifests) {
    if (relativePath === "package.json" || !isRecord(manifest.scripts)) continue;
    for (const [name, value] of Object.entries(manifest.scripts)) {
      if (
        typeof value === "string"
        && (referencesIsland(value) || referencesMedusaCommand(value))
      ) {
        errors.push(
          `${relativePath}: root-workspace script "${name}" must not enter the Medusa source island.`,
        );
      }
    }
  }
  for (const { relativePath, manifest } of input.islandManifests) {
    if (!isRecord(manifest.scripts)) continue;
    for (const [name, value] of Object.entries(manifest.scripts)) {
      if (
        typeof value === "string"
        && islandScriptEscapes(value, relativePath, rootPackageNames)
      ) {
        errors.push(
          `${relativePath}: Medusa script "${name}" must not enter the Flarex root workspace.`,
        );
      }
    }
  }

  analyzeManifests(
    input.rootManifests,
    errors,
    isForbiddenRootDependency,
    "must not reference Medusa source-island dependency",
    escapesIntoIsland,
    "must not use a path dependency into the Medusa source island",
  );
  analyzeManifests(
    input.islandManifests,
    errors,
    (name, value) =>
      isForbiddenIslandDependency(name, value, rootPackageNames),
    "must not reference Flarex dependency",
    escapesIsland,
    "must not use a path dependency outside the Medusa source island",
  );
  analyzeManifestReferences(
    input.rootManifests,
    errors,
    (value, relativePath) =>
      isForbiddenRootSpecifier(value, relativePath),
    "must not alias the Medusa source island",
  );
  analyzeManifestReferences(
    input.islandManifests,
    errors,
    (value, relativePath) =>
      isForbiddenIslandSpecifier(value, relativePath, rootPackageNames),
    "must not alias Flarex or escape the Medusa source island",
  );
  analyzeResolverReferences(
    input.rootManifests,
    errors,
    (value, relativePath) =>
      isMedusaPackage(value)
      || normalized(value).includes("@medusajs/")
      || referencesIsland(value)
      || escapesIntoIsland(value, relativePath),
    "must not resolve Medusa or the Medusa source island",
  );
  analyzeResolverReferences(
    input.islandManifests,
    errors,
    (value, relativePath) =>
      isRootPackageSpecifier(value, rootPackageNames)
      || escapesIsland(value, relativePath),
    "must not resolve Flarex or escape the Medusa source island",
  );

  analyzeSources(input.rootSources, errors, (specifier, relativePath) => {
    if (isForbiddenRootSpecifier(specifier, relativePath)) {
      return `must not import Medusa source-island module "${specifier}"`;
    }
    return undefined;
  });
  analyzeRootSourceAliases(input.rootSources, errors);
  for (const toolSource of input.rootToolSources ?? []) {
    if (
      referencesIsland(toolSource.text)
      || normalized(toolSource.text).includes("@medusajs/")
      || referencesMedusaCommand(toolSource.text)
    ) {
      errors.push(
        `${toolSource.relativePath}: root tooling must not enter the Medusa source island.`,
      );
    }
  }

  for (const config of input.rootConfigs ?? []) {
    if (referencesIsland(config.text)) {
      errors.push(
        `${config.relativePath}: configuration must not alias the Medusa source island.`,
      );
    }
  }

  for (const symlink of input.rootSymlinks ?? []) {
    if (rootSymlinkEntersIsland(symlink)) {
      errors.push(
        `${symlink.relativePath}: symlink must not target the Medusa source island.`,
      );
    }
  }
  for (const config of input.islandConfigs ?? []) {
    if (islandConfigEscapes(config, rootPackageNames)) {
      errors.push(
        `${config.relativePath}: configuration must not alias Flarex or escape the Medusa source island.`,
      );
    }
  }
  for (const symlink of input.islandSymlinks ?? []) {
    if (islandSymlinkEscapes(symlink)) {
      errors.push(
        `${symlink.relativePath}: symlink must not escape the Medusa source island.`,
      );
    }
  }
  analyzeSources(input.islandSources, errors, (specifier, relativePath) => {
    if (isForbiddenIslandSpecifier(specifier, relativePath, rootPackageNames)) {
      return `must not import Flarex or escape the Medusa source island through "${specifier}"`;
    }
    return undefined;
  });

  return { errors };
}

/** @param {string} repoRoot */
export function discoverRootManifests(repoRoot) {
  /** @type {ManifestInput[]} */
  const manifests = [{
    relativePath: "package.json",
    manifest: readJsonRecord(path.join(repoRoot, "package.json")),
  }];
  for (const workspaceDirectory of ["packages", "apps"]) {
    const absoluteDirectory = path.join(repoRoot, workspaceDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(absoluteDirectory, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      manifests.push({
        relativePath: normalized(path.relative(repoRoot, manifestPath)),
        manifest: readJsonRecord(manifestPath),
      });
    }
  }
  return manifests;
}

/** @param {string} repoRoot */
export function discoverRootSources(repoRoot) {
  return ["packages", "apps"].flatMap((directory) =>
    collectSources(path.join(repoRoot, directory), repoRoot)
  );
}

/** @param {string} repoRoot */
export function discoverRootConfigs(repoRoot) {
  const rootConfigs = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/.test(entry.name)
    )
    .map((entry) => {
      const file = path.join(repoRoot, entry.name);
      return {
        relativePath: entry.name,
        text: readFileSync(file, "utf8"),
      };
    });
  return rootConfigs.concat(["packages", "apps"].flatMap((directory) =>
    collectFiles(path.join(repoRoot, directory), (file) =>
      /^tsconfig(?:\.[^.]+)?\.json$/.test(path.basename(file))
    ).map((file) => ({
      relativePath: normalized(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    }))
  ));
}

/** @param {string} repoRoot */
export function discoverRootToolSources(repoRoot) {
  const excluded = new Set([
    "scripts/check-medusa-source-island-boundary.mjs",
    "scripts/check-medusa-source-island-boundary.test.js",
  ]);
  const toolingFiles = ["scripts", "tools", "integration"].flatMap((directory) =>
    collectFiles(path.join(repoRoot, directory), (file) =>
      isRootToolingTextFile(file)
    )
  );
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (
      entry.isFile()
      && (
        sourceExtensions.has(path.extname(entry.name))
        || entry.name === "test-lanes.json"
      )
    ) {
      toolingFiles.push(path.join(repoRoot, entry.name));
    }
  }
  return toolingFiles
    .map((file) => ({
      relativePath: normalized(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    }))
    .filter(({ relativePath }) => !excluded.has(relativePath));
}

/** @param {string} file */
function isRootToolingTextFile(file) {
  return sourceExtensions.has(path.extname(file))
    || [".json", ".jsonc", ".yaml", ".yml", ".toml", ".sh", ".ps1"]
      .includes(path.extname(file));
}

/** @param {string} repoRoot */
export function discoverRootSymlinks(repoRoot) {
  const symlinks = ["packages", "apps", "scripts", "tools", "integration"]
    .flatMap((directory) =>
    collectSymlinks(path.join(repoRoot, directory), repoRoot)
  );
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const absolutePath = path.join(repoRoot, entry.name);
    symlinks.push({
      relativePath: normalized(entry.name),
      target: normalized(readlinkSync(absolutePath)),
    });
  }
  return symlinks.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

/** @param {string} repoRoot */
export function discoverIslandManifests(repoRoot) {
  const upstreamRoot = path.join(repoRoot, "third_party", "medusa", "upstream");
  return admittedIslandPaths(repoRoot)
    .filter((relativePath) => path.posix.basename(relativePath) === "package.json")
    .map((relativePath) => {
      const file = path.join(upstreamRoot, ...relativePath.split("/"));
      return {
      relativePath: normalized(path.relative(repoRoot, file)),
      manifest: readJsonRecord(file),
      };
    });
}

/** @param {string} repoRoot */
export function discoverIslandSources(repoRoot) {
  const upstreamRoot = path.join(repoRoot, "third_party", "medusa", "upstream");
  return admittedIslandPaths(repoRoot)
    .filter((relativePath) => sourceExtensions.has(path.posix.extname(relativePath)))
    .map((relativePath) => {
      const file = path.join(upstreamRoot, ...relativePath.split("/"));
      return {
        relativePath: normalized(path.relative(repoRoot, file)),
        text: readFileSync(file, "utf8"),
      };
    });
}

/** @param {string} repoRoot */
export function discoverIslandConfigs(repoRoot) {
  const upstreamRoot = path.join(repoRoot, "third_party", "medusa", "upstream");
  return admittedIslandPaths(repoRoot)
    .filter((relativePath) =>
      /^tsconfig(?:\.[^.]+)?\.json$/.test(path.posix.basename(relativePath))
    )
    .map((relativePath) => {
      const file = path.join(upstreamRoot, ...relativePath.split("/"));
      return {
        relativePath: normalized(path.relative(repoRoot, file)),
        text: readFileSync(file, "utf8"),
      };
    });
}

/** @param {string} repoRoot */
export function discoverIslandSymlinks(repoRoot) {
  const metadata = readJsonRecord(
    path.join(repoRoot, "third_party", "medusa", "SOURCE.json"),
  );
  const symlinks = metadata.symlinks;
  if (!isRecord(symlinks)) {
    throw new Error("third_party/medusa/SOURCE.json.symlinks must be an object.");
  }
  return Object.entries(symlinks).map(([relativePath, target]) => {
    if (typeof target !== "string") {
      throw new Error(`Invalid Medusa source-island symlink target: ${relativePath}`);
    }
    return {
      relativePath: `third_party/medusa/${normalized(relativePath)}`,
      target: normalized(target),
    };
  });
}

/** @param {string} repoRoot */
function admittedIslandPaths(repoRoot) {
  const manifest = readFileSync(
    path.join(repoRoot, "third_party", "medusa", "SOURCE_SHA256SUMS"),
    "utf8",
  );
  return manifest.split(/\r?\n/).filter(Boolean).map((line) => {
    if (line.length < 67 || line.slice(64, 66) !== "  ") {
      throw new Error(`Invalid Medusa source-manifest entry: ${line}`);
    }
    const relativePath = normalized(line.slice(66));
    if (!relativePath.startsWith("upstream/")) {
      throw new Error(`Medusa source-manifest path must start with upstream/: ${relativePath}`);
    }
    return relativePath.slice("upstream/".length);
  });
}

/**
 * @param {readonly ManifestInput[]} manifests
 * @param {string[]} errors
 * @param {(name: string, value: string) => boolean} forbiddenDependency
 * @param {string} dependencyMessage
 * @param {(value: string, relativePath: string) => boolean} forbiddenPath
 * @param {string} pathMessage
 */
function analyzeManifests(
  manifests,
  errors,
  forbiddenDependency,
  dependencyMessage,
  forbiddenPath,
  pathMessage,
) {
  for (const { relativePath, manifest } of manifests) {
    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      if (!isRecord(dependencies)) continue;
      for (const [name, value] of Object.entries(dependencies)) {
        if (typeof value !== "string") continue;
        if (forbiddenDependency(name, value)) {
          errors.push(
            `${relativePath}: ${field} ${dependencyMessage} "${name}".`,
          );
        } else if (forbiddenPath(value, relativePath)) {
          errors.push(
            `${relativePath}: ${field} ${pathMessage} "${name}".`,
          );
        }
      }
    }
  }
}

const manifestReferenceFields = [
  "imports",
  "exports",
  "browser",
  "main",
  "module",
  "types",
  "typings",
  "bin",
];
const resolverFields = ["pnpm", "resolutions", "overrides"];

/**
 * @param {readonly ManifestInput[]} manifests
 * @param {string[]} errors
 * @param {(value: string, relativePath: string) => boolean} forbidden
 * @param {string} message
 */
function analyzeManifestReferences(manifests, errors, forbidden, message) {
  for (const { relativePath, manifest } of manifests) {
    for (const field of manifestReferenceFields) {
      for (const value of nestedStrings(manifest[field])) {
        if (forbidden(value, relativePath)) {
          errors.push(`${relativePath}: ${field} ${message} through "${value}".`);
        }
      }
    }
  }
}

/**
 * @param {readonly ManifestInput[]} manifests
 * @param {string[]} errors
 * @param {(value: string, relativePath: string) => boolean} forbidden
 * @param {string} message
 */
function analyzeResolverReferences(manifests, errors, forbidden, message) {
  for (const { relativePath, manifest } of manifests) {
    for (const field of resolverFields) {
      if (
        nestedKeysAndStrings(manifest[field]).some((value) =>
          forbidden(value, relativePath)
        )
      ) {
        errors.push(`${relativePath}: ${field} ${message}.`);
      }
    }
  }
}

/** @param {unknown} value @returns {string[]} */
function nestedStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (isRecord(value)) return Object.values(value).flatMap(nestedStrings);
  return [];
}

/** @param {unknown} value @returns {string[]} */
function nestedKeysAndStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedKeysAndStrings);
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, member]) =>
      [key, ...nestedKeysAndStrings(member)]
    );
  }
  return [];
}

/**
 * @param {readonly SourceInput[]} sources
 * @param {string[]} errors
 * @param {(specifier: string, relativePath: string) => string | undefined} classify
 */
function analyzeSources(sources, errors, classify) {
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.relativePath,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(source.relativePath),
    );
    const reported = new Set();
    visit(sourceFile);
    const preprocessed = ts.preProcessFile(source.text, true, true);
    for (const reference of [
      ...preprocessed.referencedFiles,
      ...preprocessed.typeReferenceDirectives,
      ...preprocessed.libReferenceDirectives,
      ...preprocessed.importedFiles,
    ]) {
      report(reference.fileName, reference.pos);
    }
    for (const comment of source.text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
      const commentStart = comment.index;
      if (commentStart === undefined) continue;
      for (const reference of comment[0].matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)) {
        if (reference.index !== undefined && reference[2] !== undefined) {
          report(reference[2], commentStart + reference.index);
        }
      }
      for (const reference of comment[0].matchAll(/@import[^\r\n]*?\bfrom\s*(["'])([^"']+)\1/g)) {
        if (reference.index !== undefined && reference[2] !== undefined) {
          report(reference[2], commentStart + reference.index);
        }
      }
    }

    /** @param {ts.Node} node */
    function visit(node) {
      const specifier = moduleSpecifierForNode(node);
      if (specifier !== undefined) {
        report(specifier, node.getStart(sourceFile));
      }
      ts.forEachChild(node, visit);
    }

    /** @param {string} specifier @param {number} position */
    function report(specifier, position) {
      const message = classify(specifier, source.relativePath);
      if (message === undefined) return;
      const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1;
      const key = `${line}\0${specifier}`;
      if (reported.has(key)) return;
      reported.add(key);
      errors.push(`${source.relativePath}:${line} ${message}.`);
    }
  }
}

/** @param {readonly SourceInput[]} sources @param {string[]} errors */
function analyzeRootSourceAliases(sources, errors) {
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.relativePath,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(source.relativePath),
    );
    visit(sourceFile);

    /** @param {ts.Node} node */
    function visit(node) {
      if (
        ts.isStringLiteralLike(node)
        && referencesIsland(node.text)
        && (node.parent === undefined
          || moduleSpecifierForNode(node.parent) !== node.text)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(
          `${source.relativePath}:${line} must not alias the Medusa source island.`,
        );
      }
      ts.forEachChild(node, visit);
    }
  }
}

/** @param {string} name @param {string} value */
function isForbiddenRootDependency(name, value) {
  return isMedusaPackage(name)
    || normalized(value).includes("@medusajs/");
}

/** @param {string} name @param {string} value @param {ReadonlySet<string>} rootPackageNames */
function isForbiddenIslandDependency(name, value, rootPackageNames) {
  return isRootPackageSpecifier(name, rootPackageNames)
    || [...rootPackageNames].some((rootName) =>
      isRootPackageSpecifier(normalized(value), new Set([rootName]))
    );
}

/** @param {string} value @param {string} relativePath */
function escapesIntoIsland(value, relativePath) {
  const target = pathDependencyTarget(value);
  if (target === undefined) return false;
  if (isPortableAbsolutePath(target)) return referencesIsland(target);
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), target),
  );
  return isMedusaIslandPath(resolved);
}

/** @param {string} value @param {string} relativePath */
function escapesIsland(value, relativePath) {
  const target = pathDependencyTarget(value);
  if (target === undefined) return false;
  if (isPortableAbsolutePath(target)) return true;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), target),
  );
  return !isMedusaUpstreamPath(resolved);
}

/** @param {string} value */
function pathDependencyTarget(value) {
  const portable = normalized(value);
  for (const prefix of ["file:", "link:"]) {
    if (portable.startsWith(prefix)) return portable.slice(prefix.length);
  }
  if (portable.startsWith("workspace:")) {
    const target = portable.slice("workspace:".length);
    if (
      target.startsWith(".")
      || target.startsWith("/")
      || /^[A-Za-z]:\//.test(target)
    ) {
      return target;
    }
  }
  return undefined;
}

/** @param {string} text */
function referencesIsland(text) {
  return normalized(text).toLowerCase().includes("third_party/medusa");
}

/** @param {string} text */
function referencesMedusaCommand(text) {
  return /(?:^|[\s"';&|])medusa:[A-Za-z0-9:_-]+/.test(text);
}

/** @param {string} text @param {string} relativePath @param {ReadonlySet<string>} rootPackageNames */
function islandScriptEscapes(text, relativePath, rootPackageNames) {
  const portable = normalized(text);
  if (
    isFlarexPackage(portable)
    || [...rootPackageNames].some((name) => portable.includes(name))
    || portable.includes("@flarex/")
  ) {
    return true;
  }
  return portable.split(/[\s"';&|()]+/).some((token) =>
    token.length > 0
    && (
      token.startsWith(".")
      || /^[A-Za-z]:\//.test(token)
      || (token.startsWith("/") && /\/(?:packages|apps)\//.test(token))
    )
    && isForbiddenIslandSpecifier(token, relativePath, rootPackageNames)
  );
}

/** @param {SymlinkInput} symlink */
function rootSymlinkEntersIsland(symlink) {
  if (isPortableAbsolutePath(symlink.target)) {
    return referencesIsland(symlink.target);
  }
  const resolved = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(normalized(symlink.relativePath)),
      normalized(symlink.target),
    ),
  );
  return isMedusaIslandPath(resolved);
}

/** @param {SymlinkInput} symlink */
function islandSymlinkEscapes(symlink) {
  if (isPortableAbsolutePath(symlink.target)) return true;
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(normalized(symlink.relativePath)),
    normalized(symlink.target),
  ));
  return !isMedusaUpstreamPath(resolved);
}

/** @param {string} specifier @param {string} relativePath */
function isForbiddenRootSpecifier(specifier, relativePath) {
  const portable = normalized(specifier);
  if (isMedusaPackage(portable) || referencesIsland(portable)) {
    return true;
  }
  if (pathDependencyTarget(portable) !== undefined) {
    return escapesIntoIsland(portable, relativePath);
  }
  if (!portable.startsWith(".")) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), portable),
  );
  return isMedusaIslandPath(resolved);
}

/** @param {string} specifier @param {string} relativePath @param {ReadonlySet<string>} rootPackageNames */
function isForbiddenIslandSpecifier(specifier, relativePath, rootPackageNames) {
  const portable = normalized(specifier);
  if (isRootPackageSpecifier(portable, rootPackageNames)) return true;
  if (pathDependencyTarget(portable) !== undefined) {
    return escapesIsland(portable, relativePath);
  }
  if (isPortableAbsolutePath(portable)) return true;
  if (!portable.startsWith(".")) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), portable),
  );
  return !isMedusaUpstreamPath(resolved);
}

/** @param {string} value */
function isMedusaIslandPath(value) {
  const portable = path.posix.normalize(normalized(value)).toLowerCase();
  return portable === "third_party/medusa"
    || portable.startsWith("third_party/medusa/");
}

/** @param {string} value */
function isMedusaUpstreamPath(value) {
  const portable = path.posix.normalize(normalized(value)).toLowerCase();
  return portable === "third_party/medusa/upstream"
    || portable.startsWith(islandPrefix);
}

/** @param {string} value */
function isMedusaPackage(value) {
  return value === "@medusajs" || value.startsWith("@medusajs/");
}

/** @param {string} value */
function isFlarexPackage(value) {
  return value === "@flarex"
    || value.startsWith("@flarex/")
    || value === "flarex"
    || value.startsWith("flarex/")
    || value === "flarex-protocol"
    || value.startsWith("flarex-protocol/")
    || value === "flarex-backend"
    || value.startsWith("flarex-backend/");
}

/** @param {string} value @param {ReadonlySet<string>} rootPackageNames */
function isRootPackageSpecifier(value, rootPackageNames) {
  if (isFlarexPackage(value)) return true;
  return [...rootPackageNames].some((name) =>
    value === name
      || value.startsWith(`${name}/`)
      || value === `npm:${name}`
      || value.startsWith(`npm:${name}@`)
  );
}

/** @param {string} value */
function isPortableAbsolutePath(value) {
  const portable = normalized(value);
  return portable.startsWith("/") || /^[A-Za-z]:\//.test(portable);
}

/** @param {SourceInput} config @param {ReadonlySet<string>} rootPackageNames */
function islandConfigEscapes(config, rootPackageNames) {
  const parsed = ts.parseConfigFileTextToJson(config.relativePath, config.text);
  if (parsed.error !== undefined || !isRecord(parsed.config)) return true;
  return nestedStrings(parsed.config).some((value) =>
    isForbiddenIslandSpecifier(value, config.relativePath, rootPackageNames)
  );
}

/** @param {string} workspaceText */
function workspaceIncludesIsland(workspaceText) {
  /** @type {string[]} */
  const patterns = [];
  let foundPackages = false;
  let insidePackages = false;
  for (const line of workspaceText.split(/\r?\n/)) {
    const withoutComment = line.split("#", 1)[0] ?? "";
    const content = withoutComment.trim();
    if (content.length === 0) continue;
    const isTopLevel = withoutComment.length === withoutComment.trimStart().length;
    if (isTopLevel) {
      if (content === "packages:") {
        foundPackages = true;
        insidePackages = true;
      } else if (content.startsWith("packages:")) {
        return true;
      } else {
        insidePackages = false;
      }
      continue;
    }
    if (!insidePackages) continue;
    if (!content.startsWith("-")) return true;
    const quotedPattern = content.slice(1).trim();
    patterns.push(normalized(
      /^(["']).*\1$/.test(quotedPattern)
        ? quotedPattern.slice(1, -1)
        : quotedPattern,
    ));
  }
  if (!foundPackages) return true;
  return patterns.length !== 2
    || !patterns.includes("packages/*")
    || !patterns.includes("apps/*");
}

/** @param {string} workspaceText */
function islandWorkspaceEscapes(workspaceText) {
  let foundPackages = false;
  let insidePackages = false;
  let packagePatternCount = 0;
  for (const line of workspaceText.split(/\r?\n/)) {
    const withoutComment = line.split("#", 1)[0] ?? "";
    const content = withoutComment.trim();
    if (content.length === 0) continue;
    const isTopLevel = withoutComment.length === withoutComment.trimStart().length;
    if (isTopLevel) {
      if (content === "packages:") {
        foundPackages = true;
        insidePackages = true;
      } else if (content.startsWith("packages:")) {
        return true;
      } else {
        insidePackages = false;
      }
      continue;
    }
    if (!insidePackages) continue;
    if (!content.startsWith("-")) return true;
    const quotedPattern = content.slice(1).trim();
    const pattern = normalized(
      /^(["']).*\1$/.test(quotedPattern)
        ? quotedPattern.slice(1, -1)
        : quotedPattern,
    );
    packagePatternCount += 1;
    if (pattern.startsWith("!") || isPortableAbsolutePath(pattern)) return true;
    const resolved = path.posix.normalize(
      path.posix.join("third_party/medusa/upstream", pattern),
    );
    if (!isMedusaUpstreamPath(resolved)) return true;
  }
  return !foundPackages || packagePatternCount === 0;
}

/** @param {string} workspaceText @param {(value: string) => boolean} forbidden */
function workspaceConfigReferences(workspaceText, forbidden) {
  let insidePackages = false;
  for (const line of workspaceText.split(/\r?\n/)) {
    const content = line.split("#", 1)[0]?.trim() ?? "";
    if (content.length === 0) continue;
    const isTopLevel = line.length === line.trimStart().length;
    if (isTopLevel) {
      insidePackages = content === "packages:";
      if (insidePackages || content.startsWith("packages:")) continue;
    } else if (insidePackages) {
      continue;
    }
    if (
      /[{}\[\]]/.test(content)
      || /(?:^|[\s:])(?:&|\*)[A-Za-z0-9_-]+/.test(content)
      || /:\s*[|>]\s*$/.test(content)
    ) {
      return true;
    }
    const listValue = content.startsWith("-") ? content.slice(1).trim() : content;
    const colon = listValue.indexOf(":");
    const values = colon < 0
      ? [listValue]
      : [listValue.slice(0, colon), listValue.slice(colon + 1)];
    if (values.some((value) => {
      const unquoted = value.trim().replace(/^["']|["'],?$/g, "");
      return unquoted.length > 0 && forbidden(unquoted);
    })) return true;
  }
  return false;
}

/** @param {ts.Node} node */
function moduleSpecifierForNode(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined
    && ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node)
    && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression !== undefined
    && ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    ts.isImportTypeNode(node)
    && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteralLike(node.argument.literal)
  ) {
    return node.argument.literal.text;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0) {
    return undefined;
  }
  const argument = node.arguments[0];
  if (argument === undefined || !ts.isStringLiteralLike(argument)) {
    return undefined;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return argument.text;
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    return argument.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "require"
    && node.expression.name.text === "resolve"
  ) {
    return argument.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "resolve"
    && ts.isPropertyAccessExpression(node.expression.expression)
    && ts.isIdentifier(node.expression.expression.expression)
    && node.expression.expression.expression.text === "module"
    && node.expression.expression.name.text === "require"
  ) {
    return argument.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "module"
    && node.expression.name.text === "require"
  ) {
    return argument.text;
  }
  return undefined;
}

/** @param {string} directory @param {string} sourceRoot */
function collectSources(directory, sourceRoot) {
  return collectFiles(directory, (file) => sourceExtensions.has(path.extname(file)))
    .map((file) => ({
      relativePath: normalized(path.relative(sourceRoot, file)),
      text: readFileSync(file, "utf8"),
    }));
}

/** @param {string} directory @param {(file: string) => boolean} include */
function collectFiles(directory, include) {
  /** @type {string[]} */
  const files = [];
  walk(directory);
  return files.sort();

  /** @param {string} current */
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && include(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }
}

/** @param {string} directory @param {string} sourceRoot */
function collectSymlinks(directory, sourceRoot) {
  /** @type {SymlinkInput[]} */
  const symlinks = [];
  walk(directory);
  return symlinks.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );

  /** @param {string} current */
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) {
        symlinks.push({
          relativePath: normalized(path.relative(sourceRoot, absolutePath)),
          target: normalized(readlinkSync(absolutePath)),
        });
      } else if (entry.isDirectory()) {
        walk(absolutePath);
      }
    }
  }
}

/** @param {string} file */
function readJsonRecord(file) {
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} file */
function scriptKindForPath(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** @param {string} value */
function normalized(value) {
  return value.replaceAll("\\", "/");
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

/** @param {string} repoRoot */
export function verifyMedusaSourceIslandBoundary(repoRoot) {
  const rootPackage = readJsonRecord(path.join(repoRoot, "package.json"));
  const scripts = isRecord(rootPackage.scripts) ? rootPackage.scripts : {};
  const input = {
    rootManifests: discoverRootManifests(repoRoot),
    rootSources: discoverRootSources(repoRoot),
    rootConfigs: discoverRootConfigs(repoRoot),
    rootSymlinks: discoverRootSymlinks(repoRoot),
    rootToolSources: discoverRootToolSources(repoRoot),
    islandManifests: discoverIslandManifests(repoRoot),
    islandSources: discoverIslandSources(repoRoot),
    islandConfigs: discoverIslandConfigs(repoRoot),
    islandSymlinks: discoverIslandSymlinks(repoRoot),
    islandWorkspaceText: readFileSync(
      path.join(repoRoot, "third_party", "medusa", "upstream", "pnpm-workspace.yaml"),
      "utf8",
    ),
    rootWorkspaceText: readFileSync(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      "utf8",
    ),
    rootScripts: scripts,
  };
  const result = analyzeMedusaSourceIslandBoundary(input);
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("\n"));
  }
  return input;
}

if (isCliEntrypoint()) {
  const repoRoot = process.cwd();
  const input = verifyMedusaSourceIslandBoundary(repoRoot);
  console.log(
    `Verified Medusa source-island boundary across ${input.rootManifests.length} Flarex manifests, ${input.rootSources.length} Flarex sources, ${input.rootConfigs.length} Flarex TypeScript configs, ${input.rootSymlinks.length} Flarex symlinks, ${input.rootToolSources.length} root tooling sources, ${input.islandManifests.length} Medusa manifests, ${input.islandSources.length} Medusa sources, ${input.islandConfigs.length} Medusa TypeScript configs, and ${input.islandSymlinks.length} Medusa symlinks.`,
  );
}
