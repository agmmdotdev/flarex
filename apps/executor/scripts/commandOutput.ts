import { execFileSync } from "node:child_process";

/** Runs a bounded child process and returns its trimmed UTF-8 stdout. */
export function commandOutput(
  executable: string,
  args: readonly string[],
): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    windowsHide: true,
  }).trim();
}
