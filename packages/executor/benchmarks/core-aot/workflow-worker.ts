import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { Schema } from "effect";
import { prepareProductWorkflowScenario } from "./workflow-scenario";
import { maxCorePerformanceSeriesSamples } from "../../test/performance/support/measurementPlan";
import { ServerObservation, type RequestMeasurement } from "./contract";
import { WorkflowWorkerResult as RequestWorkerResult } from "./workflow-contract";
import type { BenchmarkCpuProfiler } from "../../test/performance/support/benchmarkCpuProfiler";

const { values } = parseArgs({ options: { samples: { type: "string", default: "30" },
  warmups: { type: "string", default: "5" }, "profile-dir": { type: "string" }, products: { type: "string", default: "1" } } });
const samples = Number(values.samples), warmups = Number(values.warmups);
const products = Number(values.products);
assert(products === 1 || products === 4);
assert(Number.isSafeInteger(samples) && samples > 0);
assert(Number.isSafeInteger(warmups) && warmups >= 0 && samples + warmups <= maxCorePerformanceSeriesSamples);
assert(process.env.FLAREX_POSTGRES_DATABASE_URL, "Ordinary PostgreSQL endpoint is required");
assert(process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL, "Provisioning PostgreSQL endpoint is required");
const decodeServer = Schema.decodeUnknownSync(Schema.Array(ServerObservation));
const versions = Schema.decodeUnknownSync(RequestWorkerResult.fields.versions)(process.versions);
let server: typeof ServerObservation.Type | null = null;
let failureStage: string | null = "server-observation";
const measurements: RequestMeasurement[] = [];
const profiles: (typeof RequestWorkerResult.Type)["profiles"][number][] = [];
let profiler: BenchmarkCpuProfiler | undefined;
let summarizeProfile: typeof import("../../test/performance/support/benchmarkCpuProfiler")["summarizeBenchmarkCpuProfile"] | undefined;
const profileDirectory = values["profile-dir"] === undefined ? undefined : resolve(values["profile-dir"]);
if (profileDirectory !== undefined) {
  assert.equal(process.versions.bun, undefined, "Request inspector profiling is Node-only; run quiet Bun AOT separately");
  await mkdir(profileDirectory, { recursive: true });
  assert.equal((await readdir(profileDirectory)).length, 0, "Profile directory must be empty");
  const profiling = await import("../../test/performance/support/benchmarkCpuProfiler");
  profiler = new profiling.BenchmarkCpuProfiler();
  summarizeProfile = profiling.summarizeBenchmarkCpuProfile;
}
let scenario: Awaited<ReturnType<typeof prepareProductWorkflowScenario>> | undefined;
let failure: unknown;
let publicationVerified = false;
const observer = new Pool({ connectionString: process.env.FLAREX_POSTGRES_DATABASE_URL, max: 1 });
try {
  const observed = await observer.query(`SELECT current_setting('server_version') AS version,
    current_database() AS database, current_user AS role,
    current_setting('fsync') AS fsync, current_setting('full_page_writes') AS "fullPageWrites",
    current_setting('synchronous_commit') AS "synchronousCommit", rolsuper AS superuser,
    rolbypassrls AS "bypassRls", rolcreatedb AS "createDb", rolcreaterole AS "createRole",
    rolreplication AS replication FROM pg_roles WHERE rolname = current_user`);
  const [observedServer] = decodeServer(observed.rows);
  assert(observedServer !== undefined && !observedServer.superuser && !observedServer.bypassRls && !observedServer.createDb
    && !observedServer.createRole && !observedServer.replication, "Benchmark requires an ordinary runtime role");
  server = observedServer;
  assert.equal(server.fsync, "on"); assert.equal(server.fullPageWrites, "on"); assert.equal(server.synchronousCommit, "on");
  // The real fixture independently verifies serving-role capabilities as well.
  failureStage = "prepare";
  scenario = await prepareProductWorkflowScenario(products);
  for (let index = 0; index < samples + warmups; index++) {
    failureStage = `prepare-sample-${index}`;
    const sample = await scenario.prepareSample(`core-aot-${index}`, index);
    let sampleFailure: unknown;
    try {
      failureStage = `run-${index}`;
      let value: unknown;
      let completed = false;
      let requestFailure: unknown;
      const profile = index >= warmups ? profiler : undefined;
      if (profile !== undefined) await profile.start();
      const beforeCpu = process.cpuUsage();
      const before = performance.now();
      let row: RequestMeasurement;
      try { value = await sample.run(); completed = true; }
      catch (cause) { requestFailure = cause; }
      finally {
        const wallMs = performance.now() - before, cpu = process.cpuUsage(beforeCpu);
        row = { index, phase: index < warmups ? "warmup" : "measured", wallMs,
          userCpuMs: cpu.user / 1000, systemCpuMs: cpu.system / 1000, completed, verified: false };
        measurements.push(row);
      }
      if (profile !== undefined) try {
        const raw = await profile.stop();
        assert(profileDirectory !== undefined && summarizeProfile !== undefined);
        const file = resolve(profileDirectory, `request-${index}.cpuprofile`), bytes = JSON.stringify(raw);
        await writeFile(file, bytes);
        await writeFile(`${file}.summary.json`, JSON.stringify(summarizeProfile(raw), null, 2));
        profiles.push({ index, file, sha256: createHash("sha256").update(bytes).digest("hex"),
          samples: raw.samples?.length ?? 0, spanUs: raw.endTime - raw.startTime });
      } catch (cause) { requestFailure = requestFailure === undefined ? cause : new AggregateError([requestFailure, cause], "Request and profiling failed"); }
      if (requestFailure !== undefined) throw requestFailure;
      failureStage = `verify-${index}`;
      await sample.verify(value);
      // Owned measurement state, updated only after the existing committed reads pass.
      measurements[measurements.length - 1] = { ...row, verified: true };
    } catch (cause) { sampleFailure = cause; }
    try { await sample.cleanup(); }
    catch (cause) { sampleFailure = sampleFailure === undefined ? cause : new AggregateError([sampleFailure, cause], "Request and cleanup failed"); }
    if (sampleFailure !== undefined) throw sampleFailure;
  }
  failureStage = "verify-publications";
  await scenario.verifyPublications();
  publicationVerified = true;
} catch (cause) { failure = cause; }
try { if (profiler !== undefined) await profiler.dispose(); }
catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], "Request benchmark and profiler disposal failed"); }
try { if (scenario !== undefined) await scenario.dispose(); }
catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], "Request benchmark and owner disposal failed"); }
try { await observer.end(); }
catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], "Request benchmark and observer disposal failed"); }
const result: typeof RequestWorkerResult.Type = {
  status: failure === undefined ? "passed" : "failed", versions, driver: "postgres", scenario: "product-workflow",
  productsPerRequest: products, workload: scenario?.workload ?? null, timings: scenario?.timings ?? null,
  publicationVerified,
  measurementMode: profileDirectory === undefined ? "quiet" : "cpu-diagnostic",
  warmups, samples, server, measurements, failureStage: failure === undefined ? null : failureStage,
  disposed: failure === undefined, profiles,
};
process.stdout.write(JSON.stringify(result));
if (failure !== undefined) { console.error(failure); process.exitCode = 1; }
