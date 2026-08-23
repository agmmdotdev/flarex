#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {{
 *   readonly name: string;
 *   readonly equals?: string;
 * }} TestLanePrerequisite
 */

/**
 * @typedef {{
 *   readonly id: string;
 *   readonly cwd: string;
 *   readonly command: "pnpm";
 *   readonly args: readonly string[];
 * }} TestLaneStep
 */

/**
 * @typedef {{
 *   readonly id: string;
 *   readonly category: "fast" | "pglite" | "integration" | "postgres" | "workerd" | "hosted";
 *   readonly proof: string;
 *   readonly prerequisites: readonly TestLanePrerequisite[];
 *   readonly steps: readonly TestLaneStep[];
 * }} TestLane
 */

/**
 * @typedef {{
 *   readonly schemaVersion: 1;
 *   readonly lanes: readonly TestLane[];
 *   readonly selectors: Readonly<Record<string, readonly string[]>>;
 * }} TestLaneManifest
 */

/**
 * @typedef {{
 *   readonly laneId: string;
 *   readonly missing: readonly string[];
 *   readonly mismatched: readonly { readonly name: string; readonly expected: string }[];
 * }} UnavailableLane
 */

/**
 * @typedef {{
 *   readonly schemaVersion: 1;
 *   readonly resultScope: "lanes";
 *   readonly selector: string;
 *   readonly status: "passed" | "failed" | "unavailable";
 *   readonly selected: readonly string[];
 *   readonly passed: readonly string[];
 *   readonly failed: null | {
 *     readonly laneId: string;
 *     readonly stepId: string;
 *     readonly exitCode: number;
 *     readonly detail?: string;
 *   };
 *   readonly skipped: readonly {
 *     readonly laneId: string;
 *     readonly reason: "unavailable-selection" | "previous-failure";
 *   }[];
 *   readonly unavailable: readonly UnavailableLane[];
 *   readonly durationMs: number;
 * }} TestLaneReport
 */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const testLaneManifestPath = path.join(repositoryRoot, "test-lanes.json");
export const testLaneReportPrefix = "FLAREX_TEST_LANE_REPORT ";
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const environmentNamePattern = /^[A-Z][A-Z0-9_]*$/u;

if (isCliEntrypoint()) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/** @param {readonly string[]} args */
function runCli(args) {
  const manifest = loadTestLaneManifest();
  if (args.length === 1 && args[0] === "--check-manifest") {
    console.log(
      `Test lane manifest check passed (${manifest.lanes.length} lanes, ${Object.keys(manifest.selectors).length} selectors).`,
    );
    return 0;
  }
  if (args.length === 1 && args[0] === "--list") {
    console.log(JSON.stringify(projectTestLaneCatalog(manifest), null, 2));
    return 0;
  }
  if (args.length !== 1 || args[0].startsWith("-")) {
    console.error(
      "Usage: node scripts/run-test-lane.mjs <selector-or-lane> | --list | --check-manifest",
    );
    return 1;
  }

  const selector = args[0];
  const report = executeTestLaneSelection(manifest, selector, {
    environment: process.env,
    runStep: runTestLaneStep,
  });
  console.log(`${testLaneReportPrefix}${JSON.stringify(report)}`);
  return report.status === "passed" ? 0 : 1;
}

export function loadTestLaneManifest() {
  const value = JSON.parse(readFileSync(testLaneManifestPath, "utf8"));
  const errors = analyzeTestLaneManifest(value, {
    directoryExists(relativePath) {
      return existsSync(path.join(repositoryRoot, relativePath));
    },
    fileExists(relativeDirectory, relativePath) {
      return existsSync(path.join(repositoryRoot, relativeDirectory, relativePath));
    },
  });
  if (errors.length > 0) {
    throw new Error(`test-lanes.json is invalid:\n${errors.join("\n")}`);
  }
  return /** @type {TestLaneManifest} */ (value);
}

/**
 * @param {unknown} value
 * @param {{
 *   readonly directoryExists?: (relativePath: string) => boolean;
 *   readonly fileExists?: (relativeDirectory: string, relativePath: string) => boolean;
 * }} [options]
 */
