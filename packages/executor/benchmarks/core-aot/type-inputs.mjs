import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Schema } from "effect";
import { RequestBuildManifest, RequestWorkerResult } from "./contract.ts";
import { maxCorePerformanceSeriesSamples } from "../../test/performance/support/measurementPlan.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = fileURLToPath(new URL("./", import.meta.url));
const { values } = parseArgs({ options: {
  bun: { type: "string", default: "bun" }, out: { type: "string" }, assets: { type: "string" },
  variants: { type: "string" },
  scenario: { type: "string", default: "mixed-product" }, products: { type: "string" },
  "build-only": { type: "boolean", default: false }, rounds: { type: "string", default: "4" },
  samples: { type: "string", default: "30" }, warmups: { type: "string", default: "5" },
} });
const rounds = Number(values.rounds), samples = Number(values.samples), warmups = Number(values.warmups);
assert(["mixed-product", "product-workflow"].includes(values.scenario));
const products = Number(values.products ?? "1");
assert(products === 1 || products === 4);
assert(values.products === undefined || values.scenario === "product-workflow", "--products requires --scenario product-workflow");
assert(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 20);
assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(warmups) && warmups >= 0
  && samples + warmups <= maxCorePerformanceSeriesSamples);
const output = resolve(root, values.out ?? `work/validation/core-aot-type-inputs-${Date.now()}`);
mkdirSync(output, { recursive: true });
assert.equal(readdirSync(output).length, 0, "Output directory must be empty; choose a fresh --out");
const assets = values.assets === undefined ? output : resolve(root, values.assets);
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const prefix = values.scenario;
const plans = [
  { variant: "node-js", runtime: "node", artifact: `frozen/${prefix}-generated.mjs` },
  { variant: "aot-js", runtime: "bun-aot", artifact: `frozen/${prefix}-generated-aot${executableSuffix}` },
  { variant: "aot-core", runtime: "bun-aot", artifact: `aot-core/worker${executableSuffix}` },
  { variant: "aot-core-uniform", runtime: "bun-aot", artifact: `aot-core-uniform/worker${executableSuffix}` },
  { variant: "aot-medusa", runtime: "bun-aot", artifact: `aot-medusa/worker${executableSuffix}` },
  { variant: "aot-medusa-uniform", runtime: "bun-aot", artifact: `aot-medusa-uniform/worker${executableSuffix}` },
];
const selectedNames = values.variants === undefined ? plans.filter(plan => values.scenario === "mixed-product" || !plan.variant.endsWith("-uniform"))
  .map(plan => plan.variant) : values.variants.split(",");
assert(selectedNames.length > 0 && new Set(selectedNames).size === selectedNames.length
  && selectedNames.every(name => plans.some(plan => plan.variant === name)), "--variants must name distinct known inputs");
