import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("./type-inputs.mjs", import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
function fixture(t, scenario = "mixed-product") {
  const directory = mkdtempSync(join(tmpdir(), "flarex-type-inputs-"));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(basename(directory).startsWith("flarex-type-inputs-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const assets = join(directory, "assets"), output = join(directory, "run");
  mkdirSync(assets);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const plans = [
    ["node-js", "node", `frozen/${scenario}-generated.mjs`],
    ["aot-js", "bun-aot", `frozen/${scenario}-generated-aot${suffix}`],
    ...["aot-core", "aot-core-uniform", "aot-medusa", "aot-medusa-uniform"].map(variant => [variant, "bun-aot", `${variant}/worker${suffix}`]),
  ];
  const variants = plans.map(([variant, runtime, artifact]) => {
    const path = join(assets, artifact);
    mkdirSync(dirname(path), { recursive: true });
    const bytes = "process.stdout.write('failed-worker-witness'); process.exitCode = 1;\n";
    writeFileSync(path, bytes);
    return { variant, runtime, artifact, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes),
      flags: [], files: [], sourceFiles: [], explain: null };
  });
  const manifest = { sourceRevision: "test", gitStatus: "", nodeVersion: process.version, bunVersion: "test", variants };
  if (scenario === "product-workflow") manifest.scenario = scenario;
  writeFileSync(join(assets, "type-builds.json"), JSON.stringify(manifest));
  return { assets, output, manifest };
}
function run({ assets, output }, args = []) {
  return spawnSync(process.execPath, [runner, "--assets", assets, "--out", output, ...args], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000,
    env: { ...process.env, FLAREX_POSTGRES_DATABASE_URL: "unused-by-failed-worker",
      FLAREX_POSTGRES_PROVISIONING_DATABASE_URL: "unused-by-failed-worker" },
  });
}

test("refuses changed type-input assets before executing a worker", t => {
  const fixtureValue = fixture(t);
  writeFileSync(join(fixtureValue.assets, fixtureValue.manifest.variants[0].artifact), "throw new Error('must not execute');\n");
  const result = run(fixtureValue);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Frozen artifact hash changed/);
  assert.deepEqual(readdirSync(fixtureValue.output), []);
});

test("retains a failed full-request worker without publishing successful evidence", t => {
  const fixtureValue = fixture(t);
  const result = run(fixtureValue, ["--rounds", "1", "--samples", "1", "--warmups", "0"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0-node-js failed/);
  assert.equal(readFileSync(join(fixtureValue.output, "0-node-js.stdout.log"), "utf8"), "failed-worker-witness");
  assert(!readdirSync(fixtureValue.output).includes("results.json"));
  assert(!readdirSync(fixtureValue.output).includes("runs.json"));
});

test("refuses an unknown or duplicate comparison input", t => {
  for (const variants of ["aot-core,aot-core", "aot-unknown"]) {
    const fixtureValue = fixture(t);
    const result = run(fixtureValue, ["--variants", variants]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--variants must name distinct known inputs/);
    assert.deepEqual(readdirSync(fixtureValue.output), []);
  }
});

test("refuses a missing selected variant even for build-only asset verification", t => {
  const fixtureValue = fixture(t);
  fixtureValue.manifest.variants = fixtureValue.manifest.variants.slice(0, 1);
  writeFileSync(join(fixtureValue.assets, "type-builds.json"), JSON.stringify(fixtureValue.manifest));
  const result = run(fixtureValue, ["--variants", "aot-core", "--build-only"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Assets lack a selected comparison input/);
  assert.deepEqual(readdirSync(fixtureValue.output), []);
});

test("rejects a workflow cohort that has not verified its durable publications", t => {
  const fixtureValue = fixture(t, "product-workflow");
  const result = { status: "passed", versions: { node: process.versions.node }, driver: "postgres", scenario: "product-workflow",
    productsPerRequest: 1, publicationVerified: false, workload: { flow: "createProductsWorkflow", cardinality: { products: 1 } },
    timings: { provisionAndPrepareMs: 0, initialSeedMs: 0, runtimeConstructionMs: 0 }, measurementMode: "quiet",
    warmups: 0, samples: 1, server: null, measurements: [{ index: 0, phase: "measured", wallMs: 1, userCpuMs: 1,
      systemCpuMs: 0, completed: true, verified: true }], failureStage: null, disposed: true, profiles: [] };
  const build = fixtureValue.manifest.variants[0];
  const bytes = `process.stdout.write(${JSON.stringify(JSON.stringify(result))});\n`;
  writeFileSync(join(fixtureValue.assets, build.artifact), bytes);
  build.sha256 = createHash("sha256").update(bytes).digest("hex"); build.bytes = Buffer.byteLength(bytes);
  writeFileSync(join(fixtureValue.assets, "type-builds.json"), JSON.stringify(fixtureValue.manifest));
  const executed = run(fixtureValue, ["--scenario", "product-workflow", "--variants", "node-js", "--rounds", "1", "--samples", "1", "--warmups", "0"]);
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /false !== true/);
  assert(!readdirSync(fixtureValue.output).includes("results.json"));
  assert(!readdirSync(fixtureValue.output).includes("runs.json"));
});
