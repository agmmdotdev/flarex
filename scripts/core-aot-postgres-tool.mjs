import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { isAbsolute } from "node:path";

// Windows pg_ctl descendants can keep anonymous pipes open after pg_ctl exits.
// Actual log-file descriptors preserve output without waiting for pipe EOF.
const [executable, prefix, timeoutText, ...args] = process.argv.slice(2);
assert(executable !== undefined && isAbsolute(executable));
assert(prefix !== undefined && isAbsolute(prefix));
const timeout = Number(timeoutText);
assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 120000);
const output = openSync(`${prefix}.stdout.log`, "wx");
let error;
try {
  error = openSync(`${prefix}.stderr.log`, "wx");
  const child = spawnSync(executable, args, { stdio: ["ignore", output, error], windowsHide: true, timeout });
  if (child.error !== undefined) writeSync(error, `\nPostgreSQL controller: ${child.error.stack ?? child.error.message}\n`);
  process.stdout.write(JSON.stringify({ exitCode: child.status, signal: child.signal,
    timedOut: child.error?.code === "ETIMEDOUT", errorCode: child.error?.code ?? null,
    output: readFileSync(`${prefix}.stdout.log`, "utf8") }));
} finally {
  closeSync(output);
  if (error !== undefined) closeSync(error);
}
