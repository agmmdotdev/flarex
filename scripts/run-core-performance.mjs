#!/usr/bin/env node
// @ts-check
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { corePerformanceScenarios, selectedCorePerformanceScenarios } from "../packages/executor/test/performance/support/scenarioCatalog.ts";
import { corePerformanceSamplingPlan } from "../packages/executor/test/performance/support/measurementPlan.ts";

const scenarios = corePerformanceScenarios.map(scenario => scenario.name);

/** @param {readonly string[]} args */
export function parseCorePerformanceArguments(args) {
  let scenario = "payload-create";
  let selected = false;
  let all = false;
  let full = false;
  let sql = false;
  let cpu = false;
  let help = false;
  let list = false;
  let daily = false;
  let size = "small";
  let smoke = false;
  let acceptance = false;
  let family;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--scenario") {
      const value = args[++index];
      if (value === undefined || !scenarios.some(name => name === value)) throw new Error("--scenario requires one of: " + scenarios.join(", "));
      if (selected) throw new Error("Specify --scenario once");
      selected = true; scenario = value;
    } else if (argument === "--all") all = true;
    else if (argument === "--daily") daily = true;
    else if (argument === "--list") list = true;
    else if (argument === "--smoke") smoke = true;
    else if (argument === "--acceptance") acceptance = true;
    else if (argument === "--family") {
      const value = args[++index];
      if (family !== undefined || (value !== "product" && value !== "payload" && value !== "mixed")) throw new Error("--family requires product, payload or mixed, once");
      family = value;
    }
    else if (argument === "--size") {
      const value = args[++index];
      if (value !== "small" && value !== "typical") throw new Error("--size requires small or typical");
      size = value;
    }
    else if (argument === "--full") full = true;
    else if (argument === "--sql") sql = true;
    else if (argument === "--cpu") cpu = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else throw new Error("Unknown core performance argument: " + argument);
  }
  if (all && selected) throw new Error("Choose --all or --scenario");
  if (daily && (all || selected)) throw new Error("Choose --daily, --all or --scenario");
  if (family !== undefined && (daily || all || selected)) throw new Error("Choose --family, --daily, --all or --scenario");
  if (smoke && (full || cpu || sql)) throw new Error("--smoke is a one-request correctness check; choose --full, --sql or --cpu separately");
  if (cpu && sql) throw new Error("Choose --cpu or --sql; CPU and SQL diagnostics must run separately");
  if (acceptance && (full || smoke || cpu || sql)) throw new Error("--acceptance requires a separate quiet series; choose iteration or diagnostics separately");
  return { scenario: all ? "all" : daily ? "daily" : family ?? scenario, full, sql, cpu, help, list, size, smoke, acceptance };
}

