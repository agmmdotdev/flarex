import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { Effect } from "effect";

import {
  type HostedReceiptCommandExecutor,
  HostedReceiptRunnerError,
  runHostedReceipt,
  type WranglerCommandResult,
} from "./hostedReceiptRunner";

const MAXIMUM_RESTART_PROBES = 20;
const RESTART_PROBE_DELAY_MILLISECONDS = 5_000;
const HOSTED_REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const HOSTED_RUN_TIMEOUT_MILLISECONDS = 10 * 60_000;
const WRANGLER_TIMEOUT_MILLISECONDS = 180_000;
const appRoot = new URL("../", import.meta.url);
const wranglerCli = createRequire(import.meta.url).resolve("wrangler");

const commands: HostedReceiptCommandExecutor = {
  run: (args, input) => runWrangler(args, input),
};

const runId = randomBytes(12).toString("hex");
const receipt = await Effect.runPromise(runHostedReceipt(
  {
    commands,
    fetch: (input, init) => fetch(input, init),
    stage: value => {
      process.stdout.write(`${JSON.stringify({
        kind: "fx02b-hosted-stage",
        stage: value,
      })}\n`);
    },
  },
  {
    runId,
    initialMarker: `fx02b-${runId}-initial`,
    restartMarker: `fx02b-${runId}-restart`,
    gatewayToken: randomBytes(32).toString("base64url"),
    probeToken: randomBytes(32).toString("base64url"),
    executorToken: randomBytes(32).toString("base64url"),
  },
  {
    maximumRestartProbes: MAXIMUM_RESTART_PROBES,
    restartProbeDelayMilliseconds: RESTART_PROBE_DELAY_MILLISECONDS,
    requestTimeoutMilliseconds: HOSTED_REQUEST_TIMEOUT_MILLISECONDS,
    overallTimeoutMilliseconds: HOSTED_RUN_TIMEOUT_MILLISECONDS,
  },
));

process.stdout.write(`${JSON.stringify(receipt)}\n`);

function runWrangler(
  args: readonly string[],
  input?: string,
): Effect.Effect<WranglerCommandResult, HostedReceiptRunnerError> {
  const command = Effect.tryPromise({
    try: signal => runWranglerProcess(args, input, signal),
    catch: cause => new HostedReceiptRunnerError({
      operation: "runWrangler",
      reason: "commandFailed",
      message: "Wrangler subprocess failed.",
      cause,
    }),
  });
  return command.pipe(Effect.timeoutOrElse({
    duration: `${WRANGLER_TIMEOUT_MILLISECONDS} millis`,
    orElse: () => Effect.fail(new HostedReceiptRunnerError({
      operation: "runWrangler",
      reason: "commandFailed",
      message: "Wrangler subprocess exceeded its deadline.",
    })),
  }));
}

function runWranglerProcess(
  args: readonly string[],
  input: string | undefined,
  signal: AbortSignal,
): Promise<WranglerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], {
      cwd: filePath(appRoot),
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      child.kill();
      reject(new Error("Wrangler subprocess pipes were not created."));
      return;
    }
    child.stdin.end(input);
    let output = "";
    child.stdout.on("data", chunk => {
      output += String(chunk);
    });
    child.stderr.on("data", chunk => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("close", value => resolve(Object.freeze({
      code: value ?? 1,
      output,
    })));
  });
}

function filePath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
}
