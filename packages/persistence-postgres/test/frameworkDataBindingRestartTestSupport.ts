import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  DataBindingSetFrame,
  DataBindingActivationRequest,
} from "../src/frameworkSchema/binding/model";

/** Thread pool keeps the isolated child to one OS process, including on timeout. */
export function runBindingRestartWorker(
  controlSchema: string,
  targetSchema: string,
  mode: "commit-exit" | "recover",
  frame: DataBindingSetFrame,
  request: DataBindingActivationRequest,
): Promise<{ code: number | string | null; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        fileURLToPath(
          new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
        ),
        "run",
        "test/frameworkDataBindingRestartWorker.postgres.test.ts",
        "--pool=threads",
        "--maxWorkers=1",
        "--no-file-parallelism",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 1_048_576,
        env: {
          ...process.env,
          FLAREX_BINDING_RESTART_MODE: mode,
          FLAREX_BINDING_CONTROL_SCHEMA: controlSchema,
          FLAREX_BINDING_TARGET_SCHEMA: targetSchema,
          FLAREX_BINDING_RESTART_FRAME: JSON.stringify(frame),
          FLAREX_BINDING_RESTART_REQUEST: JSON.stringify(request),
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error === null ? 0 : (error.code ?? null),
          output: stdout + stderr,
        }),
    );
  });
}