/** @param {readonly string[]} args */
export function runCorePerformance(args) {
  const started = performance.now();
  const options = parseCorePerformanceArguments(args);
  if (options.help) {
    console.log("pnpm perf:core [--scenario NAME | --family product|payload|mixed | --daily | --all] [--size small|typical] [--smoke | --full | --acceptance] [--sql | --cpu] [--list]");
    console.log("Default: payload-create, 1 warmup + 3 measured requests. --full: 3 warmups + 20 measured. --sql adds one separate diagnostic request.");
    console.log("--cpu profiles each warmed complete request in a fresh report folder; diagnostic latency is not quiet acceptance.");
    console.log("--smoke executes and verifies one real request without warmups; it does not establish latency acceptance.");
    console.log("--acceptance: 5 warmups + 100 quiet measured requests; sampling alone cannot establish paired native-relative acceptance.");
    return 0;
  }
  if (options.list) {
    console.table(corePerformanceScenarios.map(({ name, daily, flow }) => ({ scenario: name, daily, flow })));
    return 0;
  }
  if (!process.env.FLAREX_POSTGRES_DATABASE_URL) throw new Error("FLAREX_POSTGRES_DATABASE_URL is required");
  const require = createRequire(import.meta.url);
  const runner = fileURLToPath(new URL("./vitest.mjs", pathToFileURL(require.resolve("vitest/package.json"))));
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0;
  const runId = randomUUID();
  const reportBase = resolve(cwd, process.env.FLAREX_CORE_PERF_REPORT_DIR ?? "work/validation/core-performance");
  const reportDirectory = options.cpu ? resolve(reportBase, `cpu-${runId}`) : reportBase;
  if (options.cpu) {
    mkdirSync(reportBase, { recursive: true });
    mkdirSync(reportDirectory);
  }
  const result = spawnSync(process.execPath, [runner, "run", "--config", "packages/executor/test/performance/vitest.config.ts"], {
    cwd, stdio: "inherit",
    env: { ...process.env, FLAREX_CORE_PERF: "1", FLAREX_CORE_PERF_SCENARIO: options.scenario,
      FLAREX_CORE_PERF_FULL: options.full ? "1" : "0", FLAREX_CORE_PERF_SQL: options.sql ? "1" : "0",
      FLAREX_CORE_PERF_CPU: options.cpu ? "1" : "0",
      FLAREX_CORE_PERF_SIZE: options.size,
      FLAREX_CORE_PERF_SMOKE: options.smoke ? "1" : "0",
      FLAREX_CORE_PERF_ACCEPTANCE: options.acceptance ? "1" : "0",
      FLAREX_CORE_PERF_REVISION: revision, FLAREX_CORE_PERF_DIRTY: String(dirty),
      FLAREX_CORE_PERF_REPORT_DIR: reportDirectory, FLAREX_CORE_PERF_RUN_ID: runId },
  });
  const names = selectedCorePerformanceScenarios(options.scenario).map(scenario => scenario.name);
  const reports = names.map(name => {
    const path = resolve(reportDirectory, `${name}.json`);
    try {
      /** @type {unknown} */
      const candidate = JSON.parse(readFileSync(path, "utf8"));
      if (typeof candidate !== "object" || candidate === null || !("runId" in candidate) || candidate.runId !== runId)
        throw new Error("No report from this run");
      return { name, path, report: {
        status: "status" in candidate ? candidate.status : null,
        latency: "latency" in candidate ? candidate.latency : null,
        sql: "sql" in candidate ? candidate.sql : null,
        timings: "timings" in candidate ? candidate.timings : null,
        failureStage: "failureStage" in candidate ? candidate.failureStage : null,
        failureTokens: "failureTokens" in candidate ? candidate.failureTokens : null,
        nativeComparison: "nativeComparison" in candidate ? candidate.nativeComparison : null,
        quietSamplingEligible: "quietSamplingEligible" in candidate ? candidate.quietSamplingEligible : false,
      } };
    } catch { return { name, path, report: null }; }
  });
  /** @param {unknown} value @param {string} key */
  const numberField = (value, key) => {
    if (typeof value !== "object" || value === null || !(key in value)) return null;
    const field = Object.entries(value).find(([name]) => name === key)?.[1];
    return typeof field === "number" ? Math.round(field * 10) / 10 : null;
  };
  console.table(reports.map(value => ({ scenario: value.name, status: value.report?.status ?? "missing-report",
    mode: options.smoke ? "smoke" : options.cpu ? "cpu-diagnostic" : "quiet",
    medianMs: numberField(value.report?.latency, "medianMs"), diagnosticSql: numberField(value.report?.sql, "statements"),
    p95Ms: numberField(value.report?.latency, "p95Ms"),
    nativeMedianMs: numberField(value.report?.nativeComparison, "nativeMedianMs"),
    nativeP95Ms: numberField(value.report?.nativeComparison, "nativeP95Ms"),
    nativeAcceptance: typeof value.report?.nativeComparison === "object" && value.report.nativeComparison !== null &&
      "status" in value.report.nativeComparison && value.report.nativeComparison.status === "missing-native-graph"
      ? "missing-native-graph" : "pending-paired-comparison",
    diagnosticTransactions: numberField(value.report?.sql, "transactions"),
    prepareMs: numberField(value.report?.timings, "prepareMs"), scenarioTotalMs: numberField(value.report?.timings, "runnerTotalMs") })));
  for (const report of reports) {
    console.log(`${report.name} report: ${report.path}`);
    if (report.report?.status !== "passed") console.log("CORE_PERFORMANCE_FAILURE " + JSON.stringify({
      scenario: report.name, stage: report.report?.failureStage ?? "missing-report", tokens: report.report?.failureTokens ?? [] }));
  }
  const receipt = { runId, revision, dirty, selection: options.scenario, size: options.size,
    measurementMode: options.smoke ? "smoke" : options.cpu ? "cpu-diagnostic" : "quiet",
    samplingPlan: corePerformanceSamplingPlan(options),
    quietSamplingEligible: result.status === 0 && reports.every(report => report.report?.status === "passed" && report.report.quietSamplingEligible === true),
    quietAcceptance: false, nativeRelativeAcceptance: "pending-paired-comparison", totalMs: performance.now() - started,
    exitCode: result.status, signal: result.signal, reports: reports.map(report => ({ name: report.name,
      path: report.path, available: report.report !== null })) };
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(resolve(reportDirectory, "command.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("CORE_PERFORMANCE_COMMAND " + JSON.stringify(receipt));
  if (result.error !== undefined) throw result.error;
  return result.status === 0 && reports.every(report => report.report?.status === "passed") ? 0 : result.status || 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = runCorePerformance(process.argv.slice(2)); }
  catch (cause) { console.error(cause instanceof Error ? cause.message : "Core performance runner failed"); process.exitCode = 1; }
}
