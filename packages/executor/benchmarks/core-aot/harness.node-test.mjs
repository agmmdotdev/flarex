import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("./run.mjs", import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
function temporary(t) {
  const path = mkdtempSync(join(tmpdir(), "flarex-core-aot-harness-"));
  t.after(() => {
    assert.equal(dirname(resolve(path)), resolve(tmpdir()));
    assert(basename(path).startsWith("flarex-core-aot-harness-"));
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
function run(args) {
  return spawnSync(process.execPath, [runner, "--mode", "generated", "--runtime", "node", ...args],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000 });
}
test("refuses reused output before overwriting previous evidence", t => {
  const output = temporary(t);
  writeFileSync(join(output, "results.json"), "previous evidence\n");
  const result = run(["--out", output, "--build-only"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Output directory must be empty/);
  assert.equal(readFileSync(join(output, "results.json"), "utf8"), "previous evidence\n");
  assert.deepEqual(readdirSync(output), ["results.json"]);
});
test("retains a failed build's logs without a success report", t => {
  const output = temporary(t);
  const result = run(["--bun", process.execPath, "--out", output, "--build-only"]);
  assert.equal(result.status, 1);
  assert.match(readFileSync(join(output, "build-generated-bundle.stderr.log"), "utf8"), /Bun is not defined/);
  assert(!readdirSync(output).includes("results.json"));
});
test("refuses a changed frozen artifact before executing it", t => {
  const base = temporary(t), assets = join(base, "assets"), output = join(base, "run");
  mkdirSync(assets);
  writeFileSync(join(assets, "mixed-product-generated.mjs"), "throw new Error('artifact must not execute');\n");
  writeFileSync(join(assets, "builds.json"), JSON.stringify({ sourceRevision: "test", gitStatus: "", nodeVersion: process.version,
    bunVersion: "test", builds: [{ mode: "generated", runtime: "node", artifact: "mixed-product-generated.mjs",
      sha256: "incorrect", bundleSha256: "incorrect", sourceMapSha256: "unused", bytes: 1 }] }));
  const result = run(["--out", output, "--assets", assets, "--build-only"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Frozen artifact hash changed/);
  assert.equal(readdirSync(output).length, 0);
});
test("refuses an unknown runtime source revision before building", t => {
  const output = temporary(t);
  const result = run(["--bun", process.execPath, "--out", output, "--build-only",
    "--runtime-source-revision", "nonexistent-core-aot-revision-779da2ab"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid --runtime-source-revision/);
  assert.equal(readdirSync(output).length, 0);
});

test("refuses assets from a different request scenario", t => {
  const base = temporary(t), assets = join(base, "assets"), output = join(base, "run");
  mkdirSync(assets);
  writeFileSync(join(assets, "builds.json"), JSON.stringify({ sourceRevision: "test", gitStatus: "", nodeVersion: process.version,
    bunVersion: "test", builds: [] }));
  const result = run(["--out", output, "--assets", assets, "--scenario", "product-workflow", "--build-only"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Frozen assets belong to a different scenario/);
  assert.deepEqual(readdirSync(output), []);
});
