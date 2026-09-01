#!/usr/bin/env node
// @ts-check
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyMedusaSourceIslandBoundary } from "../../../scripts/check-medusa-source-island-boundary.mjs";

const execFileAsync = promisify(execFile);
const sha256Pattern = /^[a-f0-9]{64}$/;

const islandRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamRoot = resolve(islandRoot, "upstream");
const sourceMetadata = parseJson(
  await readFile(resolve(islandRoot, "SOURCE.json"), "utf8"),
  "SOURCE.json",
);
if (sourceMetadata.schemaVersion !== 1) {
  throw new Error("SOURCE.json.schemaVersion must be 1.");
}
const commit = requiredGitObjectId(sourceMetadata, "commit", "SOURCE.json");
const expectedTree = requiredGitObjectId(sourceMetadata, "tree", "SOURCE.json");
const commitObject = requiredHashedPathRecord(
  sourceMetadata,
  "commitObject",
  "SOURCE.json",
);
if (requiredString(sourceMetadata, "sourceRoot", "SOURCE.json") !== "upstream") {
  throw new Error('SOURCE.json.sourceRoot must be "upstream".');
}
const packageManager = requiredString(
  sourceMetadata,
  "packageManager",
  "SOURCE.json",
);
const packageBaseline = requiredString(
  sourceMetadata,
  "packageBaseline",
  "SOURCE.json",
);
const sourceManifestName = requiredString(
  sourceMetadata,
  "sourceManifest",
  "SOURCE.json",
);
const expectedManifestHash = requiredSha256(
  sourceMetadata,
  "sourceManifestSha256",
  "SOURCE.json",
);
const expectedFileCount = requiredNonNegativeSafeInteger(
  sourceMetadata,
  "sourceFileCount",
  "SOURCE.json",
);
const expectedContentBytes = requiredNonNegativeSafeInteger(
  sourceMetadata,
  "sourceContentBytes",
  "SOURCE.json",
);
const expectedPackageManifestCount = requiredNonNegativeSafeInteger(
  sourceMetadata,
  "sourcePackageManifestCount",
  "SOURCE.json",
);
const executableFiles = new Set(
  requiredStringArray(sourceMetadata, "executableFiles", "SOURCE.json"),
);
const symlinks = requiredStringRecord(
  sourceMetadata,
  "symlinks",
  "SOURCE.json",
);
const patchInventory = requiredHashedPathArray(
  sourceMetadata,
  "patches",
  "SOURCE.json",
);
const licenseInventory = requiredHashedPathArray(
  sourceMetadata,
  "licenseFiles",
  "SOURCE.json",
);
const lockfile = requiredHashedPathRecord(
  sourceMetadata,
  "lockfile",
  "SOURCE.json",
);

if (commitObject.path !== "SOURCE_COMMIT") {
  throw new Error('SOURCE.json.commitObject.path must be "SOURCE_COMMIT".');
}
const commitBytes = await readFile(resolve(islandRoot, commitObject.path));
if (sha256(commitBytes) !== commitObject.sha256) {
  throw new Error("Pinned commit-object checksum does not match SOURCE.json.");
}
if (gitObjectId("commit", commitBytes) !== commit) {
  throw new Error("Pinned commit object does not match SOURCE.json.commit.");
}
const commitTree = /^tree ([a-f0-9]{40})$/m.exec(commitBytes.toString("utf8"))?.[1];
if (commitTree !== expectedTree) {
  throw new Error("Pinned commit object does not reference SOURCE.json.tree.");
}

if (sourceManifestName !== "SOURCE_SHA256SUMS") {
  throw new Error(`Unsupported source manifest: ${sourceManifestName}`);
}

const manifestPath = resolve(islandRoot, sourceManifestName);
const manifestBytes = await readFile(manifestPath);
const actualManifestHash = sha256(manifestBytes);
if (actualManifestHash !== expectedManifestHash) {
  throw new Error("Source manifest checksum does not match SOURCE.json.");
}

const manifest = manifestBytes.toString("utf8");
if (!manifest.endsWith("\n")) {
  throw new Error("Source manifest must end with one newline.");
}
const entries = manifest.split("\n").filter(Boolean);
const expectedChecksums = new Map();
let previousPath;

