import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.versions.bun, undefined, "Run the native experiment driver with Node");
const [binaryArg, outputArg, mode] = process.argv.slice(2);
assert(binaryArg && outputArg, "perry-native.mjs PERRY_BIN OUTPUT [--prepare-only]");
assert(mode === undefined || mode === "--prepare-only");
const compiler = resolve(binaryArg), output = resolve(outputArg);
const bench = dirname(fileURLToPath(import.meta.url)), root = resolve(bench, "../../../..");
const project = resolve(output, "project"), target = resolve(project, "product-native");
await mkdir(resolve(project, "node_modules"), { recursive: true });
let source = await readFile(resolve(bench, "worker.ts"), "utf8");
const originalHash = createHash("sha256").update(source).digest("hex");
const profileStart = source.indexOf("  let profile:"), loopStart = source.indexOf("  for (let index", profileStart);
assert(profileStart >= 0 && loopStart > profileStart);
source = source.slice(0, profileStart) + source.slice(loopStart);
const startHook = '    if (profile !== undefined && measured) await profile.post("Profiler.start");\n';
assert(source.includes(startHook)); source = source.replace(startHook, "");
const stopStart = source.indexOf("    if (profile !== undefined && measured) {"), stopEnd = source.indexOf("    measurements.push(", stopStart);
assert(stopStart >= 0 && stopEnd > stopStart);
source = source.slice(0, stopStart) + source.slice(stopEnd);
assert(!source.includes("node:inspector") && !source.includes("profile.post"));
source = source.replace('import { writeFile } from "node:fs/promises";\n', "");
// Extra observations are collected only by separate correctness smoke runs.
// Publication evidence is projected after the request timers for every cohort.
source = source.replace("  const measurements = [];", "  const measurements = [];\n  const observations: unknown[] = [];");
const readbackEnd = '    } else assert.equal(committed[0]?.variants.length, 0);';
assert(source.includes(readbackEnd));
source = source.replace(readbackEnd, readbackEnd + '\n    if (process.env.PERRY_CAPTURE_OUTPUT === "1") observations.push({ result, committed });');
const reportStart = "  report = { scenario:";
assert(source.includes(reportStart));
source = source.replace(reportStart, '  const publication = { rowsDelta: after.rows.length - before.rows.length, outcomesDelta: after.outcomes.length - before.outcomes.length, familiesDelta: after.families.length - before.families.length, timestamps: [...timestamps].map(timestamp => ({ timestamp: String(timestamp), revisions: after.revisions.filter(row => row.timestamp === timestamp).length, outcomes: after.outcomes.filter(row => row.timestamp === timestamp).length, families: after.families.filter(row => row.timestamp === timestamp).length, contracts: events.filter(event => event.timestamp === timestamp).map(event => event.envelope.contract) })) };\n  report = { observations, publication, scenario:');
const control = 'if (process.env.PERRY_ASSERT_CONTROL === "1") { assert.equal(1, 2, "PERRY_ASSERT_CONTROL_EXPECTED"); throw new Error("PERRY_ASSERT_CONTROL_NOOP"); }\n';
source = source.replace("const configuration =", control + "const configuration =");
const worker = resolve(bench, "worker-perry.generated.ts");
await writeFile(worker, source);
const names = new Set(["effect", "@noble/hashes", "bignumber.js", "drizzle-orm", "sorted-btree", "zod"]);
for (const item of await readdir(resolve(root, "packages"), { withFileTypes: true })) if (item.isDirectory()) {
  const folder = resolve(root, "packages", item.name);
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(folder, "package.json"), "utf8")); }
  catch (cause) { if (cause.code === "ENOENT") continue; throw cause; }
  names.add(pkg.name);
  const link = resolve(project, "node_modules", pkg.name); await mkdir(dirname(link), { recursive: true });
  try { await symlink(folder, link, "dir"); } catch (cause) { if (cause.code !== "EEXIST") throw cause; }
}
try { await symlink(resolve(root, "packages/medusa-adapter/node_modules/effect"), resolve(project, "node_modules/effect"), "dir"); }
catch (cause) { if (cause.code !== "EEXIST") throw cause; }
await writeFile(resolve(project, "package.json"), JSON.stringify({ name: "flarex-perry-native-flow", private: true, type: "module",
  perry: { compilePackages: [...names].sort(), allow: { compilePackages: [...names].sort() }, strict: true } }, null, 2));
