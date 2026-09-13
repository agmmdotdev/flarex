import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FrameworkMigrationBaseInstallation } from "../src/migrationCoordination/model";
import { frameworkMigrationRestartEnvironment } from "./frameworkMigrationPostgresFixture";

export function runWorker(schema: string, physical: string, mode: string, deadline: number, additiveBase?: FrameworkMigrationBaseInstallation): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run",
      "test/frameworkCoordinatorRestartWorker.postgres.test.ts", "--no-file-parallelism", "--maxWorkers=1",
    ], { cwd: fileURLToPath(new URL("..", import.meta.url)), windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env, ...frameworkMigrationRestartEnvironment(schema), FLAREX_FRAMEWORK_RESTART_SCHEMA: schema,
        FLAREX_FRAMEWORK_RESTART_PHYSICAL: physical, FLAREX_FRAMEWORK_RESTART_MODE: mode,
        ...(additiveBase === undefined ? {} : { FLAREX_FRAMEWORK_ADDITIVE_BASE: JSON.stringify(additiveBase) }) },
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
