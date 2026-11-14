import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const helper = fileURLToPath(new URL("./core-aot-postgres-tool.mjs", import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "flarex-pg-controller-"));
  t.after(() => {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert(basename(directory).startsWith("flarex-pg-controller-"));
    rmSync(directory, { recursive: true });
  });
  return directory;
}
function invoke(directory, args, timeout = 2000) {
  const prefix = join(directory, "controller");
  const child = spawnSync(process.execPath, [helper, process.execPath, prefix, String(timeout), ...args], {
    encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return { result: JSON.parse(child.stdout), prefix };
}

test("returns while a descendant still owns inherited output files", async t => {
  const directory = fixture(t), script = join(directory, "fake-pg-ctl.mjs"), pidFile = join(directory, "descendant.pid");
  writeFileSync(script, `import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
const child = spawn(process.execPath, ["--input-type=commonjs", "-e",
  "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 30000)", process.argv[2]],
  { detached: true, stdio: "inherit", windowsHide: true });
child.unref();
const deadline = Date.now() + 1500;
while (!existsSync(process.argv[2]) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
if (!existsSync(process.argv[2]) || Number(readFileSync(process.argv[2], "utf8")) !== child.pid) throw new Error("Descendant did not become ready");
process.stdout.write("controller completed");`);
  let descendant;
  try {
    const { result } = invoke(directory, [script, pidFile]);
    descendant = Number(readFileSync(pidFile, "utf8"));
    assert.equal(result.exitCode, 0);
    assert.equal(result.output, "controller completed");
    assert.equal(result.timedOut, false);
    assert.equal(result.errorCode, null);
    assert.doesNotThrow(() => process.kill(descendant, 0));
  } finally {
    if (descendant === undefined) {
      try { descendant = Number(readFileSync(pidFile, "utf8")); } catch { /* Child may not have started. */ }
    }
    if (Number.isSafeInteger(descendant) && descendant > 0) {
      try { process.kill(descendant); } catch (error) { if (error.code !== "ESRCH") throw error; }
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try { process.kill(descendant, 0); } catch (error) { if (error.code === "ESRCH") break; throw error; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  }
});

test("retains nonzero child exit and both output streams", t => {
  const directory = fixture(t);
  const { result, prefix } = invoke(directory, ["-e", "process.stdout.write('before failure'); process.stderr.write('failure evidence'); process.exit(17)"]);
  assert.equal(result.exitCode, 17);
  assert.equal(result.output, "before failure");
  assert.equal(result.errorCode, null);
  assert.equal(readFileSync(`${prefix}.stderr.log`, "utf8"), "failure evidence");
});

test("reports timeout and retains controller failure evidence", t => {
  const directory = fixture(t);
  const { result, prefix } = invoke(directory, ["-e", "setInterval(() => {}, 1000)"], 100);
  assert.equal(result.timedOut, true);
  assert.equal(result.errorCode, "ETIMEDOUT");
  assert.equal(result.exitCode, null);
  assert.match(readFileSync(`${prefix}.stderr.log`, "utf8"), /ETIMEDOUT/);
});
