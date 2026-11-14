import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Schema } from "effect";
import { RequestBuildManifest, RequestWorkerResult } from "./contract.ts";
import { readRuntimeSources, runtimeSourcePaths } from "./runtime-sources.mjs";

const { values } = parseArgs({ options: {
  bun: { type: "string", default: "bun" }, out: { type: "string" }, assets: { type: "string" },
  mode: { type: "string", default: "both" }, runtime: { type: "string", default: "both" },
  rounds: { type: "string", default: "2" }, samples: { type: "string", default: "30" },
  warmups: { type: "string", default: "5" }, "build-only": { type: "boolean", default: false },
  profile: { type: "boolean", default: false },
  scenario: { type: "string", default: "mixed-product" }, products: { type: "string" },
  "runtime-source-revision": { type: "string" },
} });
const rounds = Number(values.rounds), samples = Number(values.samples), warmups = Number(values.warmups);
assert(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 20);
assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(warmups) && warmups >= 0 && samples + warmups <= 105);
assert(["both", "generated", "interpreter"].includes(values.mode));
assert(["both", "node", "bun-aot"].includes(values.runtime));
assert(["mixed-product", "product-workflow"].includes(values.scenario));
const products = Number(values.products ?? "1");
assert(products === 1 || products === 4);
assert(values.products === undefined || values.scenario === "product-workflow", "--products requires --scenario product-workflow");
assert(!values.profile || values.runtime === "node", "--profile requires --runtime node and is diagnostic only");
assert(values.assets === undefined || values["runtime-source-revision"] === undefined,
  "--assets already fixes runtime sources; --runtime-source-revision applies only to a new build");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = fileURLToPath(new URL("./", import.meta.url));
const output = resolve(root, values.out ?? `work/validation/core-aot-${Date.now()}`);
mkdirSync(output, { recursive: true });
assert.equal(readdirSync(output).length, 0, "Output directory must be empty; choose a fresh --out");
const assets = values.assets === undefined ? output : resolve(root, values.assets);
const modes = values.mode === "both" ? ["generated", "interpreter"] : [values.mode];
const runtimes = values.runtime === "both" ? ["node", "bun-aot"] : [values.runtime];
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
function execute(command, args, name) {
  const started = performance.now();
  const child = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 1800000,
    maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_ENV: "production" } });
  writeFileSync(resolve(output, `${name}.stdout.log`), child.stdout ?? "");
  writeFileSync(resolve(output, `${name}.stderr.log`), child.stderr ?? "");
  return { child, wallMs: performance.now() - started };
}
function assertChild(child, name) {
  assert.ifError(child.error);
  assert.equal(child.status, 0, `${name} failed; inspect retained logs in ${output}`);
}
// Keep this build-only metadata out of the worker module graph: the historical
// worker contract and frozen request bytes remain unchanged by this control.
const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({ ...RequestBuildManifest.fields,
  scenario: Schema.optionalKey(Schema.Literal("product-workflow")),
  runtimeSource: Schema.optionalKey(Schema.Struct({ revision: Schema.String,
    files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })) })),
}));
let manifest;
if (values.assets !== undefined) {
  manifest = decodeManifest(JSON.parse(readFileSync(resolve(assets, "builds.json"), "utf8")));
} else {
  const source = values["runtime-source-revision"] === undefined ? undefined : readRuntimeSources(root, values["runtime-source-revision"]);
  manifest = { sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    gitStatus: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
    nodeVersion: process.version, bunVersion: execFileSync(values.bun, ["--version"], { encoding: "utf8", windowsHide: true }).trim(), builds: [],
    ...(values.scenario === "product-workflow" ? { scenario: values.scenario } : {}),
    ...(source === undefined ? {} : { runtimeSource: { revision: source.revision,
      files: source.files.map(({ path, sha256 }) => ({ path, sha256 })) } }) };
  for (const mode of modes) {
    const bundled = execute(values.bun, [resolve(directory, "build.mjs"), mode, assets,
      "--scenario", values.scenario,
      ...(source === undefined ? [] : ["--runtime-source-revision", source.revision])], `build-${mode}-bundle`);
    assertChild(bundled.child, `build-${mode}-bundle`);
    const bundleName = `${values.scenario}-${mode}.mjs`, bundle = resolve(assets, bundleName);
    const bundleSha256 = hash(bundle), sourceMapSha256 = hash(`${bundle}.map`);
    manifest.builds.push({ mode, runtime: "node", artifact: bundleName, sha256: bundleSha256,
      bundleSha256, sourceMapSha256, bytes: statSync(bundle).size });
    if (runtimes.includes("bun-aot")) {
      const executableName = `${values.scenario}-${mode}-aot${process.platform === "win32" ? ".exe" : ""}`;
      const target = resolve(assets, executableName);
      const flags = ["build", "--compile", "--aot", "--explain=json", "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig", bundle, "--outfile", target];
      const compiled = execute(values.bun, flags, `build-${mode}-aot`);
      assertChild(compiled.child, `build-${mode}-aot`);
      manifest.builds.push({ mode, runtime: "bun-aot", artifact: executableName, sha256: hash(target),
        bundleSha256, sourceMapSha256, bytes: statSync(target).size });
    }
    writeFileSync(resolve(output, "builds.json"), JSON.stringify(manifest, null, 2));
    console.log(`Built ${mode} frozen graph`);
  }
}
assert.equal(manifest.scenario ?? "mixed-product", values.scenario, "Frozen assets belong to a different scenario");
if (manifest.runtimeSource !== undefined) {
  assert.deepEqual(manifest.runtimeSource.files.map(file => file.path), runtimeSourcePaths,
    "Runtime source overrides must be the fixed owned edit set");
}
const jobs = [];
for (const mode of modes) for (const runtime of runtimes) {
  const build = manifest.builds.find(value => value.mode === mode && value.runtime === runtime);
  assert(build !== undefined, `Assets lack ${mode}/${runtime}`);
  assert.equal(build.artifact, basename(build.artifact), "Build artifact must be a local filename");
  const artifact = resolve(assets, build.artifact);
  assert.equal(hash(artifact), build.sha256, "Frozen artifact hash changed");
  assert.equal(hash(resolve(assets, `${values.scenario}-${mode}.mjs`)), build.bundleSha256, "Frozen bundle hash changed");
  assert.equal(hash(resolve(assets, `${values.scenario}-${mode}.mjs.map`)), build.sourceMapSha256, "Frozen source map hash changed");
  jobs.push({ mode, runtime, artifact, artifactSha256: build.sha256, bundleSha256: build.bundleSha256 });
}
writeFileSync(resolve(output, "builds.json"), JSON.stringify(manifest, null, 2));
if (values["build-only"]) {
  console.log(`Frozen assets ready: ${output}`);
  process.exit(0);
}
assert(process.env.FLAREX_POSTGRES_DATABASE_URL && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL,
  "Both ordinary and provisioning PostgreSQL endpoints are required");
