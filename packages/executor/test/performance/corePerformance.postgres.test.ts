import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Schema } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { createMixedMutationPerformanceTrace } from "../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { failureTokens, latencySummary, sqlSummary } from "./support/measurement";
import type { CorePerformanceScenario } from "./support/scenario";
import { BenchmarkCpuProfiler, summarizeBenchmarkCpuProfile, type BenchmarkCpuProfileEvidence } from "./support/benchmarkCpuProfiler";
import { selectedCorePerformanceScenarios, type CorePerformanceFamily, type CorePerformanceSize } from "./support/scenarioCatalog";
import { performanceFamilyLifetime } from "./support/scenarioLifetime";
import { prepareCorePerformanceFamily } from "./support/prepareScenario";
import { loadNativeBusinessReference, nativeBusinessComparison, quietSamplingEligible } from "./support/nativeBusinessReference";
import { corePerformanceSamplingPlan } from "./support/measurementPlan";

const selected = process.env.FLAREX_CORE_PERF_SCENARIO ?? "payload-create";
const full = process.env.FLAREX_CORE_PERF_FULL === "1";
const sql = process.env.FLAREX_CORE_PERF_SQL === "1";
const cpu = process.env.FLAREX_CORE_PERF_CPU === "1";
const smoke = process.env.FLAREX_CORE_PERF_SMOKE === "1";
const acceptance = process.env.FLAREX_CORE_PERF_ACCEPTANCE === "1";
const sizeInput = process.env.FLAREX_CORE_PERF_SIZE ?? "small";
if (sizeInput !== "small" && sizeInput !== "typical") throw new Error("Unknown measurement size");
const size: CorePerformanceSize = sizeInput;
const plan = corePerformanceSamplingPlan({ acceptance, smoke, full });
const enabled = process.env.FLAREX_CORE_PERF === "1";
const decodeEnvironment = Schema.decodeUnknownSync(Schema.Struct({
  postgresVersion: Schema.String, role: Schema.String, superuser: Schema.Boolean,
  bypassRls: Schema.Boolean, createDb: Schema.Boolean, createRole: Schema.Boolean,
  synchronousCommit: Schema.String, fsync: Schema.String, fullPageWrites: Schema.String,
}));
const chosen = selectedCorePerformanceScenarios(selected);
if (enabled && chosen.length === 0) throw new Error("Unknown core performance scenario");
if (enabled && cpu && sql) throw new Error("CPU and SQL diagnostics must run separately");
if (enabled && smoke && (full || sql || cpu)) throw new Error("Smoke and diagnostic/acceptance plans must run separately");
if (enabled && acceptance && (full || smoke || sql || cpu)) throw new Error("Acceptance sampling requires a separate quiet series");
const nativeReference = enabled ? loadNativeBusinessReference() : undefined;