for (const entry of entries) {
  const separator = entry.indexOf("  ");
  if (separator !== 64) {
    throw new Error(`Invalid source manifest entry: ${entry}`);
  }

  const expected = entry.slice(0, separator);
  const relativePath = entry.slice(separator + 2);
  if (!sha256Pattern.test(expected)) {
    throw new Error(`Invalid source checksum: ${relativePath}`);
  }
  checkedUpstreamPath(relativePath);
  if (expectedChecksums.has(relativePath)) {
    throw new Error(`Duplicate source manifest path: ${relativePath}`);
  }
  if (previousPath !== undefined && previousPath >= relativePath) {
    throw new Error(`Source manifest paths are not canonically ordered: ${relativePath}`);
  }
  previousPath = relativePath;
  expectedChecksums.set(relativePath, expected);
}

const { stdout: repoRootOutput } = await execFileAsync(
  "git",
  ["rev-parse", "--show-toplevel"],
  { cwd: islandRoot, encoding: "utf8" },
);
const repoRoot = repoRootOutput.trim();
const islandGitRoot = relative(repoRoot, islandRoot).split(sep).join("/");
for (const relativePath of [
  "SOURCE.json",
  "SOURCE_COMMIT",
  "SOURCE_SHA256SUMS",
  "scripts/verify-source.mjs",
]) {
  const contents = await readFile(resolve(islandRoot, relativePath));
  const gitPath = `${islandGitRoot}/${relativePath}`;
  const { stdout: indexRecord } = await execFileAsync(
    "git",
    ["ls-files", "-s", "--", gitPath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const match = /^\d{6} ([a-f0-9]+) \d+\t/.exec(indexRecord);
  if (match?.[1] !== gitObjectId("blob", contents)) {
    throw new Error(`Medusa provenance index/worktree mismatch: ${relativePath}`);
  }
}
const { stdout: indexOutput } = await execFileAsync(
  "git",
  ["ls-files", "-s", "-z", "--", `${islandGitRoot}/upstream`],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
const actualPaths = new Map();
const sourceObjects = new Map();

for (const record of indexOutput.split("\0").filter(Boolean)) {
  const match = /^(\d{6}) ([a-f0-9]+) \d+\t(.+)$/.exec(record);
  if (match === null) {
    throw new Error(`Invalid Git index entry: ${record}`);
  }

  const relativePath = match[3].slice(islandGitRoot.length + 1);
  actualPaths.set(relativePath, { mode: match[1], object: match[2] });
}

let contentBytes = 0;
for (const [relativePath, expected] of expectedChecksums) {
  if (symlinks[relativePath] !== undefined) {
    throw new Error(`Symlink is duplicated in source checksums: ${relativePath}`);
  }

  const absolutePath = checkedUpstreamPath(relativePath);
  const stats = await lstat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Expected a regular source file: ${relativePath}`);
  }
  const contents = await readFile(absolutePath);
  contentBytes += contents.byteLength;
  if (sha256(contents) !== expected) {
    throw new Error(`Source checksum mismatch: ${relativePath}`);
  }
  const mode = executableFiles.has(relativePath) ? "100755" : "100644";
  const object = gitObjectId("blob", contents);
  sourceObjects.set(relativePath, { mode, object });
  if (actualPaths.get(relativePath)?.object !== object) {
    throw new Error(`Source Git blob mismatch: ${relativePath}`);
  }
}

for (const executablePath of executableFiles) {
  if (!expectedChecksums.has(executablePath)) {
    throw new Error(
      `Executable path is absent from source manifest: ${executablePath}`,
    );
  }
}

for (const [relativePath, expectedTarget] of Object.entries(symlinks)) {
  checkedUpstreamPath(relativePath);
  const indexEntry = actualPaths.get(relativePath);
  if (indexEntry === undefined) {
    throw new Error(`Source symlink is absent from Git index: ${relativePath}`);
  }
  const { stdout: actualTarget } = await execFileAsync(
    "git",
    ["cat-file", "blob", indexEntry.object],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (actualTarget !== expectedTarget) {
    throw new Error(`Source symlink index mismatch: ${relativePath}`);
  }

  const absolutePath = checkedUpstreamPath(relativePath);
  const stats = await lstat(absolutePath);
  const materializedTarget = stats.isSymbolicLink()
    ? await readlink(absolutePath)
    : await readFile(absolutePath, "utf8");
  if (materializedTarget !== expectedTarget) {
    throw new Error(`Source symlink worktree mismatch: ${relativePath}`);
  }
  const object = gitObjectId("blob", Buffer.from(expectedTarget, "utf8"));
  sourceObjects.set(relativePath, { mode: "120000", object });
  if (indexEntry.object !== object) {
    throw new Error(`Source symlink Git blob mismatch: ${relativePath}`);
  }
}

const expectedPaths = new Set([
  ...expectedChecksums.keys(),
  ...Object.keys(symlinks),
]);
const unexpectedPaths = [...actualPaths.keys()]
  .filter((path) => !expectedPaths.has(path))
  .sort();
if (unexpectedPaths.length > 0) {
  throw new Error(
    `Unexpected files in pinned upstream Git index:\n${unexpectedPaths.join("\n")}`,
  );
}
const missingPaths = [...expectedPaths]
  .filter((path) => !actualPaths.has(path))
  .sort();
if (missingPaths.length > 0) {
  throw new Error(
    `Missing files from pinned upstream Git index:\n${missingPaths.join("\n")}`,
  );
}

for (const relativePath of expectedPaths) {
  const expectedMode = symlinks[relativePath] !== undefined
    ? "120000"
    : executableFiles.has(relativePath)
      ? "100755"
      : "100644";
  if (actualPaths.get(relativePath)?.mode !== expectedMode) {
    throw new Error(`Source Git mode mismatch: ${relativePath}`);
  }
}

const actualTree = gitTreeObjectId(sourceObjects);
if (actualTree !== expectedTree) {
  throw new Error(
    `Source Git tree mismatch: expected ${expectedTree}, found ${actualTree}.`,
  );
}

if (expectedPaths.size !== expectedFileCount) {
  throw new Error(
    `Source file count mismatch: expected ${expectedFileCount}, found ${expectedPaths.size}.`,
  );
}
if (contentBytes !== expectedContentBytes) {
  throw new Error(
    `Source byte count mismatch: expected ${expectedContentBytes}, found ${contentBytes}.`,
  );
}
const packageManifestCount = [...expectedPaths]
  .filter((path) => path === "upstream/package.json" || path.endsWith("/package.json"))
  .length;
if (packageManifestCount !== expectedPackageManifestCount) {
  throw new Error(
    `Package manifest count mismatch: expected ${expectedPackageManifestCount}, found ${packageManifestCount}.`,
  );
}

for (const item of [lockfile, ...patchInventory, ...licenseInventory]) {
  if (expectedChecksums.get(item.path) !== item.sha256) {
    throw new Error(`Pinned inventory checksum mismatch: ${item.path}`);
  }
}

const upstreamPackage = parseJson(
  await readFile(resolve(upstreamRoot, "package.json"), "utf8"),
  "upstream/package.json",
);
if (requiredString(upstreamPackage, "packageManager", "upstream/package.json") !== packageManager) {
  throw new Error("Upstream package-manager pin does not match SOURCE.json.");
}
if (upstreamPackage.name !== "root" || upstreamPackage.private !== true) {
  throw new Error("Upstream root-package identity does not match the pinned fork.");
}
const officialUpstream = sourceMetadata.officialUpstream;
if (
  !isRecord(officialUpstream)
  || requiredString(officialUpstream, "release", "SOURCE.json.officialUpstream")
    !== `v${packageBaseline}`
) {
  throw new Error("Official release baseline does not match SOURCE.json.packageBaseline.");
}

const upstreamLicense = await readFile(resolve(upstreamRoot, "LICENSE"));
const convenienceLicense = await readFile(
  resolve(islandRoot, "licenses", "medusa-fork-MIT.txt"),
);
if (!upstreamLicense.equals(convenienceLicense)) {
  throw new Error("Convenience license copy does not match upstream/LICENSE.");
}

verifyMedusaSourceIslandBoundary(repoRoot);

console.log(
  `Verified ${expectedChecksums.size} files and ${Object.keys(symlinks).length} symlinks from Medusa fork ${commit}.`,
);

/** @param {string} relativePath */
function checkedUpstreamPath(relativePath) {
  if (
    !relativePath.startsWith("upstream/")
    || posix.normalize(relativePath) !== relativePath
  ) {
    throw new Error(`Source manifest path escapes upstream/: ${relativePath}`);
  }

  const absolutePath = resolve(islandRoot, relativePath);
  if (!absolutePath.startsWith(`${upstreamRoot}${sep}`)) {
    throw new Error(`Source manifest path escapes upstream/: ${relativePath}`);
  }
  return absolutePath;
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {"blob" | "tree" | "commit"} type @param {Buffer} value */
function gitObjectId(type, value) {
  const header = Buffer.from(`${type} ${value.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(value).digest("hex");
}

/** @param {ReadonlyMap<string, { readonly mode: string, readonly object: string }>} objects */
function gitTreeObjectId(objects) {
  /** @typedef {{ readonly kind: "file", readonly mode: string, readonly object: string } | { readonly kind: "tree", readonly children: Map<string, GitTreeEntry> }} GitTreeEntry */
  /** @type {Map<string, GitTreeEntry>} */
  const root = new Map();

  for (const [sourcePath, source] of objects) {
    if (!sourcePath.startsWith("upstream/")) {
      throw new Error(`Source tree path must start with upstream/: ${sourcePath}`);
    }
    const parts = sourcePath.slice("upstream/".length).split("/");
    if (parts.some((part) => part.length === 0)) {
      throw new Error(`Source tree path contains an empty member: ${sourcePath}`);
    }
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const existing = directory.get(part);
      if (existing?.kind === "file") {
        throw new Error(`Source tree file/directory collision: ${sourcePath}`);
      }
      if (existing === undefined) {
        const children = new Map();
        directory.set(part, { kind: "tree", children });
        directory = children;
      } else {
        directory = existing.children;
      }
    }
    const name = parts.at(-1);
    if (name === undefined || directory.has(name)) {
      throw new Error(`Duplicate source tree path: ${sourcePath}`);
    }
    directory.set(name, { kind: "file", ...source });
  }

  /** @param {Map<string, GitTreeEntry>} entries */
  function hashTree(entries) {
    const ordered = [...entries.entries()].sort(
      ([leftName, left], [rightName, right]) => Buffer.compare(
        Buffer.from(`${leftName}${left.kind === "tree" ? "/" : ""}`, "utf8"),
        Buffer.from(`${rightName}${right.kind === "tree" ? "/" : ""}`, "utf8"),
      ),
    );
    const payload = Buffer.concat(ordered.flatMap(([name, entry]) => {
      const mode = entry.kind === "tree" ? "40000" : entry.mode;
      const object = entry.kind === "tree"
        ? hashTree(entry.children)
        : entry.object;
      return [
        Buffer.from(`${mode} ${name}\0`, "utf8"),
        Buffer.from(object, "hex"),
      ];
    }));
    return gitObjectId("tree", payload);
  }

  return hashTree(root);
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {Readonly<Record<string, unknown>>}
 */
function parseJson(text, label) {
  /** @type {unknown} */
  const value = JSON.parse(text);
  if (!isRecord(value)) {
    throw new Error(`${label} must contain a JSON object.`);
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

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredString(record, key, label) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a nonempty string.`);
  }
  return value;
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredSha256(record, key, label) {
  const value = requiredString(record, key, label);
  if (!sha256Pattern.test(value)) {
    throw new Error(`${label}.${key} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredGitObjectId(record, key, label) {
  const value = requiredString(record, key, label);
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label}.${key} must be a lowercase SHA-1 Git object ID.`);
  }
  return value;
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredNonNegativeSafeInteger(record, key, label) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${label}.${key} must be a non-negative safe integer.`);
  }
  return value;
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredStringArray(record, key, label) {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label}.${key} must be an array of strings.`);
  }
  /** @type {string[]} */
  const result = value;
  return result;
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredStringRecord(record, key, label) {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${label}.${key} must be a string-valued object.`);
  }
  /** @type {Readonly<Record<string, string>>} */
  const result = Object.fromEntries(Object.entries(value).map(([entryKey, item]) => {
    if (typeof item !== "string") {
      throw new Error(`${label}.${key}.${entryKey} must be a string.`);
    }
    return [entryKey, item];
  }));
  return result;
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredHashedPathArray(record, key, label) {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${label}.${key} must be an array.`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`${label}.${key}[${index}] must be an object.`);
    }
    return {
      path: requiredString(item, "path", `${label}.${key}[${index}]`),
      sha256: requiredSha256(item, "sha256", `${label}.${key}[${index}]`),
    };
  });
}

/**
 * @param {Readonly<Record<string, unknown>>} record
 * @param {string} key
 * @param {string} label
 */
function requiredHashedPathRecord(record, key, label) {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${label}.${key} must be an object.`);
  }
  return {
    path: requiredString(value, "path", `${label}.${key}`),
    sha256: requiredSha256(value, "sha256", `${label}.${key}`),
  };
}
