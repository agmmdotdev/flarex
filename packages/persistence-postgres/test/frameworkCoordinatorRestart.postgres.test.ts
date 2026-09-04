import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countNativeRows, withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";

const native = postgresUrl === null ? describe.skip : describe;
native("native coordinator process restart", () => {
  it.each([
    ["partial", 2, 0], ["before-step", 0, 0], ["after-step", 1, 0], ["after-finalize", 7, 1],
  ] as const)("recovers %s after the worker process terminates", async (mode, prefix, publications) => {
    await withNativeCoordinator(async fixture => {
      const schema = (await fixture.persistence.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
      if (schema === undefined) throw new Error("Missing metadata schema");
      const processDeadline = performance.now() + 240_000;
      const crashed = await runWorker(schema, fixture.physicalSchema, mode, processDeadline);
      expect(crashed.code, crashed.output).not.toBe(0);
      // The observed durable prefix pins the exact crash edge; a random worker
      // launch/import failure cannot satisfy the restart test.
      expect(await countNativeRows(fixture, "fx_system_framework_migration_attempt_start")).toBe(1);
      expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(prefix);
      expect(await countNativeRows(fixture, "fx_system_framework_schema_installation")).toBe(publications);
      const resumed = await runWorker(schema, fixture.physicalSchema, "resume", processDeadline);
      expect(resumed.code, resumed.output).toBe(0);
      expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(7);
      for (const suffix of ["installation", "readiness", "availability_history", "availability_head"]) {
        expect(await countNativeRows(fixture, `fx_system_framework_schema_${suffix}`)).toBe(1);
      }
    });
  }, 300_000);
});

function runWorker(schema: string, physical: string, mode: string, deadline: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run",
      "test/frameworkCoordinatorRestartWorker.postgres.test.ts", "--no-file-parallelism", "--maxWorkers=1",
    ], { cwd: fileURLToPath(new URL("..", import.meta.url)), windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env, FLAREX_FRAMEWORK_RESTART_SCHEMA: schema,
        FLAREX_FRAMEWORK_RESTART_PHYSICAL: physical, FLAREX_FRAMEWORK_RESTART_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      output += "\nRestart worker exceeded its process deadline.\n";
      if (process.platform === "win32" && child.pid !== undefined) {
        // Terminate only this fixture's known process tree, including Vitest's
        // worker, then wait for the child's exit before the fixture can close.
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true },
          error => { if (error !== null) child.kill(); });
      } else if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch { child.kill("SIGKILL"); }
      }
    }, Math.max(1, deadline - performance.now()));
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); resolve({ code, output }); });
  });
}
