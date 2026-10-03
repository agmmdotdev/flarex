#!/usr/bin/env node
// @ts-check
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scenarios = ["payload-create", "medusa-workflow", "mixed-product", "mixed-payload", "mixed-workflow"];

/** @param {readonly string[]} args */
export function parseCorePerformanceArguments(args) {
  let scenario = "payload-create";
  let selected = false;
  let all = false;
  let full = false;
  let sql = false;
  let help = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--scenario") {
      const value = args[++index];
      if (value === undefined || !scenarios.includes(value)) throw new Error("--scenario requires one of: " + scenarios.join(", "));
      if (selected) throw new Error("Specify --scenario once");
      selected = true; scenario = value;
    } else if (argument === "--all") all = true;
    else if (argument === "--full") full = true;
    else if (argument === "--sql") sql = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else throw new Error("Unknown core performance argument: " + argument);
  }
  if (all && selected) throw new Error("Choose --all or --scenario");
  return { scenario: all ? "all" : scenario, full, sql, help };
}

/** @param {readonly string[]} args */
export function runCorePerformance(args) {
  const started = performance.now();
  const options = parseCorePerformanceArguments(args);
  if (options.help) {
    console.log("pnpm perf:core [--scenario " + scenarios.join("|") + "] [--all] [--full] [--sql]");
    console.log("Default: payload-create, 1 warmup + 3 measured requests. --full: 3 warmups + 20 measured. --sql adds one separate diagnostic request.");
    return 0;
  }
  if (!process.env.FLAREX_POSTGRES_DATABASE_URL) throw new Error("FLAREX_POSTGRES_DATABASE_URL is required");
  const require = createRequire(import.meta.url);
  const runner = fileURLToPath(new URL("./vitest.mjs", pathToFileURL(require.resolve("vitest/package.json"))));
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0;
  const runId = randomUUID();
  const reportDirectory = resolve(cwd, process.env.FLAREX_CORE_PERF_REPORT_DIR ?? "work/validation/core-performance");
  const result = spawnSync(process.execPath, [runner, "run", "--config", "packages/executor/test/performance/vitest.config.ts"], {
    cwd, stdio: "inherit",
    env: { ...process.env, FLAREX_CORE_PERF: "1", FLAREX_CORE_PERF_SCENARIO: options.scenario,
      FLAREX_CORE_PERF_FULL: options.full ? "1" : "0", FLAREX_CORE_PERF_SQL: options.sql ? "1" : "0",
      FLAREX_CORE_PERF_REVISION: revision, FLAREX_CORE_PERF_DIRTY: String(dirty),
      FLAREX_CORE_PERF_REPORT_DIR: reportDirectory, FLAREX_CORE_PERF_RUN_ID: runId },
  });
  const names = options.scenario === "all" ? scenarios : [options.scenario];
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
    medianMs: numberField(value.report?.latency, "medianMs"), diagnosticSql: numberField(value.report?.sql, "statements"),
    diagnosticTransactions: numberField(value.report?.sql, "transactions"),
    prepareMs: numberField(value.report?.timings, "prepareMs"), scenarioTotalMs: numberField(value.report?.timings, "runnerTotalMs") })));
  for (const report of reports) {
    console.log(`${report.name} report: ${report.path}`);
    if (report.report?.status !== "passed") console.log("CORE_PERFORMANCE_FAILURE " + JSON.stringify({
      scenario: report.name, stage: report.report?.failureStage ?? "missing-report", tokens: report.report?.failureTokens ?? [] }));
  }
  const receipt = { runId, revision, dirty, totalMs: performance.now() - started,
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
