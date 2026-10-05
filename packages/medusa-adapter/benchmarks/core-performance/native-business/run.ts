import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Schema } from "effect";
import { baselineFlows, prepareNativeBusiness } from "./native";
import { latencySummary, failureTokens } from "../../../../executor/test/performance/support/measurement";

const count = Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 1000 })));
const samples = count(process.env.NATIVE_BUSINESS_SAMPLES ?? "30");
const warmups = count(process.env.NATIVE_BUSINESS_WARMUPS ?? "5");
assert.ok(samples > 0);
const selected = process.env.NATIVE_BUSINESS_FLOW ?? "all";
const flows = baselineFlows.filter(value => selected === "all" || value === selected);
assert.ok(flows.length > 0, "Unknown native baseline flow");
const medusaUrl = process.env.NATIVE_BUSINESS_MEDUSA_URL;
const payloadUrl = process.env.NATIVE_BUSINESS_PAYLOAD_URL;
assert.ok(medusaUrl !== undefined && payloadUrl !== undefined, "Set two isolated ordinary-role native database URLs");
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(import.meta.url);
const runId = randomUUID();
const outputPath = new URL(`./reports/${runId}.json.gz`, import.meta.url);
const timings: Record<string, number> = {};
const results: Array<{ flow: string; warmup: boolean; index: number; elapsedMs: number | null; result?: unknown;
  outcome: "success" | "failure"; stage: string; failureTokens?: readonly string[];
  verificationMs: number; seedMs: number; cleanupMs: number }> = [];
let stage = "preparation";
let resource: Awaited<ReturnType<typeof prepareNativeBusiness>> | undefined;
let error: unknown;
let settingsAfter: Awaited<ReturnType<Awaited<ReturnType<typeof prepareNativeBusiness>>["readSettings"]>> | undefined;
const started = performance.now();
let before: Record<string, string> | undefined;
let measuredBefore: typeof before;
let after: typeof before;
let cleanup: "not-acquired" | "completed" | "failed" | "unconfirmed" = "not-acquired";
// A stalled driver cannot prevent retention indefinitely. Forced termination
// saves partial evidence and relies on process exit to close sockets; it never
// claims that native cleanup or an uncertain native commit was confirmed.
const deadline = setTimeout(() => terminate("deadline"), 180_000);
deadline.unref();
process.once("SIGINT", () => terminate("SIGINT"));
process.once("SIGTERM", () => terminate("SIGTERM"));
try {
  before = await fingerprints();
  resource = await prepareNativeBusiness(medusaUrl, payloadUrl);
  cleanup = "unconfirmed";
  timings.preparationMs = performance.now() - started;
  measuredBefore = await fingerprints();
  stage = "measurement";
  for (const flow of flows) {
    for (let index = 0; index < warmups + samples; index++) {
      const record: typeof results[number] = { flow, warmup: index < warmups, index, elapsedMs: null,
        outcome: "failure", stage: "seeding", verificationMs: 0, seedMs: 0, cleanupMs: 0 };
      results.push(record);
      const seedStarted = performance.now();
      let sample: Awaited<ReturnType<typeof resource.prepareSample>>;
      try { sample = await resource.prepareSample(flow, `${runId.slice(0, 8)}-${flow}-${index}`); }
      catch (failure) { record.seedMs = performance.now() - seedStarted; record.failureTokens = failureTokens(failure); throw failure; }
      record.seedMs = performance.now() - seedStarted;
      let sampleError: unknown;
      const requestStarted = performance.now();
      try {
        record.stage = "request";
        const result = await sample.run();
        record.elapsedMs = performance.now() - requestStarted; record.result = result;
        record.stage = "verification";
        const verificationStarted = performance.now();
        await sample.verify();
        record.verificationMs = performance.now() - verificationStarted;
        record.outcome = "success";
      } catch (failure) { sampleError = failure; record.failureTokens = failureTokens(failure);
        if (record.elapsedMs === null) record.elapsedMs = performance.now() - requestStarted; }
      const cleanupStarted = performance.now();
      try { await sample.cleanup(); } catch (failure) {
        sampleError = sampleError === undefined ? failure : new AggregateError([sampleError, failure], "Native request and cleanup failed");
        record.outcome = "failure"; record.stage = "cleanup"; record.failureTokens = failureTokens(sampleError);
      }
      record.cleanupMs = performance.now() - cleanupStarted;
      if (sampleError === undefined) record.stage = "complete";
      if (sampleError !== undefined) throw sampleError;
    }
  }
  stage = "settingsAfter";
  settingsAfter = await resource.readSettings();
  assert.deepEqual(settingsAfter, resource.settings);
} catch (failure) { error = failure; }
const cleanupStarted = performance.now();
try { await resource?.dispose(); if (resource !== undefined) cleanup = "completed"; } catch (failure) {
  cleanup = "failed";
  error = error === undefined ? failure : new AggregateError([error, failure], "Native run and cleanup failed");
}
timings.disposalMs = performance.now() - cleanupStarted;
timings.commandMs = performance.now() - started;
try {
  after = await fingerprints();
  for (const [file, hash] of Object.entries(measuredBefore ?? before ?? {})) {
    if (after[file] !== hash) { stage = "sourcesAfter"; error = new Error(`Native source changed during measurement: ${file}`, { cause: error }); }
  }
} catch (failure) {
  stage = "sourcesAfter";
  error = error === undefined ? failure : new AggregateError([error, failure], "Native run and source inventory failed");
}
if (error === undefined) stage = "complete";
writeReceipt();
clearTimeout(deadline);
if (error !== undefined) throw error;

