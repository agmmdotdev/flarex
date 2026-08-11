#!/usr/bin/env node
// @ts-check
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mapRelativePath =
  "roadmaps/durable-task-engine/preflight/source-map.connected-runtime-v1.json";
const sourceMetadataRelativePath = "third_party/trigger.dev/SOURCE.json";
const checksumRelativePath = "third_party/trigger.dev/SOURCE_SHA256SUMS";
const sourceRootRelativePath = "third_party/trigger.dev";
const recoveryTarget =
  "packages/flarex-backend/src/taskComputeDelivery/DispatchRecoveryDecision.ts";
const recoveryEntryId = "unknown-delivery-recovery-decision";
const reuseClasses = new Set(["U", "S", "T", "D"]);

if (isCliEntrypoint()) {
  const report = inspectConnectedRuntimeSourceMapRepository(process.cwd());
  if (report.errors.length > 0) {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Connected runtime source map check passed (${report.entryCount} entries).`,
    );
  }
}

/**
 * @param {string} repoRoot
 * @returns {{ readonly errors: string[]; readonly entryCount: number }}
 */
export function inspectConnectedRuntimeSourceMapRepository(repoRoot) {
  /** @type {string[]} */
  const errors = [];
  const sourceMap = readJson(
    path.join(repoRoot, mapRelativePath),
    mapRelativePath,
    errors,
  );
  const sourceMetadata = readJson(
    path.join(repoRoot, sourceMetadataRelativePath),
    sourceMetadataRelativePath,
    errors,
  );
  const checksumPath = path.join(repoRoot, checksumRelativePath);
  if (!existsSync(checksumPath)) {
    errors.push(`${checksumRelativePath} is missing.`);
  }
  if (errors.length > 0) return { errors, entryCount: 0 };

  return analyzeConnectedRuntimeSourceMap({
    sourceMap,
    sourceMetadata,
    checksumText: readFileSync(checksumPath, "utf8"),
    readFile(relativePath) {
      const absolutePath = path.join(
        repoRoot,
        relativePath.startsWith("upstream/")
          ? sourceRootRelativePath
          : "",
        relativePath,
      );
      return existsSync(absolutePath) ? readFileSync(absolutePath) : undefined;
    },
  });
}

/**
 * @param {{
 *   readonly sourceMap: unknown;
 *   readonly sourceMetadata: unknown;
 *   readonly checksumText: string;
 *   readonly readFile: (relativePath: string) => Buffer | undefined;
 * }} input
 * @returns {{ readonly errors: string[]; readonly entryCount: number }}
 */
export function analyzeConnectedRuntimeSourceMap(input) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(input.sourceMap)) {
    return { errors: ["connected runtime source map must be an object."], entryCount: 0 };
  }
  if (!isRecord(input.sourceMetadata)) {
    return { errors: ["Trigger source metadata must be an object."], entryCount: 0 };
  }
  const sourceMap = input.sourceMap;
  const sourceMetadata = input.sourceMetadata;
  if (sourceMap.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (sourceMap.capability !== "connected-runtime-v1") {
    errors.push("capability must be connected-runtime-v1.");
  }
  if (sourceMap.decisionStatus !== "approved") {
    errors.push("decisionStatus must be approved before implementation.");
  }
  if (typeof sourceMap.approvedAt !== "string" || sourceMap.approvedAt.length === 0) {
    errors.push("approvedAt must be recorded.");
  }
  if (
    typeof sourceMetadata.commit !== "string"
    || sourceMap.upstreamCommit !== sourceMetadata.commit
  ) {
    errors.push("upstreamCommit must match third_party/trigger.dev/SOURCE.json.");
  }
  if (sourceMap.sourceVerification !== checksumRelativePath) {
    errors.push("sourceVerification must name SOURCE_SHA256SUMS.");
  }

  const checksumCatalog = parseChecksumCatalog(input.checksumText, errors);
  const entries = Array.isArray(sourceMap.entries) ? sourceMap.entries : [];
  if (!Array.isArray(sourceMap.entries) || entries.length === 0) {
    errors.push("entries must be a nonempty array.");
  }
  const ids = new Set();
  /** @type {Record<string, number>} */
  const newCounts = { U: 0, S: 0, T: 0, D: 0 };
  /** @type {Record<string, number>} */
  const existingCounts = { U: 0, S: 0, T: 0, D: 0 };
  /** @type {Record<string, unknown> | undefined} */
  let recoveryEntry;

  for (const [index, unknownEntry] of entries.entries()) {
    const label = `entries[${index}]`;
    if (!isRecord(unknownEntry)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const entry = unknownEntry;
    if (typeof entry.id !== "string" || entry.id.length === 0 || ids.has(entry.id)) {
      errors.push(`${label}.id must be nonempty and unique.`);
    } else {
      ids.add(entry.id);
      if (entry.id === recoveryEntryId) recoveryEntry = entry;
    }
    if (typeof entry.reuseClass !== "string" || !reuseClasses.has(entry.reuseClass)) {
      errors.push(`${label}.reuseClass is invalid.`);
    } else if (entry.admissionScope === "new-connected-runtime") {
      newCounts[entry.reuseClass] += 1;
    } else if (entry.admissionScope === "existing-admission-reference") {
      existingCounts[entry.reuseClass] += 1;
    } else {
      errors.push(`${label}.admissionScope is invalid.`);
    }
    if (typeof entry.upstreamPath !== "string") {
      errors.push(`${label}.upstreamPath must be a string.`);
    } else {
      const expectedHash = checksumCatalog.get(entry.upstreamPath);
      if (expectedHash === undefined || expectedHash !== entry.upstreamSha256) {
        errors.push(`${label} hash must match SOURCE_SHA256SUMS.`);
      }
      const bytes = input.readFile(entry.upstreamPath);
      if (bytes === undefined) {
        errors.push(`${label} upstream source is missing.`);
      } else if (sha256(bytes) !== entry.upstreamSha256) {
        errors.push(`${label} upstream source content hash does not match.`);
      }
    }
    if (!Array.isArray(entry.targetOwners) || entry.targetOwners.length === 0) {
      errors.push(`${label}.targetOwners must be nonempty.`);
    } else {
      for (const target of entry.targetOwners) {
        if (
          typeof target === "string"
          && target.startsWith("packages/")
          && !target.includes(" (planned")
          && input.readFile(target) === undefined
        ) {
          errors.push(`${label} implemented target is missing: ${target}.`);
        }
      }
    }
  }

  validateSummary(sourceMap.summary, newCounts, existingCounts, errors);
  if (recoveryEntry === undefined || recoveryEntry.reuseClass !== "S") {
    errors.push(`${recoveryEntryId} must remain a seam adaptation.`);
  } else if (
    !Array.isArray(recoveryEntry.targetOwners)
    || !recoveryEntry.targetOwners.includes(recoveryTarget)
  ) {
    errors.push(`${recoveryEntryId} must own ${recoveryTarget}.`);
  }
  const recoveryBytes = input.readFile(recoveryTarget);
  const recoveryText = recoveryBytes?.toString("utf8") ?? "";
  if (
    !recoveryText.includes("Seam adaptation of Trigger.dev's WarmStartVerificationService.verify")
    || !recoveryText.includes(String(recoveryEntry?.upstreamPath ?? ""))
    || !recoveryText.includes(String(sourceMap.upstreamCommit ?? ""))
  ) {
    errors.push(`${recoveryTarget} must retain exact Trigger provenance.`);
  }

  if (isRecord(sourceMap.licensePolicy) && Array.isArray(sourceMap.licensePolicy.noticeFiles)) {
    for (const notice of sourceMap.licensePolicy.noticeFiles) {
      if (typeof notice !== "string" || input.readFile(notice) === undefined) {
        errors.push(`license notice is missing: ${String(notice)}.`);
      }
    }
  } else {
    errors.push("licensePolicy.noticeFiles must be recorded.");
  }
  return { errors, entryCount: entries.length };
}

/**
 * @param {unknown} summary
 * @param {Record<string, number>} newCounts
 * @param {Record<string, number>} existingCounts
 * @param {string[]} errors
 */
function validateSummary(summary, newCounts, existingCounts, errors) {
  if (!isRecord(summary)) {
    errors.push("summary must be an object.");
    return;
  }
  /** @type {Array<[string, Record<string, number>]>} */
  const countGroups = [
    ["newConnectedRuntimeDecisions", newCounts],
    ["existingAdmissionReferences", existingCounts],
  ];
  for (const [field, counts] of countGroups) {
    const recorded = summary[field];
    if (!isRecord(recorded)) {
      errors.push(`summary.${field} must be an object.`);
      continue;
    }
    for (const reuseClass of reuseClasses) {
      if ((recorded[reuseClass] ?? 0) !== counts[reuseClass]) {
        errors.push(`summary.${field}.${reuseClass} count is stale.`);
      }
    }
  }
}

/** @param {string} text @param {string[]} errors */
function parseChecksumCatalog(text, errors) {
  const catalog = new Map();
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (match === null) {
      errors.push(`SOURCE_SHA256SUMS line ${index + 1} is invalid.`);
    } else {
      catalog.set(match[2], match[1]);
    }
  }
  return catalog;
}

/** @param {Buffer} bytes */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} absolutePath @param {string} label @param {string[]} errors */
function readJson(absolutePath, label, errors) {
  if (!existsSync(absolutePath)) {
    errors.push(`${label} is missing.`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (cause) {
    errors.push(`${label} is invalid JSON: ${String(cause)}.`);
    return undefined;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined
    && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}
