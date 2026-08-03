#!/usr/bin/env node
// @ts-check
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const acceptedMapRelativePath = "roadmaps/durable-task-engine/preflight/source-map.run-attempt-v1.json";
const sourceMetadataRelativePath = "third_party/trigger.dev/SOURCE.json";
const sourceRootRelativePath = "third_party/trigger.dev";
const targetPackageRelativePath = "packages/durable-task";
const expectedSchemaVersion = "flarex.trigger-source-reuse.v1";
const expectedCapability = "run-attempt-lifecycle-v1";
const expectedTargetPackage = "@flarex/durable-task";
const reuseClasses = new Set(["U", "S", "T", "D"]);
const licenseNotices = new Set(["apache-2.0", "mit", "mixed"]);
const requiredPackageFiles = [
  "src",
  "THIRD_PARTY_NOTICES.md",
  "trigger-source-map.json",
  "licenses",
];

if (isCliEntrypoint()) {
  const report = inspectDurableTaskSourceMapRepository(process.cwd());
  if (report.errors.length > 0) {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Durable task source map check passed (${report.entryCount} entries, ${report.mode}).`,
    );
  }
}

/**
 * @param {string} repoRoot
 * @returns {{ errors: string[]; entryCount: number; mode: "pre-admission" | "admitted-package" }}
 */
export function inspectDurableTaskSourceMapRepository(repoRoot) {
  /** @type {string[]} */
  const errors = [];
  const acceptedMap = readJson(
    path.join(repoRoot, acceptedMapRelativePath),
    acceptedMapRelativePath,
    errors,
  );
  const sourceMetadata = readJson(
    path.join(repoRoot, sourceMetadataRelativePath),
    sourceMetadataRelativePath,
    errors,
  );
  const targetRoot = path.join(repoRoot, targetPackageRelativePath);
  const admitted = existsSync(targetRoot);
  const activeMap = admitted
    ? readJson(
        path.join(targetRoot, "trigger-source-map.json"),
        `${targetPackageRelativePath}/trigger-source-map.json`,
        errors,
      )
    : acceptedMap;

  if (errors.length > 0) {
    return {
      errors,
      entryCount: 0,
      mode: admitted ? "admitted-package" : "pre-admission",
    };
  }

  const report = analyzeDurableTaskSourceMap({
    sourceMap: activeMap,
    sourceMetadata,
    readUpstreamFile(relativePath) {
      const absolutePath = path.join(repoRoot, sourceRootRelativePath, relativePath);
      return existsSync(absolutePath) && lstatSync(absolutePath).isFile()
        ? readFileSync(absolutePath)
        : undefined;
    },
  });
  errors.push(...report.errors);

  if (admitted) {
    validateAdmittedPackage({
      repoRoot,
      acceptedMap,
      activeMap,
      errors,
    });
  }

  return {
    errors,
    entryCount: report.entryCount,
    mode: admitted ? "admitted-package" : "pre-admission",
  };
}

/**
 * @param {{
 *   sourceMap: unknown;
 *   sourceMetadata: unknown;
 *   readUpstreamFile: (relativePath: string) => Uint8Array | string | undefined;
 * }} input
 * @returns {{ errors: string[]; entryCount: number }}
 */
export function analyzeDurableTaskSourceMap(input) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(input.sourceMap)) {
    return { errors: ["source map must be an object."], entryCount: 0 };
  }
  if (!isRecord(input.sourceMetadata)) {
    return { errors: ["Trigger SOURCE.json must be an object."], entryCount: 0 };
  }

  const sourceMap = input.sourceMap;
  const sourceMetadata = input.sourceMetadata;
  checkExactString(sourceMap.schemaVersion, expectedSchemaVersion, "source map schemaVersion", errors);
  checkExactString(sourceMap.capability, expectedCapability, "source map capability", errors);
  checkExactString(sourceMap.targetPackage, expectedTargetPackage, "source map targetPackage", errors);

  const metadataCommit = sourceMetadata.commit;
  if (!isLowerHexSha(metadataCommit)) {
    errors.push("Trigger SOURCE.json commit must be a lowercase SHA-1 hash.");
  }
  if (!isLowerHexSha(sourceMap.upstreamCommit)) {
    errors.push("source map upstreamCommit must be a lowercase SHA-1 hash.");
  } else if (sourceMap.upstreamCommit !== metadataCommit) {
    errors.push("source map upstreamCommit must match third_party/trigger.dev/SOURCE.json.");
  }

  if (!Array.isArray(sourceMap.entries) || sourceMap.entries.length === 0) {
    errors.push("source map entries must be a nonempty array.");
    return { errors, entryCount: 0 };
  }

  /** @type {Map<string, number>} */
  const claimedSymbols = new Map();
  for (const [index, value] of sourceMap.entries.entries()) {
    const label = `source map entries[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object.`);
      continue;
    }

    if (value.upstreamCommit !== sourceMap.upstreamCommit) {
      errors.push(`${label}.upstreamCommit must match the source map commit.`);
    }
    if (!isSafeRelativePath(value.upstreamPath, ["upstream/"])) {
      errors.push(`${label}.upstreamPath must be a normalized path under upstream/.`);
    }
    if (!isSha256(value.upstreamSha256)) {
      errors.push(`${label}.upstreamSha256 must be a lowercase SHA-256 hash.`);
    }
    if (!isNonemptyStringArray(value.selectedSymbols)) {
      errors.push(`${label}.selectedSymbols must be a nonempty string array.`);
    }
    if (typeof value.reuseClass !== "string" || !reuseClasses.has(value.reuseClass)) {
      errors.push(`${label}.reuseClass must be U, S, T, or D.`);
    }
    if (typeof value.licenseNotice !== "string" || !licenseNotices.has(value.licenseNotice)) {
      errors.push(`${label}.licenseNotice must be apache-2.0, mit, or mixed.`);
    }
    if (!isNonemptyStringArray(value.semanticChanges)) {
      errors.push(`${label}.semanticChanges must be a nonempty string array.`);
    }
    if (!isNonblankString(value.authorityReason)) {
      errors.push(`${label}.authorityReason must be a nonblank string.`);
    }
    if (!isStringArray(value.retainedTests)) {
      errors.push(`${label}.retainedTests must be a string array.`);
    }
    if (!isStringArray(value.addedFlarexTests)) {
      errors.push(`${label}.addedFlarexTests must be a string array.`);
    }

    const discarded = value.reuseClass === "D";
    if (discarded) {
      if (value.targetPackage !== "discarded" || !isSafeRelativePath(value.targetPath, ["discarded/"])) {
        errors.push(`${label} discarded entries must use the discarded target namespace.`);
      }
    } else if (
      value.targetPackage !== expectedTargetPackage
      || !isSafeRelativePath(value.targetPath, ["src/", "test/"])
    ) {
      errors.push(`${label} admitted entries must target @flarex/durable-task src/ or test/.`);
    }

    if (isSafeRelativePath(value.upstreamPath, ["upstream/"])) {
      const bytes = input.readUpstreamFile(value.upstreamPath);
      if (bytes === undefined) {
        errors.push(`${label}.upstreamPath does not exist in the frozen island.`);
      } else if (
        typeof value.upstreamSha256 === "string"
        && sha256(bytes) !== value.upstreamSha256
      ) {
        errors.push(`${label}.upstreamSha256 does not match the frozen source file.`);
      }
    }

    if (Array.isArray(value.retainedTests)) {
      for (const [testIndex, retainedTest] of value.retainedTests.entries()) {
        if (!isSafeRelativePath(retainedTest, ["upstream/"])) {
          errors.push(`${label}.retainedTests[${testIndex}] must be a normalized upstream path.`);
        } else if (input.readUpstreamFile(retainedTest) === undefined) {
          errors.push(`${label}.retainedTests[${testIndex}] does not exist in the frozen island.`);
        }
      }
    }

    if (typeof value.upstreamPath === "string" && Array.isArray(value.selectedSymbols)) {
      for (const symbol of value.selectedSymbols) {
        if (typeof symbol !== "string" || symbol.length === 0) continue;
        const claim = `${value.upstreamPath}\0${symbol}`;
        const previous = claimedSymbols.get(claim);
        if (previous !== undefined) {
          errors.push(`${label} duplicates the symbol claim from entries[${previous}].`);
        } else {
          claimedSymbols.set(claim, index);
        }
      }
    }
  }

  return { errors, entryCount: sourceMap.entries.length };
}

/**
 * @param {{ repoRoot: string; acceptedMap: unknown; activeMap: unknown; errors: string[] }} input
 */
function validateAdmittedPackage(input) {
  const targetRoot = path.join(input.repoRoot, targetPackageRelativePath);
  if (!isRecord(input.acceptedMap) || !isRecord(input.activeMap)) return;
  const acceptedEntries = input.acceptedMap.entries;
  const activeEntries = input.activeMap.entries;
  if (!Array.isArray(acceptedEntries) || !Array.isArray(activeEntries)) return;

  if (acceptedEntries.length !== activeEntries.length) {
    input.errors.push("admitted trigger-source-map.json must retain every accepted map entry.");
  }

  /** @type {Map<string, Set<string>>} */
  const targetOrigins = new Map();

  for (const [index, acceptedEntry] of acceptedEntries.entries()) {
    const activeEntry = activeEntries[index];
    if (!isRecord(acceptedEntry) || !isRecord(activeEntry)) continue;
    for (const [key, acceptedValue] of Object.entries(acceptedEntry)) {
      if (JSON.stringify(activeEntry[key]) !== JSON.stringify(acceptedValue)) {
        input.errors.push(`admitted source map entries[${index}].${key} changed from the accepted preflight map.`);
      }
    }
    if (acceptedEntry.reuseClass === "D") continue;

    for (const field of ["targetSha256", "transformationRevision", "changeReceipt"]) {
      if (!isNonblankString(activeEntry[field])) {
        input.errors.push(`admitted source map entries[${index}].${field} must be a nonblank string.`);
      }
    }
    if (!isSafeRelativePath(activeEntry.targetPath, ["src/", "test/"])) continue;
    if (isSafeRelativePath(activeEntry.upstreamPath, ["upstream/"])) {
      const origins = targetOrigins.get(activeEntry.targetPath) ?? new Set();
      origins.add(activeEntry.upstreamPath);
      targetOrigins.set(activeEntry.targetPath, origins);
    }
    const targetPath = path.join(targetRoot, activeEntry.targetPath);
    if (!existsSync(targetPath) || !lstatSync(targetPath).isFile()) {
      input.errors.push(`admitted target ${activeEntry.targetPath} is missing.`);
      continue;
    }
    if (
      typeof activeEntry.targetSha256 === "string"
      && sha256(readFileSync(targetPath)) !== activeEntry.targetSha256
    ) {
      input.errors.push(`admitted target ${activeEntry.targetPath} does not match targetSha256.`);
    }
  }

  for (const [targetPath, origins] of targetOrigins) {
    const absolutePath = path.join(targetRoot, targetPath);
    if (!existsSync(absolutePath) || typeof input.activeMap.upstreamCommit !== "string") continue;
    if (!hasValidTriggerAttributionHeader(
      readFileSync(absolutePath, "utf8"),
      input.activeMap.upstreamCommit,
      [...origins],
    )) {
      input.errors.push(`admitted target ${targetPath} lacks its exact mapped Trigger.dev attribution header.`);
    }
  }

  const manifest = readJson(
    path.join(targetRoot, "package.json"),
    `${targetPackageRelativePath}/package.json`,
    input.errors,
  );
  if (isRecord(manifest) && Array.isArray(manifest.files)) {
    for (const required of requiredPackageFiles) {
      if (!manifest.files.includes(required)) {
        input.errors.push(`packages/durable-task/package.json files must include ${required}.`);
      }
    }
  } else if (manifest !== undefined) {
    input.errors.push("packages/durable-task/package.json files must be an array.");
  }

  const exportedTargetPath = path.join(targetRoot, "src/runAttempt/v1.ts");
  if (!existsSync(exportedTargetPath) || !lstatSync(exportedTargetPath).isFile()) {
    input.errors.push("packages/durable-task export target src/runAttempt/v1.ts is missing.");
  }

  const noticePath = path.join(targetRoot, "THIRD_PARTY_NOTICES.md");
  const commit = input.activeMap.upstreamCommit;
  if (!existsSync(noticePath) || typeof commit !== "string") {
    input.errors.push("packages/durable-task/THIRD_PARTY_NOTICES.md is missing or the pinned commit is invalid.");
  } else {
    input.errors.push(...analyzeThirdPartyNotice(readFileSync(noticePath, "utf8"), commit));
  }

  compareExactFile(
    path.join(input.repoRoot, "third_party/trigger.dev/upstream/LICENSE"),
    path.join(targetRoot, "licenses/trigger-apache-2.0.txt"),
    "Apache 2.0 license copy",
    input.errors,
  );
  compareExactFile(
    path.join(input.repoRoot, "third_party/trigger.dev/upstream/packages/core/LICENSE"),
    path.join(targetRoot, "licenses/trigger-core-mit.txt"),
    "Trigger core MIT license copy",
    input.errors,
  );

  const mappedTargets = new Set(
    activeEntries
      .filter((entry) => isRecord(entry) && entry.reuseClass !== "D" && typeof entry.targetPath === "string")
      .map((entry) => /** @type {string} */ (entry.targetPath)),
  );
  for (const relativePath of collectSourceFiles(targetRoot)) {
    const text = readFileSync(path.join(targetRoot, relativePath), "utf8");
    if (text.includes("Adapted from Trigger.dev commit") && !mappedTargets.has(relativePath)) {
      input.errors.push(`adapted target ${relativePath} has no admitted source-map entry.`);
    }
  }
}

/**
 * @param {string} text
 * @param {string} commit
 * @param {readonly string[]} upstreamPaths
 */
export function hasValidTriggerAttributionHeader(text, commit, upstreamPaths) {
  if (!isLowerHexSha(commit) || upstreamPaths.length === 0) return false;
  const uniquePaths = [...new Set(upstreamPaths)];
  if (!uniquePaths.every((value) => isSafeRelativePath(value, ["upstream/"]))) return false;
  const origin = uniquePaths.length === 1
    ? uniquePaths[0]
    : "multiple mapped upstream paths";
  const expected = [
    `// Adapted from Trigger.dev commit ${commit},`,
    `// ${origin}. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.`,
  ].join("\n");
  return text.replaceAll("\r\n", "\n").startsWith(expected);
}

/** @param {string} text @param {string} commit @returns {string[]} */
export function analyzeThirdPartyNotice(text, commit) {
  /** @type {[string, string][]} */
  const requiredFragments = [
    ["Trigger.dev", "project name"],
    ["https://github.com/triggerdotdev/trigger.dev", "upstream repository"],
    [commit, "pinned commit"],
    ["Apache License 2.0", "Apache license group"],
    ["MIT", "MIT license group"],
    ["Copyright (c) 2023 Trigger.dev", "Trigger core copyright notice"],
    ["trigger-source-map.json", "source map reference"],
  ];
  const errors = requiredFragments
    .filter(([fragment]) => !text.includes(fragment))
    .map(([, label]) => `packages/durable-task/THIRD_PARTY_NOTICES.md must include its ${label}.`);
  if (!/\b(?:adapted|changed|modified|transformed)\b/i.test(text)) {
    errors.push("packages/durable-task/THIRD_PARTY_NOTICES.md must state that Flarex changed the admitted source.");
  }
  return errors;
}

/** @param {string} expected @param {string} actual @param {string} label @param {string[]} errors */
function compareExactFile(expected, actual, label, errors) {
  if (!existsSync(expected) || !existsSync(actual)) {
    errors.push(`${label} is missing.`);
    return;
  }
  if (!readFileSync(expected).equals(readFileSync(actual))) {
    errors.push(`${label} must exactly match the pinned upstream text.`);
  }
}

/** @param {string} root @returns {string[]} */
function collectSourceFiles(root) {
  /** @type {string[]} */
  const files = [];
  for (const directoryName of ["src", "test"]) {
    const directory = path.join(root, directoryName);
    if (!existsSync(directory)) continue;
    visit(directory);
  }
  return files;

  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const absolutePath = path.join(directory, entry);
      const stats = lstatSync(absolutePath);
      if (stats.isDirectory()) visit(absolutePath);
      else if (stats.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry)) {
        files.push(normalizePath(path.relative(root, absolutePath)));
      }
    }
  }
}