export function analyzeTestLaneManifest(value, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(value)) return ["manifest must be an object."];
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1.");

  const lanes = Array.isArray(value.lanes) ? value.lanes : [];
  if (!Array.isArray(value.lanes) || lanes.length === 0) {
    errors.push("lanes must be a nonempty array.");
  }
  const laneIds = new Set();
  for (const [laneIndex, unknownLane] of lanes.entries()) {
    const label = `lanes[${laneIndex}]`;
    if (!isRecord(unknownLane)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const lane = unknownLane;
    if (!isIdentifier(lane.id) || laneIds.has(lane.id)) {
      errors.push(`${label}.id must be a unique lowercase kebab identifier.`);
    } else {
      laneIds.add(lane.id);
    }
    if (![
      "fast",
      "pglite",
      "integration",
      "postgres",
      "workerd",
      "hosted",
    ].includes(String(lane.category))) {
      errors.push(`${label}.category is invalid.`);
    }
    if (typeof lane.proof !== "string" || lane.proof.trim().length === 0) {
      errors.push(`${label}.proof must be a nonblank string.`);
    }
    validatePrerequisites(lane.prerequisites, label, errors);
    validateSteps(lane.steps, label, options, errors);
  }

  if (!isRecord(value.selectors) || Object.keys(value.selectors).length === 0) {
    errors.push("selectors must be a nonempty object.");
  } else {
    for (const [selector, unknownLaneIds] of Object.entries(value.selectors)) {
      const label = `selectors.${selector}`;
      if (!isIdentifier(selector)) {
        errors.push(`${label} must use a lowercase kebab identifier.`);
      }
      if (!Array.isArray(unknownLaneIds) || unknownLaneIds.length === 0) {
        errors.push(`${label} must be a nonempty lane-id array.`);
        continue;
      }
      const selectedIds = new Set();
      for (const laneId of unknownLaneIds) {
        if (typeof laneId !== "string" || !laneIds.has(laneId)) {
          errors.push(`${label} references unknown lane ${JSON.stringify(laneId)}.`);
        } else if (selectedIds.has(laneId)) {
          errors.push(`${label} must not repeat lane ${laneId}.`);
        } else {
          selectedIds.add(laneId);
        }
      }
    }
  }
  return errors;
}

/**
 * @param {unknown} unknownPrerequisites
 * @param {string} laneLabel
 * @param {string[]} errors
 */