const InputManifest = Schema.Struct({
  sourceRevision: Schema.String, gitStatus: Schema.String, nodeVersion: Schema.String, bunVersion: Schema.String,
  scenario: Schema.optionalKey(Schema.Literal("product-workflow")),
  variants: Schema.Array(Schema.Struct({ variant: Schema.String, runtime: Schema.Literals(["node", "bun-aot"]),
    artifact: Schema.String, sha256: Schema.String, bytes: Schema.Int,
    flags: Schema.Array(Schema.String), files: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
    sourceFiles: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
    explain: Schema.Unknown })),
});
const decodeManifest = Schema.decodeUnknownSync(InputManifest);
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const slash = path => path.split(sep).join("/");
function localPath(base, path) {
  assert(!isAbsolute(path));
  const absolute = resolve(base, path), within = relative(base, absolute);
  assert(within.length > 0 && within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within), "Asset escapes its directory");
  return absolute;
}
function execute(command, args, name) {
  const before = performance.now();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 1800000,
    maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_ENV: "production" } });
  writeFileSync(resolve(output, `${name}.stdout.log`), result.stdout ?? "");
  writeFileSync(resolve(output, `${name}.stderr.log`), result.stderr ?? "");
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} failed; inspect retained logs in ${output}`);
  return { stdout: result.stdout, wallMs: performance.now() - before };
}
let manifest;
if (values.assets !== undefined) {
  manifest = decodeManifest(JSON.parse(readFileSync(resolve(assets, "type-builds.json"), "utf8")));
} else {
  manifest = { sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    gitStatus: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), nodeVersion: process.version,
    bunVersion: execFileSync(values.bun, ["--version"], { encoding: "utf8", windowsHide: true }).trim(), variants: [] };
  if (values.scenario === "product-workflow") manifest.scenario = values.scenario;
  const frozen = resolve(assets, "frozen");
  execute(process.execPath, [resolve(directory, "run.mjs"), "--bun", values.bun, "--mode", "generated", "--runtime", "both",
    "--scenario", values.scenario, "--out", frozen, "--build-only"], "build-frozen");
  const frozenManifest = Schema.decodeUnknownSync(RequestBuildManifest)(JSON.parse(readFileSync(resolve(frozen, "builds.json"), "utf8")));
  for (const plan of plans.filter(plan => selectedNames.includes(plan.variant))) {
    let flags = [], files, sourceFiles = [], explain = null;
    if (plan.variant === "node-js" || plan.variant === "aot-js") {
      const build = frozenManifest.builds.find(build => build.runtime === plan.runtime);
      assert(build !== undefined);
      assert.equal(hash(localPath(assets, plan.artifact)), build.sha256);
      files = [`frozen/${prefix}-generated.mjs`, `frozen/${prefix}-generated.mjs.map`, plan.artifact,
        "frozen/builds.json", "frozen/build-generated-aot.stdout.log", "frozen/build-generated-aot.stderr.log"];
      if (plan.runtime === "bun-aot") explain = readExplain(resolve(frozen, "build-generated-aot.stdout.log"));
    } else {
      const subdirectory = resolve(assets, plan.variant);
      mkdirSync(subdirectory);
      flags = ["build", "--compile", "--aot", "--explain=json", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
        ...(plan.variant.startsWith("aot-medusa") ? ["--conditions=source"] : []),
        ...(plan.variant.endsWith("-uniform") ? ["--tsconfig-override", resolve(directory, "types.tsconfig.json")] : []),
        `--metafile=${resolve(subdirectory, "graph.json")}`, resolve(directory, values.scenario === "mixed-product" ? "worker.ts" : "workflow-worker.ts"),
        "--outfile", localPath(assets, plan.artifact)];
      execute(values.bun, flags, `build-${plan.variant}`);
      files = [plan.artifact, `${plan.variant}/graph.json`, `build-${plan.variant}.stdout.log`, `build-${plan.variant}.stderr.log`];
      explain = readExplain(resolve(output, `build-${plan.variant}.stdout.log`));
      const graph = JSON.parse(readFileSync(resolve(subdirectory, "graph.json"), "utf8"));
      assert(graph.inputs !== undefined && Object.keys(graph.inputs).length > 0, "Compiler must retain its input graph");
      sourceFiles = Object.keys(graph.inputs).map(path => ({ path: slash(relative(root, resolve(root, path))),
        sha256: hash(resolve(root, path)) }));
      for (const path of ["tsconfig.base.json", "tools/medusa/tsconfig.fork.json", "pnpm-lock.yaml",
        "packages/executor/benchmarks/core-aot/tsconfig.json", "packages/executor/test/performance/tsconfig.json",
        ...(plan.variant.endsWith("-uniform") ? ["packages/executor/benchmarks/core-aot/types.tsconfig.json"] : [])]) {
        sourceFiles.push({ path, sha256: hash(resolve(root, path)) });
      }
    }
    manifest.variants.push({ ...plan, flags, files: [...new Set(files)].map(path => ({ path, sha256: hash(localPath(assets, path)) })),
      sourceFiles, explain, sha256: hash(localPath(assets, plan.artifact)), bytes: statSync(localPath(assets, plan.artifact)).size });
    writeFileSync(resolve(output, "type-builds.json"), JSON.stringify(manifest, null, 2));
    console.log(`Frozen ${plan.variant}`);
  }
}
assert.equal(manifest.scenario ?? "mixed-product", values.scenario, "Frozen assets belong to a different scenario");
assert(manifest.variants.length > 0 && new Set(manifest.variants.map(build => build.variant)).size === manifest.variants.length);
for (const build of manifest.variants) {
  assert.deepEqual({ variant: build.variant, runtime: build.runtime, artifact: build.artifact }, plans.find(plan => plan.variant === build.variant),
    "Manifest must use fixed comparison inputs");
  assert.equal(hash(localPath(assets, build.artifact)), build.sha256, "Frozen artifact hash changed");
  for (const file of build.files) assert.equal(hash(localPath(assets, file.path)), file.sha256, "Frozen input hash changed");
}
const selected = selectedNames.map(name => manifest.variants.find(build => build.variant === name));
assert(selected.every(build => build !== undefined), "Assets lack a selected comparison input");
writeFileSync(resolve(output, "type-builds.json"), JSON.stringify(manifest, null, 2));
if (values["build-only"]) { console.log(`Frozen type-input assets ready: ${output}`); process.exit(0); }
assert(process.env.FLAREX_POSTGRES_DATABASE_URL && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL,
  "Both ordinary and provisioning PostgreSQL endpoints are required");
const decodeWorker = Schema.decodeUnknownSync(values.scenario === "mixed-product" ? RequestWorkerResult
  : (await import("./workflow-contract.ts")).WorkflowWorkerResult);
const runs = [];
let server;
for (let round = 0; round < rounds; round++) {
  const start = (2 * Math.floor(round / 2)) % selected.length;
  const rotated = [...selected.slice(start), ...selected.slice(0, start)];
  const ordered = round % 2 ? rotated.reverse() : rotated;
  for (const build of ordered) {
    const artifact = localPath(assets, build.artifact), name = `${round}-${build.variant}`;
    const args = ["--samples", String(samples), "--warmups", String(warmups),
      ...(values.scenario === "product-workflow" ? ["--products", String(products)] : [])];
    const executed = build.runtime === "node" ? execute(process.execPath, [artifact, ...args], name) : execute(artifact, args, name);
    const result = decodeWorker(JSON.parse(executed.stdout));
    assert.equal(result.status, "passed"); assert.equal(result.disposed, true); assert.equal(result.failureStage, null);
    assert.equal(result.samples, samples); assert.equal(result.warmups, warmups); assert.equal(result.measurementMode, "quiet");
    assert.equal(result.measurements.length, samples + warmups); assert.equal(result.profiles.length, 0);
    if (values.scenario === "product-workflow") {
      assert.equal(result.productsPerRequest, products); assert(result.workload !== null && result.timings !== null);
      assert.equal(result.publicationVerified, true);
    }
    if (build.runtime === "node") {
      assert.equal(result.versions.node, manifest.nodeVersion.slice(1));
      assert.equal(result.versions.bun, undefined);
    } else assert.equal(result.versions.bun, manifest.bunVersion);
    for (let index = 0; index < result.measurements.length; index++) {
      const row = result.measurements[index];
      assert.equal(row.index, index); assert.equal(row.phase, index < warmups ? "warmup" : "measured");
      assert(row.completed && row.verified && row.wallMs >= 0 && row.userCpuMs >= 0 && row.systemCpuMs >= 0);
    }
    assert(result.server !== null);
    if (server === undefined) server = result.server;
    else assert.deepEqual(result.server, server, "PostgreSQL role/durability changed across inputs");
    runs.push({ ...result, variant: build.variant, runtime: build.runtime, round, artifactSha256: build.sha256,
      processWallMs: executed.wallMs });
    writeFileSync(resolve(output, "runs.json"), JSON.stringify(runs, null, 2));
    console.log(`Verified ${round + 1}/${rounds}: ${build.variant}`);
  }
}
const summary = selected.map(({ variant, runtime }) => {
  const workers = runs.filter(run => run.variant === variant);
  const rows = workers.flatMap(run => run.measurements.filter(row => row.phase === "measured"));
  const cpu = rows.map(row => row.userCpuMs + row.systemCpuMs), wall = rows.map(row => row.wallMs);
  return { variant, runtime, processes: workers.length, requests: rows.length,
    meanCpuMs: cpu.reduce((sum, value) => sum + value, 0) / cpu.length,
    medianWallMs: percentile(wall, .5), p95WallMs: percentile(wall, .95),
    workerMeanCpuMs: workers.map(worker => { const rows = worker.measurements.filter(row => row.phase === "measured");
      return rows.reduce((sum, row) => sum + row.userCpuMs + row.systemCpuMs, 0) / rows.length; }) };
});
const results = { manifest, variants: selectedNames, rounds, samples, warmups, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  scenario: values.scenario, ...(values.scenario === "product-workflow" ? { productsPerRequest: products } : {}),
  orderPolicy: "Reverse every second round; rotate the next pair by two inputs",
  measurementMode: "quiet", server, summary, quietSamplingEligible: samples >= 30 && warmups >= 5,
  completeNativeRelativeAcceptance: false,
  limitations: [values.scenario === "mixed-product" ? "Current mixed Application/Product request; not HTTP ingress or native-business-relative acceptance."
    : "Complete pinned createProductsWorkflow through all eight installed modules; HTTP ingress and external hook effects are excluded.",
    "Process CPU excludes PostgreSQL server CPU; preparation, seeding, verification and cleanup are outside request timers.",
    "Direct TS versus a flattened JS bundle also changes module boundaries and transforms; this is a build-route comparison, not pure type attribution.",
    "Medusa source selection also changes its decorator lowering; full-request verification is bounded compatibility evidence.",
    "All variants use the installed generated decoders. Windows CPU accounting is coarse; compiler counts are static, not sampled hot-path shares."] };
writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
console.table(summary.map(({ workerMeanCpuMs, ...rest }) => rest));
console.log(`Verified type-input comparison; retained evidence: ${output}`);

function readExplain(path) {
  const first = readFileSync(path, "utf8").split(/\r?\n/).find(line => line.startsWith('{"accesses":'));
  assert(first !== undefined, "Compiler summary is missing");
  return JSON.parse(first);
}
function percentile(numbers, fraction) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
