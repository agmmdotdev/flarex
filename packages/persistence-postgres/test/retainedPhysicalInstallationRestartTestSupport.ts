import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RetainedPhysicalFixture } from "./retainedPhysicalInstallationFixture";

export type RetainedPhysicalCrashMode = "before-structure" | "after-structure" | "after-readiness" | "resume";
/** A real fresh OS process receives coordinates, never an inherited claim/token. */
export function runRetainedPhysicalWorker(fixture: RetainedPhysicalFixture, mode: RetainedPhysicalCrashMode): Promise<{ code: number | null; output: string }> {
  const ownerUrl = fixture.owner.persistence.pool.options.connectionString;
  const runtimeUrl = fixture.runtime.persistence.pool.options.connectionString;
  if (ownerUrl === undefined || runtimeUrl === undefined) throw new Error("Missing restart fixture connection coordinates");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run",
      "test/retainedPhysicalInstallationRestartWorker.postgres.test.ts", "--no-file-parallelism", "--maxWorkers=1",
    ], { cwd: fileURLToPath(new URL("..", import.meta.url)), windowsHide: true,
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FLAREX_RETAINED_PHYSICAL_MODE: mode, FLAREX_RETAINED_PHYSICAL_SCHEMA: fixture.owner.schemaName,
        FLAREX_RETAINED_PHYSICAL_JOURNAL: JSON.stringify(fixture.journal),
        FLAREX_RETAINED_PHYSICAL_OWNER_URL: ownerUrl, FLAREX_RETAINED_PHYSICAL_RUNTIME_URL: runtimeUrl } });
    let output = "";
    const timer = setTimeout(() => {
      output += "\nRetained physical worker exceeded its process deadline.\n";
      if (process.platform === "win32" && child.pid !== undefined) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true },
          error => { if (error !== null) child.kill(); });
      } else if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    }, 120_000);
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    child.once("error", cause => { clearTimeout(timer); reject(cause); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