function validatePrerequisites(unknownPrerequisites, laneLabel, errors) {
  if (!Array.isArray(unknownPrerequisites)) {
    errors.push(`${laneLabel}.prerequisites must be an array.`);
    return;
  }
  const names = new Set();
  for (const [index, unknownPrerequisite] of unknownPrerequisites.entries()) {
    const label = `${laneLabel}.prerequisites[${index}]`;
    if (!isRecord(unknownPrerequisite)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const prerequisite = unknownPrerequisite;
    if (
      typeof prerequisite.name !== "string"
      || !environmentNamePattern.test(prerequisite.name)
      || names.has(prerequisite.name)
    ) {
      errors.push(`${label}.name must be a unique environment variable name.`);
    } else {
      names.add(prerequisite.name);
    }
    if (
      prerequisite.equals !== undefined
      && (typeof prerequisite.equals !== "string" || prerequisite.equals.length === 0)
    ) {
      errors.push(`${label}.equals must be a nonempty string when present.`);
    }
  }
}

/**
 * @param {unknown} unknownSteps
 * @param {string} laneLabel
 * @param {{
 *   readonly directoryExists?: (relativePath: string) => boolean;
 *   readonly fileExists?: (relativeDirectory: string, relativePath: string) => boolean;
 * }} options
 * @param {string[]} errors
 */
function validateSteps(unknownSteps, laneLabel, options, errors) {
  if (!Array.isArray(unknownSteps) || unknownSteps.length === 0) {
    errors.push(`${laneLabel}.steps must be a nonempty array.`);
    return;
  }
  const ids = new Set();
  for (const [index, unknownStep] of unknownSteps.entries()) {
    const label = `${laneLabel}.steps[${index}]`;
    if (!isRecord(unknownStep)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const step = unknownStep;
    if (!isIdentifier(step.id) || ids.has(step.id)) {
      errors.push(`${label}.id must be a unique lowercase kebab identifier.`);
    } else {
      ids.add(step.id);
    }
    if (typeof step.cwd !== "string" || !isSafeRepositoryRelativeDirectory(step.cwd)) {
      errors.push(`${label}.cwd must be a normalized repository-relative directory.`);
    } else if (options.directoryExists?.(step.cwd) === false) {
      errors.push(`${label}.cwd does not exist: ${step.cwd}.`);
    }
    if (step.command !== "pnpm") {
      errors.push(`${label}.command must be pnpm.`);
    }
    if (
      !Array.isArray(step.args)
      || step.args.length === 0
      || step.args.some((argument) => typeof argument !== "string" || argument.length === 0)
    ) {
      errors.push(`${label}.args must be a nonempty string array.`);
    } else if (step.args.some((argument) => !isSafeCommandArgument(argument))) {
      errors.push(`${label}.args must contain shell-safe non-whitespace tokens.`);
    } else if (typeof step.cwd === "string") {
      const referencedFiles = new Set();
      for (const argument of step.args) {
        if (!isExplicitTestFile(argument)) continue;
        if (referencedFiles.has(argument)) {
          errors.push(`${label}.args must not repeat test file ${argument}.`);
        } else {
          referencedFiles.add(argument);
          if (options.fileExists?.(step.cwd, argument) === false) {
            errors.push(`${label}.args references missing test file ${argument}.`);
          }
        }
      }
    }
  }
}

/**
 * @param {TestLaneManifest} manifest
 * @param {string} selector
 * @returns {readonly TestLane[]}
 */
export function resolveTestLaneSelection(manifest, selector) {
  const laneById = new Map(manifest.lanes.map((lane) => [lane.id, lane]));
  const selectorLaneIds = Object.hasOwn(manifest.selectors, selector)
    ? manifest.selectors[selector]
    : undefined;
  const laneIds = selectorLaneIds ?? (laneById.has(selector) ? [selector] : undefined);
  if (laneIds === undefined) {
    throw new Error(`Unknown test lane selector: ${selector}.`);
  }
  return laneIds.map((laneId) => {
    const lane = laneById.get(laneId);
    if (lane === undefined) throw new Error(`Unknown lane in validated manifest: ${laneId}.`);
    return lane;
  });
}

/**
 * @param {TestLane} lane
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {UnavailableLane | undefined}
 */
export function inspectTestLaneAvailability(lane, environment) {
  const missing = [];
  const mismatched = [];
  for (const prerequisite of lane.prerequisites) {
    const value = environment[prerequisite.name];
    if (value === undefined || value.trim().length === 0) {
      missing.push(prerequisite.name);
    } else if (prerequisite.equals !== undefined && value !== prerequisite.equals) {
      mismatched.push({ name: prerequisite.name, expected: prerequisite.equals });
    }
  }
  return missing.length === 0 && mismatched.length === 0
    ? undefined
    : { laneId: lane.id, missing, mismatched };
}

/**
 * @param {TestLaneManifest} manifest
 * @param {string} selector
 * @param {{
 *   readonly environment: Readonly<Record<string, string | undefined>>;
 *   readonly runStep: (lane: TestLane, step: TestLaneStep) => { readonly exitCode: number; readonly detail?: string };
 *   readonly now?: () => number;
 * }} options
 * @returns {TestLaneReport}
 */
export function executeTestLaneSelection(manifest, selector, options) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const lanes = resolveTestLaneSelection(manifest, selector);
  const selected = lanes.map((lane) => lane.id);
  const unavailable = lanes.flatMap((lane) => {
    const result = inspectTestLaneAvailability(lane, options.environment);
    return result === undefined ? [] : [result];
  });
  if (unavailable.length > 0) {
    return {
      schemaVersion: 1,
      resultScope: "lanes",
      selector,
      status: "unavailable",
      selected,
      passed: [],
      failed: null,
      skipped: lanes
        .filter((lane) => !unavailable.some((entry) => entry.laneId === lane.id))
        .map((lane) => ({ laneId: lane.id, reason: /** @type {const} */ ("unavailable-selection") })),
      unavailable,
      durationMs: nonNegativeDuration(startedAt, now()),
    };
  }

  /** @type {string[]} */
  const passed = [];
  for (const [laneIndex, lane] of lanes.entries()) {
    for (const step of lane.steps) {
      const result = options.runStep(lane, step);
      if (result.exitCode !== 0) {
        return {
          schemaVersion: 1,
          resultScope: "lanes",
          selector,
          status: "failed",
          selected,
          passed,
          failed: {
            laneId: lane.id,
            stepId: step.id,
            exitCode: result.exitCode,
            ...(result.detail === undefined ? {} : { detail: result.detail }),
          },
          skipped: lanes.slice(laneIndex + 1).map((remainingLane) => ({
            laneId: remainingLane.id,
            reason: /** @type {const} */ ("previous-failure"),
          })),
          unavailable: [],
          durationMs: nonNegativeDuration(startedAt, now()),
        };
      }
    }
    passed.push(lane.id);
  }
  return {
    schemaVersion: 1,
    resultScope: "lanes",
    selector,
    status: "passed",
    selected,
    passed,
    failed: null,
    skipped: [],
    unavailable: [],
    durationMs: nonNegativeDuration(startedAt, now()),
  };
}

/** @param {TestLane} lane @param {TestLaneStep} step */
export function runTestLaneStep(lane, step) {
  console.log(`Running ${lane.id}/${step.id}: ${step.command} ${step.args.join(" ")}`);
  const invocation = resolvePnpmInvocation(step.args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: path.join(repositoryRoot, step.cwd),
    env: projectTestLaneEnvironment(lane, process.env),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    return { exitCode: 1, detail: result.error.message };
  }
  return { exitCode: result.status ?? 1 };
}

/**
 * @param {TestLane} lane
 * @param {Readonly<Record<string, string | undefined>>} environment
 */
export function projectTestLaneEnvironment(lane, environment) {
  const projected = { ...environment };
  if (lane.category === "fast" || lane.category === "pglite" || lane.category === "integration") {
    for (const name of Object.keys(projected)) {
      if (name.toUpperCase() === "FLAREX_POSTGRES_DATABASE_URL") delete projected[name];
    }
  }
  return projected;
}

/** @param {readonly string[]} args */
function resolvePnpmInvocation(args) {
  if (process.platform !== "win32") {
    return { command: "pnpm", args: [...args] };
  }
  const commandInterpreter = process.env.ComSpec ?? "cmd.exe";
  return {
    command: commandInterpreter,
    args: ["/d", "/s", "/c", ["pnpm.cmd", ...args].join(" ")],
  };
}

/** @param {TestLaneManifest} manifest */
function projectTestLaneCatalog(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    resultScope: "lanes",
    selectors: manifest.selectors,
    lanes: manifest.lanes.map((lane) => ({
      id: lane.id,
      category: lane.category,
      proof: lane.proof,
      prerequisites: lane.prerequisites.map((prerequisite) => ({
        name: prerequisite.name,
        ...(prerequisite.equals === undefined ? {} : { equals: prerequisite.equals }),
      })),
      steps: lane.steps.map((step) => step.id),
    })),
  };
}

/** @param {number} startedAt @param {number} finishedAt */
function nonNegativeDuration(startedAt, finishedAt) {
  return Math.max(0, finishedAt - startedAt);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
function isIdentifier(value) {
  return typeof value === "string" && idPattern.test(value);
}

/** @param {string} value */
function isSafeRepositoryRelativeDirectory(value) {
  if (value === ".") return true;
  if (value.length === 0 || value.includes("\\") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== ".." && !normalized.startsWith("../");
}

/** @param {string} value */
function isExplicitTestFile(value) {
  return !/[*?[\]{}]/u.test(value)
    && /^(?:test|tests|integration|scripts|tools)\/.+\.(?:test|spec)\.(?:js|ts|tsx)$/u.test(value);
}

/** @param {string} value */
function isSafeCommandArgument(value) {
  return !/[\s"&|<>^%!()]/u.test(value);
}

function isCliEntrypoint() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(path.resolve(entrypoint)).href === import.meta.url;
}
