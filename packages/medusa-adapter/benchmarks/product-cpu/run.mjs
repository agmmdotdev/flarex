import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

assert.equal(process.versions.bun, undefined, "Launch the cohort runner with Node");
const [assetsArg, outputArg, bunArg] = process.argv.slice(2);
assert(assetsArg && outputArg && bunArg, "run.mjs ASSETS NEW_OUTPUT BUN_EXECUTABLE");
const assets = resolve(assetsArg), output = resolve(outputArg), bun = resolve(bunArg);
await mkdir(output);
const worker = resolve(assets, "worker.mjs");
const hash = createHash("sha256").update(await readFile(worker)).digest("hex");
const variants = [
  { runtime: "node", scenario: "minimal" }, { runtime: "bun", scenario: "rich" },
  { runtime: "node", scenario: "rich" }, { runtime: "bun", scenario: "minimal" },
];
const cohorts = [];
for (let round = 0; round < 2; round++) for (const variant of round === 0 ? variants : [...variants].reverse()) {
  const name = `${variant.runtime}-${variant.scenario}-${round + 1}`;
  const child = spawnSync(variant.runtime === "node" ? process.execPath : bun, [worker], {
    encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PRODUCT_CPU_SCENARIO: variant.scenario, PRODUCT_CPU_TRANSPORT: "client",
      PRODUCT_CPU_SAMPLES: "16", PRODUCT_CPU_WARMUPS: "8", PRODUCT_CPU_DIAGNOSTIC: "0", PRODUCT_CPU_PROFILE: undefined },
  });
  await writeFile(resolve(output, name + ".stdout.log"), child.stdout ?? "");
  await writeFile(resolve(output, name + ".stderr.log"), child.stderr ?? "");
  assert.equal(child.status, 0, `${name} failed: ${child.error?.message ?? child.stderr}`);
  const report = JSON.parse(child.stdout);
  assert.equal(typeof report.runtime.bun === "string", variant.runtime === "bun", "Child runtime does not match its label");
  assert(report.measuredVerified && report.publicationVerified && report.disposed && !report.databaseEngines && !report.diagnostic);
  assert.equal(report.scenario, variant.scenario); assert.equal(report.transport, "client");
  assert.equal(report.samples, 16); assert.equal(report.warmups, 8);
  assert.equal(report.measurements.filter(value => value.phase === "measured").length, 16);
  cohorts.push({ name, ...variant, report });
  await writeFile(resolve(output, "cohorts.json"), JSON.stringify({ workerSha256: hash, cohorts }, null, 2));
  const times = report.measurements.filter(value => value.phase === "measured");
  console.log(JSON.stringify({ cohort: name, verified: true, meanProcessCpuMs: times.reduce((sum, value) => sum + value.cpuMs, 0) / times.length }));
}
const median = values => { const ordered = [...values].sort((a, b) => a - b); return (ordered[(ordered.length - 1) >> 1] + ordered[ordered.length >> 1]) / 2; };
const summary = [];
for (const variant of variants) {
  const selected = cohorts.filter(value => value.runtime === variant.runtime && value.scenario === variant.scenario);
  const points = selected.flatMap(value => value.report.measurements.filter(point => point.phase === "measured"));
  const threads = points.flatMap(value => value.threadCpuMs === null ? [] : [value.threadCpuMs]);
  summary.push({ ...variant, samples: points.length, processes: selected.length,
    businessRowsPerRequest: selected[0].report.businessRowsPerRequest,
    medianProcessCpuMs: median(points.map(value => value.cpuMs)),
    meanProcessCpuMs: points.reduce((sum, value) => sum + value.cpuMs, 0) / points.length,
    medianThreadCpuMs: threads.length === 0 ? null : median(threads),
    medianWallMs: median(points.map(value => value.wallMs)),
    perProcessMeanCpuMs: selected.map(value => value.report.measurements.filter(point => point.phase === "measured")
      .reduce((sum, value) => sum + value.cpuMs, 0) / 16) });
}
await writeFile(resolve(output, "summary.json"), JSON.stringify({ workerSha256: hash, transport: "real JS client + local fetch bridge", summary }, null, 2));
console.log(JSON.stringify({ summary }, null, 2));