await writeFile(resolve(project, "entry.ts"), `import ${JSON.stringify("./" + relative(project, worker).replaceAll("\\", "/"))};\n`);
const fixture = resolve(root, "packages/persistence-postgres/test/core/fixture.ts");
const fixtureSource = await readFile(fixture, "utf8");
const readerStart = fixtureSource.indexOf("export const readCoreFixtureRegistry ="), readerEnd = fixtureSource.indexOf("export interface CorePersistenceFixtureOptions");
assert(readerStart >= 0 && readerEnd > readerStart);
const replacement = resolve(project, "fixture-replacement.ts");
await writeFile(replacement, 'import { Effect } from "effect";\n' +
  `import { loadBootstrapRegistry } from ${JSON.stringify(resolve(root, "packages/persistence-postgres/src/core/bootstrap.ts"))};\n` +
  `import { loadCoreRegistry } from ${JSON.stringify(resolve(root, "packages/persistence-postgres/src/core/registry.ts"))};\n` +
  `import type { CorePersistence } from ${JSON.stringify(resolve(root, "packages/persistence-postgres/src/core/contracts.ts"))};\n` +
  'type CorePersistenceFixture = Readonly<{ persistence: CorePersistence }>;\n' +
  fixtureSource.slice(readerStart, readerEnd) + await readFile(resolve(bench, "forbidden-fixture.ts"), "utf8"));
const trap = resolve(bench, "forbidden-database.ts");
const args = ["compile", "entry.ts", "--no-codegen", "--strict-eval", "--strict-dynamic-import", "--strict-unimplemented", "--keep-intermediates", "--march", "generic",
  "--module-alias", `${fixture}=${replacement}`, "--module-alias", `pg=${trap}`, "--module-alias", `@electric-sql/pglite=${trap}`, "-o", target];
await writeFile(resolve(output, "input.json"), JSON.stringify({ originalWorkerSha256: originalHash,
  nativeWorkerSha256: createHash("sha256").update(source).digest("hex"), args, packages: [...names].sort() }, null, 2));
if (mode === "--prepare-only") process.exit(0);

