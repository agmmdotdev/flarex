import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createMixedMutationPerformanceTrace } from "../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { failureTokens, latencySummary, sqlSummary } from "./support/measurement";
import type { CorePerformanceScenario, CorePerformanceScenarioName } from "./support/scenario";

const names: readonly CorePerformanceScenarioName[] = ["payload-create", "medusa-workflow", "mixed-product", "mixed-payload", "mixed-workflow"];
const selected = process.env.FLAREX_CORE_PERF_SCENARIO ?? "payload-create";
const full = process.env.FLAREX_CORE_PERF_FULL === "1";
const sql = process.env.FLAREX_CORE_PERF_SQL === "1";
const plan = full ? { warmups: 3, measured: 20 } : { warmups: 1, measured: 3 };
const enabled = process.env.FLAREX_CORE_PERF === "1";
const decodeEnvironment = Schema.decodeUnknownSync(Schema.Struct({
  postgresVersion: Schema.String, role: Schema.String, superuser: Schema.Boolean,
  bypassRls: Schema.Boolean, createDb: Schema.Boolean, createRole: Schema.Boolean,
  synchronousCommit: Schema.String, fsync: Schema.String, fullPageWrites: Schema.String,
}));
const chosen = selected === "all" ? names : names.filter(name => name === selected);
if (enabled && chosen.length === 0) throw new Error("Unknown core performance scenario");

async function loadScenario(name: CorePerformanceScenarioName) {
  if (name === "payload-create") return (await import("./support/payloadScenario")).prepareStandalonePayloadScenario;
  if (name === "medusa-workflow") return (await import("./support/medusaScenario")).prepareStandaloneMedusaScenario;
  const { prepareMixedScenario } = await import("./support/mixed");
  return () => prepareMixedScenario(name, plan.warmups + plan.measured + (sql ? 1 : 0));
}

describe.skipIf(!enabled)("direct core performance", () => {
  for (const name of chosen) it(name, async () => {
    const runnerStarted = performance.now();
    const measured: number[] = [];
    const samples: Array<Readonly<{ id: string; kind: "warmup" | "measured" | "sql";
      requestMs: number | null; seedMs: number; verifyMs: number; cleanupMs: number;
      failureStage: string | null; failureTokens: readonly string[] }>> = [];
    let resource: CorePerformanceScenario | undefined;
    let primaryFailure: unknown;
    let failed = false;
    let stage = "load";
    let loadMs = 0;
    let prepareMs = 0;
    let cleanupMs = 0;
    let diagnostic: ReturnType<typeof sqlSummary> | null = null;
    let environment: ReturnType<typeof decodeEnvironment> | null = null;
    try {
      let create: Awaited<ReturnType<typeof loadScenario>>;
      try { create = await loadScenario(name); }
      finally { loadMs = performance.now() - runnerStarted; }
      stage = "prepare";
      const prepareStarted = performance.now();
      try { resource = await create(); }
      finally { prepareMs = performance.now() - prepareStarted; }
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
        const kind = sql && index === 0 ? "sql" : quietIndex < plan.warmups ? "warmup" : "measured";
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
        const trace = kind === "sql" ? createMixedMutationPerformanceTrace(resource.pools) : undefined;
        resource.setTrace?.(trace);
        try {
          stage = "invoke";
          const requestStarted = performance.now();
          let result: unknown;
          try { result = trace === undefined ? await sample.run() : await trace.withInvocation({ id, mode: "measured" }, sample.run); }
          finally { requestMs = performance.now() - requestStarted; }
          stage = "verify";
          const verifyStarted = performance.now();
          await sample.verify(result);
          verifyMs = performance.now() - verifyStarted;
        } catch (cause) { sampleFailed = true; sampleFailure = cause; failureStage = stage; }
        finally {
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
            failureStage, failureTokens: sampleFailed ? failureTokens(sampleFailure) : [] });
        }
        if (sampleFailed) throw sampleFailure;
        if (kind === "measured" && requestMs !== null) measured.push(requestMs);
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
      const report = { runId: process.env.FLAREX_CORE_PERF_RUN_ID ?? null, scenario: name, full, plan,
        status: failed ? "failed" : "passed", failureStage: failed ? stage : null,
        failureTokens: failed ? failureTokens(primaryFailure) : [], method: "Node direct execution; fresh requests; real settlement; separate single SQL diagnostic",
        environment: { node: process.version, postgres: environment,
          revision: process.env.FLAREX_CORE_PERF_REVISION ?? null, dirty: process.env.FLAREX_CORE_PERF_DIRTY ?? null },
        latency: latencySummary(measured, full), sql: diagnostic,
        timings: { loadMs, prepareMs, preparation: resource?.timings ?? null, cleanupMs, runnerTotalMs: performance.now() - runnerStarted }, samples };
      const directory = resolve(process.env.FLAREX_CORE_PERF_REPORT_DIR ?? "work/validation/core-performance");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, `${name}.json`), JSON.stringify(report, null, 2) + "\n");
      console.log("CORE_PERFORMANCE " + JSON.stringify(report));
    }
    if (failed) throw primaryFailure;
  }, 240_000);
});