const decodeWorker = Schema.decodeUnknownSync(values.scenario === "mixed-product" ? RequestWorkerResult
  : (await import("./workflow-contract.ts")).WorkflowWorkerResult);
const runs = [];
let serverReference;
for (let round = 0; round < rounds; round++) {
  const ordered = round % 2 ? [...jobs].reverse() : jobs;
  for (const job of ordered) {
    const name = `${job.mode}-${job.runtime}-${round}`;
    const profileArgs = values.profile ? ["--profile-dir", resolve(output, `profiles-${name}`)] : [];
    const args = ["--samples", String(samples), "--warmups", String(warmups),
      ...(values.scenario === "product-workflow" ? ["--products", String(products)] : []), ...profileArgs];
    const executed = job.runtime === "node" ? execute(process.execPath, [job.artifact, ...args], name) : execute(job.artifact, args, name);
    // Retain failed/partial raw output before checking child completion or its contract.
    assertChild(executed.child, name);
    const result = decodeWorker(JSON.parse(executed.child.stdout));
    assert.equal(result.status, "passed"); assert.equal(result.disposed, true);
    assert.equal(result.samples, samples); assert.equal(result.warmups, warmups);
    assert.equal(result.measurementMode, values.profile ? "cpu-diagnostic" : "quiet");
    if (values.scenario === "product-workflow") { assert.equal(result.productsPerRequest, products); assert.equal(result.publicationVerified, true); }
    assert.equal(result.measurements.length, samples + warmups);
    for (let index = 0; index < result.measurements.length; index++) {
      const row = result.measurements[index];
      assert.equal(row.index, index); assert.equal(row.phase, index < warmups ? "warmup" : "measured");
      assert(row.completed && row.verified && row.wallMs >= 0 && row.userCpuMs >= 0 && row.systemCpuMs >= 0);
    }
    assert(result.server !== null);
    if (serverReference === undefined) serverReference = result.server;
    else assert.deepEqual(result.server, serverReference, "PostgreSQL settings/role changed across workers");
    runs.push({ ...result, mode: job.mode, runtime: job.runtime, round,
      artifactSha256: job.artifactSha256, bundleSha256: job.bundleSha256, processWallMs: executed.wallMs });
    writeFileSync(resolve(output, "runs.json"), JSON.stringify(runs, null, 2));
    console.log(`Verified ${round + 1}/${rounds}: ${job.mode}/${job.runtime}`);
  }
}
function percentile(numbers, fraction) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
const summary = jobs.map(job => {
  const rows = runs.filter(run => run.mode === job.mode && run.runtime === job.runtime)
    .flatMap(run => run.measurements.filter(row => row.phase === "measured"));
  const cpu = rows.map(row => row.userCpuMs + row.systemCpuMs), wall = rows.map(row => row.wallMs);
  return { mode: job.mode, runtime: job.runtime, count: rows.length, medianWallMs: percentile(wall, .5),
    p95WallMs: percentile(wall, .95), medianCpuMs: percentile(cpu, .5), p95CpuMs: percentile(cpu, .95),
    minWallMs: Math.min(...wall), maxWallMs: Math.max(...wall) };
});
const report = { manifest, rounds, samples, warmups, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  scenario: values.scenario, ...(values.scenario === "product-workflow" ? { productsPerRequest: products } : {}),
  measurementMode: values.profile ? "cpu-diagnostic" : "quiet", server: serverReference, summary,
  quietSamplingEligible: !values.profile && samples >= 30 && warmups >= 5,
  completeNativeRelativeAcceptance: false,
  limitations: [values.scenario === "mixed-product" ? "Actual current mixed Application/Product request, including ordinary-role PostgreSQL settlement; not a native-business baseline comparison."
    : "Actual complete pinned createProductsWorkflow through all eight installed modules; HTTP ingress and external hook effects are excluded.",
    "CPU is client process user+system CPU only; PostgreSQL server CPU is excluded.",
    "The same frozen JS graph runs in Node and machine-code Bun AOT. Native Medusa uses existing built decorator output.",
    ...(values.scenario === "mixed-product" ? ["The fixture evaluates its authored Application handler with new Function; build-time specialization of that string is not established."] : []),
    "Preparation, seeding, committed-result verification and cleanup are outside the request timer.",
    "Windows CPU accounting is coarse. Diagnostic profiles are separate from quiet performance evidence."] };
writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2));
console.table(summary);
console.log(`Verified full requests; retained evidence: ${output}`);
