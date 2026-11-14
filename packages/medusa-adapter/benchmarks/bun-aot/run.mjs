import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Schema } from "effect";

// This synchronous Node command is the process/build/measurement boundary.
// Child failures are retained and fail the experiment, never become timing rows.
const { values } = parseArgs({ options: {
  bun: { type: "string", default: "bun" }, out: { type: "string" },
  rounds: { type: "string", default: "7" }, iterations: { type: "string", default: "500000" },
  "mechanism-iterations": { type: "string", default: "20000000" },
} });
const rounds = Number(values.rounds), iterations = Number(values.iterations), mechanismIterations = Number(values["mechanism-iterations"]);
assert(Number.isSafeInteger(rounds) && rounds >= 2 && rounds <= 30);
assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 10000000);
assert(Number.isSafeInteger(mechanismIterations) && mechanismIterations > 0 && mechanismIterations <= 100000000);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = resolve(root, values.out ?? `work/validation/bun-aot-cpu-${Date.now()}`);
mkdirSync(output, { recursive: true });
assert.equal(readdirSync(output).length, 0, "Output directory must be empty; choose a new --out to preserve earlier evidence");
const bun = values.bun;
const extension = process.platform === "win32" ? ".exe" : "";
const entryDirectory = fileURLToPath(new URL("./", import.meta.url));
const builds = [], runs = [];
const decodeWorker = Schema.decodeUnknownSync(Schema.Struct({
  runtime: Schema.Record(Schema.String, Schema.String), parity: Schema.optionalKey(Schema.String),
  measurements: Schema.Array(Schema.Struct({ name: Schema.String, iterations: Schema.Int,
    wallMs: Schema.Finite, cpuMs: Schema.Finite, checksum: Schema.Int })),
}));
function execute(command, args, name, timeout = 180000) {
  const before = performance.now();
  const child = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout,
    maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, NODE_ENV: "production" } });
  writeFileSync(resolve(output, `${name}.stderr.log`), child.stderr ?? "");
  writeFileSync(resolve(output, `${name}.stdout.log`), child.stdout ?? "");
  assert.ifError(child.error);
  assert.equal(child.status, 0, `${name} failed; see ${output}`);
  return { stdout: child.stdout, elapsedMs: performance.now() - before };
}
const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const nodeVersion = process.version;
const bunVersion = execFileSync(bun, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const common = ["--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig"];
const jobs = [];
for (const entry of ["decoders", "mechanisms"]) {
  for (const mode of entry === "decoders" ? ["interpreter", "generated"] : ["generated"]) {
    const stem = `${entry}-${mode}`;
    execute(bun, [resolve(entryDirectory, "build.mjs"), entry, mode, output], `build-${stem}-bundle`);
    const bundle = resolve(output, `${stem}.mjs`);
    const count = String(entry === "decoders" ? iterations : mechanismIterations);
    jobs.push({ entry, mode, runtime: "node-jit", command: process.execPath, args: [bundle, count], artifact: bundle });
    jobs.push({ entry, mode, runtime: "bun-jit", command: bun, args: [bundle, count], artifact: bundle });
    for (const kind of ["bytecode", "aot", ...(mode === "generated" ? ["typed-aot",
      ...(entry === "decoders" ? ["typed-aot-static"] : [])] : [])]) {
      const target = resolve(output, `${stem}-${kind}${extension}`);
      const source = kind.startsWith("typed-aot") ? resolve(entryDirectory, `${entry}.ts`) : bundle;
      const flags = kind === "bytecode" ? ["--bytecode", "--format=esm"] : ["--aot", "--explain=json"];
      const args = ["build", "--compile", ...flags, ...common,
        ...(kind === "typed-aot-static" ? ["--disallow-code-generation-from-strings=strict"] : []),
        "--conditions=source", source, "--outfile", target];
      const build = execute(bun, args, `build-${stem}-${kind}`);
      builds.push({ entry, mode, kind, args, elapsedMs: build.elapsedMs, bytes: statSync(target).size,
        artifactSha256: sha256(target), bundleSha256: sha256(bundle) });
      jobs.push({ entry, mode, runtime: `bun-${kind}`, command: target, args: [count], artifact: target });
      console.log(`Built ${stem}/${kind}`);
    }
  }
}
writeFileSync(resolve(output, "builds.json"), JSON.stringify(builds, null, 2));
const parity = new Map(), checksums = new Map(), rowContracts = new Map();
for (let round = 0; round < rounds; round++) {
  // Rotate each cohort, reverse every other round; only one child runs at once.
  const rotated = [...jobs.slice(round % jobs.length), ...jobs.slice(0, round % jobs.length)];
  if (round % 2) rotated.reverse();
  for (const job of rotated) {
    const name = `${job.entry}-${job.mode}-${job.runtime}-${round}`;
    const child = execute(job.command, job.args, name);
    const result = decodeWorker(JSON.parse(child.stdout));
    assert(Array.isArray(result.measurements) && result.measurements.length === (job.entry === "decoders" ? 24 : 6));
    const contract = result.measurements.map(({ name, iterations }) => ({ name, iterations }));
    assert.equal(new Set(contract.map(row => row.name)).size, contract.length);
    const rowReference = rowContracts.get(job.entry);
    if (rowReference === undefined) rowContracts.set(job.entry, contract);
    else assert.deepEqual(contract, rowReference, `${name}: measurement names/counts/order`);
    if (job.entry === "decoders") {
      assert.equal(typeof result.parity, "string");
      const reference = parity.get(job.entry);
      if (reference === undefined) parity.set(job.entry, result.parity);
      else assert.equal(result.parity, reference, `${name}: value/ordered-diagnostic parity`);
    }
    for (const row of result.measurements) {
      assert.equal(typeof row.name, "string");
      assert(Number.isSafeInteger(row.iterations) && row.iterations > 0);
      assert(Number.isFinite(row.wallMs) && row.wallMs > 0);
      assert(Number.isFinite(row.cpuMs) && row.cpuMs >= 0);
      assert(Number.isSafeInteger(row.checksum));
      const key = `${job.entry}/${row.name}`;
      const reference = checksums.get(key);
      if (reference === undefined) checksums.set(key, row.checksum);
      else assert.equal(row.checksum, reference, `${name}: checksum`);
    }
    runs.push({ ...result, versions: result.runtime, entry: job.entry, mode: job.mode, runtime: job.runtime, round,
      processWallMs: child.elapsedMs, artifactSha256: sha256(job.artifact) });
    writeFileSync(resolve(output, "runs.json"), JSON.stringify(runs, null, 2));
    console.log(`Measured ${round + 1}/${rounds}: ${job.entry}/${job.mode}/${job.runtime}`);
  }
}
function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const summary = jobs.map(job => {
  const cohort = runs.filter(run => run.entry === job.entry && run.mode === job.mode && run.runtime === job.runtime);
  return { entry: job.entry, mode: job.mode, runtime: job.runtime,
    medianProcessWallMs: median(cohort.map(run => run.processWallMs)),
    rows: cohort[0].measurements.map(row => {
      const matches = cohort.map(run => run.measurements.find(value => value.name === row.name));
      return { name: row.name, iterations: row.iterations,
        wallMs: median(matches.map(value => value.wallMs)), cpuMs: median(matches.map(value => value.cpuMs)),
        minWallMs: Math.min(...matches.map(value => value.wallMs)), maxWallMs: Math.max(...matches.map(value => value.wallMs)) };
    }),
    medianMeasuredWallMs: median(cohort.map(run => run.measurements.reduce((sum, row) => sum + row.wallMs, 0))),
    medianMeasuredCpuMs: median(cohort.map(run => run.measurements.reduce((sum, row) => sum + row.cpuMs, 0))),
  };
});
const report = { revision, dirty: status.trim().length > 0, status, nodeVersion, bunVersion,
  cpu: cpus()[0]?.model, logicalCpus: cpus().length, platform: process.platform, arch: process.arch,
  rounds, iterations, mechanismIterations, parityMatch: true, checksumMatch: true, builds, summary,
  limitations: ["Decoder and mechanism microbenchmarks; no request, transaction, Postgres or Cloudflare acceptance claim.",
    "Compiler explain counts are static reachability counts, not measured exclusive hot CPU.",
    "Windows process CPU counters are coarse; short individual rows can report zero CPU.",
    "Typed AOT builds start from original TypeScript; other modes share each frozen JavaScript bundle.",
    "Process wall time includes module initialization, warmup, parity, measurements and shutdown; it is not startup time.",
    "Projection setup is excluded except in the explicitly named projection-plus-one-pass row."] };
writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2));
console.table(summary.map(({ entry, mode, runtime, medianMeasuredWallMs, medianMeasuredCpuMs }) =>
  ({ entry, mode, runtime, wallMs: Math.round(medianMeasuredWallMs), cpuMs: Math.round(medianMeasuredCpuMs) })));
console.log(`Parity and checksums matched. Artifacts: ${output}`);