function terminate(reason: string): never {
  stage = reason; cleanup = "unconfirmed";
  timings.commandMs = performance.now() - started;
  error = new Error(`Native baseline terminated: ${reason}; native cleanup and pending commit outcomes are unconfirmed`, { cause: error });
  try { writeReceipt(); } finally { process.exit(1); }
}

function writeReceipt() {
const summaries = flows.map(flow => {
  const values = results.filter(value => value.flow === flow && !value.warmup && value.outcome === "success")
    .flatMap(value => value.elapsedMs === null ? [] : [value.elapsedMs]);
  const summary = latencySummary(values, true);
  return { flow, retainedSamples: values.length, medianMs: summary?.medianMs ?? null, p95Ms: summary?.p95Ms ?? null, maximumMs: summary?.maxMs ?? null };
});
mkdirSync(new URL("./reports/", import.meta.url), { recursive: true });
writeFileSync(outputPath, gzipSync(JSON.stringify({ runId, complete: error === undefined, stage, cleanup,
  acceptanceSampling: samples >= 30 && warmups >= 5, environment: { node: process.version, platform: process.platform },
  profile: "warm native business graph; independent framework commits; PostgreSQL Application insert/patch surrogate",
  guarantees: { atomicMixedRoot: false, applicationOCC: false, revisionHistory: false, durableFlarexOutcome: false,
    nativeHooksAndCommits: true, frameworkEventDelivery: "pinned mock event bus; native emit calls, no external delivery" },
  warmups, samples, settingsBefore: resource?.settings, settingsAfter, timings, summaries, results,
  sourcesBefore: before, sourcesBeforeMeasurement: measuredBefore, sourcesAfter: after,
  error: error === undefined ? null : { stage, tokens: failureTokens(error) },
}, null, 2) + "\n"), { flag: "wx" });
console.log(JSON.stringify({ report: path.relative(root, fileURLToPath(outputPath)), complete: error === undefined, summaries }));
}

async function fingerprints() {
  // Inventory actual native CommonJS modules, plus the ESM dependency lock and
  // authored graph. Source files are data evidence, never native module loaders.
  const files = new Set(Object.keys(require.cache).filter(file => file.includes(`${path.sep}third_party${path.sep}medusa${path.sep}`)));
  for (const file of ["native.ts", "workflow.ts", "run.ts"]) files.add(fileURLToPath(new URL(file, import.meta.url)));
  for (const file of ["package.json", "package-lock.json"]) files.add(path.join(root, "work/native-business-baseline/dependencies", file));
  const dependencyRoot = path.join(root, "work/native-business-baseline/dependencies/node_modules");
  for (const dependency of ["payload", "@payloadcms/db-postgres", "@payloadcms/drizzle"]) {
    const directory = path.join(dependencyRoot, dependency, "dist");
    for (const file of await readdir(directory, { recursive: true })) if (file.endsWith(".js")) files.add(path.join(directory, file));
  }
  files.add(path.join(root, "packages/medusa-adapter/test/support/product-attempt-seed.ts"));
  files.add(path.join(root, "packages/executor/test/performance/support/measurement.ts"));
  const hashes: Record<string, string> = {};
  for (const file of [...files].toSorted()) hashes[path.relative(root, file).replaceAll("\\", "/")] = createHash("sha256").update(await readFile(file)).digest("hex");
  return hashes;
}