/** @param {string} file @param {string} label @param {string[]} errors */
function readJson(file, label, errors) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${label} could not be read as JSON: ${errorMessage(error)}`);
    return undefined;
  }
}

/** @param {unknown} actual @param {string} expected @param {string} label @param {string[]} errors */
function checkExactString(actual, expected, label, errors) {
  if (actual !== expected) errors.push(`${label} must be ${JSON.stringify(expected)}.`);
}

/** @param {unknown} value */
function isLowerHexSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

/** @param {unknown} value */
function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** @param {unknown} value */
function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value @returns {value is string[]} */
function isStringArray(value) {
  return Array.isArray(value) && value.every((member) => typeof member === "string" && member.length > 0);
}

/** @param {unknown} value @returns {value is string[]} */
function isNonemptyStringArray(value) {
  return isStringArray(value) && value.length > 0;
}

/** @param {unknown} value @param {string[]} prefixes @returns {value is string} */
function isSafeRelativePath(value, prefixes) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value
    && !path.posix.isAbsolute(value)
    && !value.startsWith("../")
    && prefixes.some((prefix) => value.startsWith(prefix));
}

/** @param {Uint8Array | string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value @returns {value is Readonly<Record<string, unknown>>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} value */
function normalizePath(value) {
  return value.split(path.sep).join("/");
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
