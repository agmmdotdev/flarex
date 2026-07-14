import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { createRequire } from "node:module";

const targets = {
  gateway: {
    bundleUrl: new URL("../dist/gateway/gatewayWorker.js", import.meta.url),
    config: "wrangler.gateway.jsonc",
    metafile: "dist/gateway/bundle-meta.json",
    metafileUrl: new URL(
      "../dist/gateway/bundle-meta.json",
      import.meta.url,
    ),
    outdir: "dist/gateway",
  },
  mock: {
    bundleUrl: new URL("../dist/mock/mockCommitWorker.js", import.meta.url),
    config: "wrangler.mock.jsonc",
    metafile: "dist/mock/bundle-meta.json",
    metafileUrl: new URL(
      "../dist/mock/bundle-meta.json",
      import.meta.url,
    ),
    outdir: "dist/mock",
  },
  sync: {
    bundleUrl: new URL("../dist/sync/syncWorker.js", import.meta.url),
    config: "wrangler.sync.jsonc",
    metafile: "dist/sync/bundle-meta.json",
    metafileUrl: new URL(
      "../dist/sync/bundle-meta.json",
      import.meta.url,
    ),
    outdir: "dist/sync",
  },
} as const;

const targetName = process.argv[2] ?? "gateway";
if (!isDryRunTarget(targetName)) {
  console.error("Usage: runWranglerDryRun.ts gateway|mock|sync");
  process.exit(1);
}
const target = targets[targetName];
await Promise.all([
  rm(target.bundleUrl, { force: true }),
  rm(target.metafileUrl, { force: true }),
]);

const wranglerCli = createRequire(import.meta.url).resolve("wrangler");
const child = spawn(
  process.execPath,
  [
    "--no-warnings",
    "--experimental-vm-modules",
    wranglerCli,
    "deploy",
    "--dry-run",
    "--config",
    target.config,
    "--outdir",
    target.outdir,
    "--metafile",
    target.metafile,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let outputTail = "";
let dryRunCompleted = false;
let spawnError: Error | undefined;
let exitCode: number | null | undefined;
let closed = false;
child.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  outputTail = `${outputTail}${chunk.toString("utf8")}`.slice(-512);
  if (outputTail.includes("--dry-run: exiting now.")) {
    dryRunCompleted = true;
  }
});
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
});
child.once("error", error => {
  spawnError = error;
});
child.once("exit", code => {
  exitCode = code;
});
child.once("close", () => {
  closed = true;
});

const deadline = Date.now() + 60_000;
while (!(dryRunCompleted && await filesExist(target.bundleUrl, target.metafileUrl))) {
  if (spawnError !== undefined) {
    await failAfterTermination(
      `Wrangler dry-run failed to start: ${spawnError.message}`,
      1,
    );
  }
  if (exitCode !== undefined) {
    await waitFor(() => closed, 1_000);
    if (
      dryRunCompleted &&
      await filesExist(target.bundleUrl, target.metafileUrl)
    ) {
      break;
    }
    await failAfterTermination(
      "Wrangler dry-run exited before emitting its success sentinel and fresh output files.",
      exitCode === 0 ? 1 : (exitCode ?? 1),
    );
  }
  if (Date.now() >= deadline) {
    await failAfterTermination(
      "Wrangler dry-run did not emit fresh output within 60 seconds.",
      1,
    );
  }
  await wait(25);
}

await wait(250);
if (exitCode !== undefined && exitCode !== 0) {
  await failAfterTermination(
    "Wrangler dry-run exited unsuccessfully after its success sentinel.",
    exitCode ?? 1,
  );
}
if (!(await terminateWranglerChild())) {
  console.error("Wrangler dry-run process did not terminate after escalation.");
  process.exit(1);
}
if (!closed) await waitFor(() => closed, 250);
child.stdout.destroy();
child.stderr.destroy();
process.exit(0);

async function failAfterTermination(
  message: string,
  code: number,
): Promise<never> {
  const terminated = await terminateWranglerChild();
  if (!terminated) {
    console.error("Wrangler dry-run process did not terminate after escalation.");
  }
  console.error(message);
  process.exit(code);
}

async function terminateWranglerChild(): Promise<boolean> {
  if (spawnError !== undefined || exitCode !== undefined) return true;
  child.kill();
  if (await waitFor(() => exitCode !== undefined, 5_000)) return true;
  child.kill("SIGKILL");
  return await waitFor(() => exitCode !== undefined, 2_000);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const waitDeadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= waitDeadline) return false;
    await wait(25);
  }
  return true;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function filesExist(...urls: ReadonlyArray<URL>): Promise<boolean> {
  try {
    await Promise.all(urls.map(url => access(url)));
    return true;
  } catch {
    return false;
  }
}

function isDryRunTarget(value: string): value is keyof typeof targets {
  return Object.hasOwn(targets, value);
}