describe.skipIf(!enabled)("direct core performance", () => {
  const plannedUses = new Map<CorePerformanceFamily, number>();
  for (const descriptor of chosen) plannedUses.set(descriptor.family, (plannedUses.get(descriptor.family) ?? 0) + 1);
  const families = performanceFamilyLifetime(family => prepareCorePerformanceFamily(family, {
    driver: "postgres", size, sampleCount: plan.warmups + plan.measured + (sql ? 1 : 0),
  }), plannedUses);
  afterAll(async () => {
    const started = performance.now();
    let failure: unknown;
    let failed = false;
    try { await families.close(); } catch (cause) { failure = cause; failed = true; }
    const directory = resolve(process.env.FLAREX_CORE_PERF_REPORT_DIR ?? "work/validation/core-performance");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "families.json"), JSON.stringify({ runId: process.env.FLAREX_CORE_PERF_RUN_ID,
      cleanupMs: performance.now() - started, status: failed ? "failed" : "passed",
      failureTokens: failed ? failureTokens(failure) : [] }, null, 2) + "\n");
    if (failed) throw failure;
  });
  for (const descriptor of chosen) it(descriptor.name, async () => {
    const { name, family } = descriptor;
    const runnerStarted = performance.now();
    const measured: number[] = [];
    const directory = resolve(process.env.FLAREX_CORE_PERF_REPORT_DIR ?? "work/validation/core-performance");
    const samples: Array<Readonly<{ id: string; kind: "warmup" | "measured" | "sql" | "cpu";
      requestMs: number | null; seedMs: number; verifyMs: number; cleanupMs: number;
      failureStage: string | null; failureTokens: readonly string[];
      cpuProfile?: BenchmarkCpuProfileEvidence | null;
      cpuFailure?: Readonly<{ stage: string; tokens: readonly string[] }> | null }>> = [];
    let resource: CorePerformanceScenario | undefined;
    let primaryFailure: unknown;
    let failed = false;
    let stage = "prepare";
    let prepareMs = 0;
    let cleanupMs = 0;
    let diagnostic: ReturnType<typeof sqlSummary> | null = null;
    let environment: ReturnType<typeof decodeEnvironment> | null = null;
    try {
      stage = "prepare";
      const prepareStarted = performance.now();
      try { resource = await families.acquire(family, name); }
      finally { prepareMs = performance.now() - prepareStarted; }
      if (resource.pools === undefined) throw new Error("PostgreSQL measurement requires PostgreSQL pools");
      stage = "environment";
      environment = decodeEnvironment((await resource.pools.targetPool.query(`select
        current_setting('server_version') as "postgresVersion", current_user as role,
        rolsuper as superuser, rolbypassrls as "bypassRls", rolcreatedb as "createDb", rolcreaterole as "createRole",
        current_setting('synchronous_commit') as "synchronousCommit", current_setting('fsync') as fsync,
        current_setting('full_page_writes') as "fullPageWrites" from pg_roles where rolname = current_user`)).rows[0]);
      expect(environment).toMatchObject({ superuser: false, bypassRls: false, createDb: false, createRole: false,
        synchronousCommit: "on", fsync: "on", fullPageWrites: "on" });
      for (let index = 0; index < plan.warmups + plan.measured + (sql ? 1 : 0); index++) {
        const quietIndex = index - (sql ? 1 : 0);
        const kind = sql && index === 0 ? "sql" : quietIndex < plan.warmups ? "warmup" : cpu ? "cpu" : "measured";
        const id = `${name}-${kind}-${index}`;
        const sampleStarted = performance.now();
        stage = "seed";
        const sample = await resource.prepareSample(id, index);
        const seedMs = performance.now() - sampleStarted;
        let requestMs: number | null = null;
        let verifyMs = 0;
        let sampleCleanupMs = 0;
        let sampleFailed = false;
        let sampleFailure: unknown;
        let failureStage: string | null = null;
        const profiler = kind === "cpu" ? new BenchmarkCpuProfiler() : undefined;
        let cpuProfile: BenchmarkCpuProfileEvidence | null = null;
        let cpuFailure: Readonly<{ stage: string; tokens: readonly string[] }> | null = null;
        const trace = kind === "sql" ? createMixedMutationPerformanceTrace(resource.pools) : undefined;
        resource.setTrace?.(trace);
        try {
          if (profiler !== undefined) {
            stage = "cpuStart";
            await profiler.start();
          }
          stage = "invoke";
          const requestStarted = performance.now();
          let result: unknown;
          try { result = trace === undefined ? await sample.run() : await trace.withInvocation({ id, mode: "measured" }, sample.run); }
          catch (cause) { sampleFailed = true; sampleFailure = cause; failureStage = stage; }
          finally { requestMs = performance.now() - requestStarted; }
          // Inspector lifecycle and profile persistence are outside the request
          // timer, while its raw profile retains startup/stop/idle/GC samples.
          if (profiler !== undefined) {
            stage = "cpuStop";
            try {
              const profile = await profiler.stop();
              const file = `${id}.cpuprofile`;
              const bytes = JSON.stringify(profile);
              await mkdir(directory, { recursive: true });
              await writeFile(resolve(directory, file), bytes, { flag: "wx" });
              cpuProfile = { file, sha256Hex: createHash("sha256").update(bytes).digest("hex"),
                ...summarizeBenchmarkCpuProfile(profile) };
            } catch (cause) {
              cpuFailure = { stage, tokens: failureTokens(cause) };
              sampleFailure = sampleFailed ? new AggregateError([sampleFailure, cause], "Request and CPU profile failed") : cause;
              sampleFailed = true; failureStage ??= stage;
            }
          }
          if (sampleFailed) throw sampleFailure;
          stage = "verify";
          const verifyStarted = performance.now();
          await sample.verify(result);
          verifyMs = performance.now() - verifyStarted;
        } catch (cause) {
          if (stage === "cpuStart") cpuFailure = { stage, tokens: failureTokens(cause) };
          sampleFailed = true; sampleFailure = cause; failureStage ??= stage; stage = failureStage;
        }
        finally {
          try { await profiler?.dispose(); }
          catch (cause) {
            cpuFailure = { stage: cpuFailure?.stage ?? "cpuCleanup",
              tokens: [...(cpuFailure?.tokens ?? []), ...failureTokens(cause)] };
            sampleFailure = sampleFailed ? new AggregateError([sampleFailure, cause], "Sample and CPU cleanup failed") : cause;
            sampleFailed = true; failureStage ??= "cpuCleanup";
          }
          if (trace !== undefined) {
            const record = trace.records()[0];
            if (record !== undefined) diagnostic = sqlSummary(record);
            trace.close();
            resource.setTrace?.(undefined);
          }
          const cleanupStarted = performance.now();
          try { await sample.cleanup(); }
          catch (cause) {
            sampleFailure = sampleFailed ? new AggregateError([sampleFailure, cause], "Sample and cleanup failed") : cause;
            sampleFailed = true; failureStage ??= "sampleCleanup";
          } finally { sampleCleanupMs = performance.now() - cleanupStarted; }
          samples.push({ id, kind, requestMs, seedMs, verifyMs, cleanupMs: sampleCleanupMs,
            failureStage, failureTokens: sampleFailed ? failureTokens(sampleFailure) : [],
            ...(profiler === undefined ? {} : { cpuProfile, cpuFailure }) });
        }
        if (sampleFailed) throw sampleFailure;
        if ((kind === "measured" || kind === "cpu") && requestMs !== null) measured.push(requestMs);
        if (kind === "sql") {
          stage = "sqlCoverage";
          expect(diagnostic).not.toBeNull();
          expect(diagnostic).toMatchObject({ outcome: "ok", queryErrors: 0, lostContextDispatches: 0,
            unknownStatementDispatches: 0, unobservedDispatches: 0, incompleteSpans: 0, openTransactions: 0 });
          expect(diagnostic?.dispatches).toBeGreaterThan(0);
        }
      }
    } catch (cause) { failed = true; primaryFailure = cause; }
    finally {
      const cleanupStarted = performance.now();
      try { await resource?.dispose(); }
      catch (cause) { primaryFailure = failed ? new AggregateError([primaryFailure, cause], "Scenario and cleanup failed") : cause;
        if (!failed) stage = "resourceCleanup";
        failed = true; }
      cleanupMs = performance.now() - cleanupStarted;
      const latency = latencySummary(measured, full || acceptance);
      const report = { runId: process.env.FLAREX_CORE_PERF_RUN_ID ?? null, scenario: name, full, smoke, acceptance, size, plan,
        workload: resource?.workload ?? { flow: descriptor.flow, cardinality: null }, preparationReuse: resource?.preparationReuse,
        measurementMode: smoke ? "smoke" : cpu ? "cpu-diagnostic" : "quiet", quietAcceptance: false,
        quietSamplingEligible: quietSamplingEligible(plan, measured.length, failed, cpu, smoke),
        nativeComparison: nativeReference === undefined ? null : nativeBusinessComparison(nativeReference, name, size, latency),
        status: failed ? "failed" : "passed", failureStage: failed ? stage : null,
        failureTokens: failed ? failureTokens(primaryFailure) : [],
        method: cpu ? "Node direct execution; separate prepared seeds and warmup; each complete admitted request independently CPU profiled; real settlement"
          : "Node direct execution; fresh requests; real settlement; separate single SQL diagnostic",
        ...(cpu ? { cpuLimitations: [
          "Inspector perturbs request timing; these measurements are diagnostic and cannot satisfy quiet acceptance.",
          "Raw profiles preserve original timestamps and timeDeltas, including inspector startup/stop, idle and GC.",
          "Requested sampling interval is not the observed interval; sampled self-frame counts are not exclusive CPU time.",
          "Profiles observe this Node isolate, not PostgreSQL server CPU; SQL subtraction cannot establish exclusive CPU attribution.",
        ] } : {}),
        environment: { node: process.version, postgres: environment,
          revision: process.env.FLAREX_CORE_PERF_REVISION ?? null, dirty: process.env.FLAREX_CORE_PERF_DIRTY ?? null },
        latency, sql: diagnostic,
        timings: { loadMs: null, prepareMs, preparation: resource?.preparationReuse?.reused ? null : resource?.timings ?? null,
          cleanupMs, sharedCleanupReport: "families.json", runnerTotalMs: performance.now() - runnerStarted }, samples };
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, `${name}.json`), JSON.stringify(report, null, 2) + "\n");
      console.log("CORE_PERFORMANCE " + JSON.stringify(report));
    }
    if (failed) throw primaryFailure;
  }, 240_000);
});