async function execute(command, argv, prefix, env, timeoutMs) {
  const stdout = createWriteStream(prefix + ".stdout.log"), stderr = createWriteStream(prefix + ".stderr.log");
  const child = spawn(command, argv, { cwd: project, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs);
  child.stdout.on("data", chunk => { stdout.write(chunk); process.stdout.write(chunk); });
  child.stderr.on("data", chunk => { stderr.write(chunk); process.stderr.write(chunk); });
  let code, signal;
  try { [code, signal] = await once(child, "close"); }
  finally { clearTimeout(timer); stdout.end(); stderr.end(); }
  await Promise.all([stdout.writableFinished ? undefined : once(stdout, "finish"), stderr.writableFinished ? undefined : once(stderr, "finish")]);
  return { code, signal };
}
const compileEnv = { ...process.env, PERRY_NO_AUTO_FETCH: "1", PERRY_MODULE_JOBS: "2", PERRY_CODEGEN_UNIT_JOBS: "1", PERRY_CODEGEN_CPU_SLOTS: "2", PERRY_CODEGEN_MEMORY_MB: "2048",
  LD_PRELOAD: "/usr/lib/x86_64-linux-gnu/libjemalloc.so.2", MALLOC_CONF: "background_thread:true,dirty_decay_ms:0,muzzy_decay_ms:0,narenas:1" };
const versionResult = await execute(compiler, ["--version"], resolve(output, "compiler-version"), process.env, 30_000);
assert.equal(versionResult.code, 0);
const compilerVersion = (await readFile(resolve(output, "compiler-version.stdout.log"), "utf8")).trim();
assert.match(compilerVersion, /^perry 0\.5\.1665$/);
const built = await execute("/usr/bin/time", ["-v", "-o", resolve(output, "compiler-resources.txt"), compiler, ...args], resolve(output, "compile"), compileEnv, 40 * 60_000);
assert.equal(built.code, 0, `Native compilation failed: ${JSON.stringify(built)}`);
const compilerLog = await readFile(resolve(output, "compile.stdout.log"), "utf8");
assert(/Found \d+ module\(s\): \d+ native, 0 JavaScript/.test(compilerLog), "Native-only module proof missing");
const executable = await readFile(target); assert.equal(executable.subarray(0, 4).toString("hex"), "7f454c46", "Expected a native ELF executable");
const runtimeEnv = { ...process.env, PRODUCT_CPU_TRANSPORT: "client", PRODUCT_CPU_DIAGNOSTIC: "0" };
delete runtimeEnv.LD_PRELOAD; delete runtimeEnv.MALLOC_CONF; delete runtimeEnv.PRODUCT_CPU_PROFILE;
const controlResult = await execute(target, [], resolve(output, "assert-control"), { ...runtimeEnv, PERRY_ASSERT_CONTROL: "1" }, 30_000);
assert.notEqual(controlResult.code, 0);
const controlLog = await readFile(resolve(output, "assert-control.stderr.log"), "utf8");
assert(controlLog.includes("PERRY_ASSERT_CONTROL_EXPECTED") && !controlLog.includes("PERRY_ASSERT_CONTROL_NOOP"), "Native assertion control failed");
const reports = [];
for (const scenario of ["minimal", "rich"]) for (let round = 0; round < 3; round++) {
  const smoke = round === 0, samples = smoke ? 1 : 16, warmups = smoke ? 0 : 8;
  const prefix = resolve(output, `${scenario}-${smoke ? "smoke" : round}`);
  const result = await execute(target, [], prefix, { ...runtimeEnv, PRODUCT_CPU_SCENARIO: scenario,
    PRODUCT_CPU_SAMPLES: String(samples), PRODUCT_CPU_WARMUPS: String(warmups), PERRY_CAPTURE_OUTPUT: smoke ? "1" : "0" }, 10 * 60_000);
  assert.equal(result.code, 0, `${scenario} native execution failed`);
  const report = JSON.parse(await readFile(prefix + ".stdout.log", "utf8"));
  assert(report.measuredVerified && report.publicationVerified && report.disposed && !report.databaseEngines && !report.diagnostic);
  assert.equal(report.scenario, scenario); assert.equal(report.transport, "client");
  const rows = scenario === "rich" ? 29 : 3, requests = samples + warmups;
  assert.equal(report.businessRowsPerRequest, rows); assert.equal(report.publication.rowsDelta, rows * requests);
  assert.equal(report.publication.outcomesDelta, requests); assert.equal(report.publication.familiesDelta, requests);
  assert.equal(report.publication.timestamps.length, requests);
  for (const publication of report.publication.timestamps) {
    assert.equal(publication.revisions, rows); assert.equal(publication.outcomes, 1); assert.equal(publication.families, 1);
    assert.deepEqual(publication.contracts.filter(name => ["product-variant.created", "product.created"].includes(name)),
      scenario === "rich" ? ["product-variant.created", "product.created"] : ["product.created"]);
    if (scenario === "rich") for (const name of ["LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached", "LinkProductVariantInventoryItem.attached", "LinkProductVariantPriceSet.attached"]) assert(publication.contracts.includes(name));
  }
  assert.equal(report.measurements.filter(value => value.phase === "measured").length, samples);
  assert.equal(report.measurements.filter(value => value.phase === "warmup").length, warmups);
  for (const point of report.measurements) assert(Number.isFinite(point.cpuMs) && point.cpuMs > 0 && Number.isFinite(point.wallMs) && point.wallMs > 0);
  if (smoke) {
    assert.equal(report.observations.length, 1);
    const observation = report.observations[0], id = scenario === "rich" ? "cpu-product-0-product-0" : "cpu-product-0";
    assert.equal(observation.result[0].id, id); assert.equal(observation.committed[0].id, id);
    assert.equal(observation.result[0].title, scenario === "rich" ? "cpu-product-0 0" : "Small CPU Product 0");
    if (scenario === "rich") {
      assert.equal(observation.committed[0].variants[0].id, "cpu-product-0-variant-0");
      assert.equal(observation.committed[0].variants[0].sku, "cpu-product-0-sku-0");
      assert.equal(observation.committed[0].variants[0].manage_inventory, true);
      assert.deepEqual(observation.committed[0].images.map(value => value.url).sort(), ["https://example.test/first.png", "https://example.test/second.png"]);
      const usd = observation.result[0].variants[0].prices.find(value => value.currency_code === "USD");
      assert.equal(usd.raw_amount.value, "123.45678901234567890");
    } else assert.equal(observation.committed[0].variants.length, 0);
  }
  reports.push({ scenario, smoke, report });
  await writeFile(resolve(output, "reports.json"), JSON.stringify(reports, null, 2));
}
const median = values => { const a = [...values].sort((x, y) => x - y); return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2; };
const summary = ["minimal", "rich"].map(scenario => {
  const points = reports.filter(value => value.scenario === scenario && !value.smoke).flatMap(value => value.report.measurements.filter(point => point.phase === "measured"));
  return { scenario, samples: points.length, medianProcessCpuMs: median(points.map(value => value.cpuMs)), medianWallMs: median(points.map(value => value.wallMs)) };
});
await writeFile(resolve(output, "summary.json"), JSON.stringify({ compiler: compilerVersion, nativeExecutableSha256: createHash("sha256").update(executable).digest("hex"), nativeOnly: true, verified: true, summary }, null, 2));
console.log("PERRY_NATIVE_FULL_WORKFLOW_SUMMARY=" + JSON.stringify(summary));
