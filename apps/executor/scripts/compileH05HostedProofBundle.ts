import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { argv } from "node:process";

import { decodeH05ControlPlaneEvidenceJson } from "../h05/controlPlaneEvidence";
import {
  compileH05HostedProofBundle,
  decodeH05HostedProofBundleJson,
  h05MaximumHostedProofBundleBytes,
  serializeH05HostedProofBundle,
} from "../h05/hostedProofBundle";
import { decodeH05ProbeTeardownEvidenceJson } from "../h05/probeTeardownEvidence";
import { decodeH05DataPlaneEvidenceJson } from "../h05/receipt";
import { decodeH05TraceEvidenceJson } from "../h05/traceEvidence";
import {
  assertNewEvidencePath,
  isPathInside,
  writeNewAtomicEvidenceFile,
} from "./h05EvidenceOutput";
import {
  assertH05SourceEvidenceUnchanged,
  h05SourceEvidenceSha256,
  readH05SourceEvidence,
} from "./h05SourceEvidence";

const maximumInputBytes = 6 * 1024 * 1024;
const controlBeforeArgument = argv[2];
const dataPlaneArgument = argv[3];
const controlAfterArgument = argv[4];
const probeTeardownArgument = argv[5];
const traceArgument = argv[6];
const outputArgument = argv[7];
if (
  controlBeforeArgument === undefined ||
  dataPlaneArgument === undefined ||
  controlAfterArgument === undefined ||
  probeTeardownArgument === undefined ||
  traceArgument === undefined ||
  outputArgument === undefined ||
  argv.length !== 8
) {
  throw new Error(
    "Usage: pnpm compile:h05-hosted-proof-bundle <control-before.json> <data-plane.json> <control-after.json> <probe-teardown.json> <trace.json> <outside-worktree-output.json>",
  );
}

const workspaceRoot = await realpath(
  resolve(commandOutput("git", ["rev-parse", "--show-toplevel"])),
);
const [controlBeforeJson, dataPlaneJson, controlAfterJson, teardownJson, traceJson, outputPath] =
  await Promise.all([
    readOutsideWorktreeInput(
      workspaceRoot,
      controlBeforeArgument,
      "control-before",
    ),
    readOutsideWorktreeInput(workspaceRoot, dataPlaneArgument, "data-plane"),
    readOutsideWorktreeInput(
      workspaceRoot,
      controlAfterArgument,
      "control-after",
    ),
    readOutsideWorktreeInput(
      workspaceRoot,
      probeTeardownArgument,
      "probe-teardown",
    ),
    readOutsideWorktreeInput(workspaceRoot, traceArgument, "trace"),
    resolveOutsideWorktreeOutput(workspaceRoot, outputArgument),
  ]);
await assertNewEvidencePath(outputPath);

const controlPlaneBefore = decodeH05ControlPlaneEvidenceJson(controlBeforeJson);
if (!controlPlaneBefore.ok) throw new Error(controlPlaneBefore.message);
const dataPlane = decodeH05DataPlaneEvidenceJson(dataPlaneJson);
if (!dataPlane.ok) throw new Error(dataPlane.message);
const controlPlaneAfter = decodeH05ControlPlaneEvidenceJson(controlAfterJson);
if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
const probeTeardown = decodeH05ProbeTeardownEvidenceJson(teardownJson);
if (!probeTeardown.ok) throw new Error(probeTeardown.message);
const trace = decodeH05TraceEvidenceJson(traceJson);
if (!trace.ok) throw new Error(trace.message);

const bundle = compileH05HostedProofBundle(
  controlPlaneBefore.value,
  dataPlane.value,
  controlPlaneAfter.value,
  probeTeardown.value,
  trace.value,
);
if (!bundle.ok) throw new Error(bundle.message);
const source = readH05SourceEvidence();
if (
  source.commit !== bundle.value.receipt.source.commit ||
  source.wranglerVersion !== bundle.value.receipt.source.wranglerVersion ||
  h05SourceEvidenceSha256(source) !==
    bundle.value.receipt.source.evidenceSha256
) {
  throw new Error(
    "H05 hosted proof bundle does not match the current clean source evidence.",
  );
}
const serialized = serializeH05HostedProofBundle(bundle.value);
if (
  new TextEncoder().encode(serialized).byteLength >
  h05MaximumHostedProofBundleBytes
) {
  throw new Error("H05 hosted proof bundle exceeds the 16 MiB verification limit.");
}
const verified = decodeH05HostedProofBundleJson(serialized);
if (!verified.ok) throw new Error(verified.message);
assertH05SourceEvidenceUnchanged(source);
await writeNewAtomicEvidenceFile(outputPath, serialized);
console.log(
  `Compiled H05 hosted proof bundle ${bundle.value.bundleSha256} for ${bundle.value.receipt.run.deploymentId}.`,
);

async function readOutsideWorktreeInput(
  workspaceRoot: string,
  argument: string,
  label: string,
): Promise<string> {
  const path = await realpath(resolve(argument));
  if (isPathInside(workspaceRoot, path)) {
    throw new Error(`H05 ${label} evidence input must stay outside the Git worktree.`);
  }
  const inputStat = await stat(path);
  if (!inputStat.isFile() || inputStat.size > maximumInputBytes) {
    throw new Error(
      `H05 ${label} evidence input must be a regular file no larger than 6 MiB.`,
    );
  }
  return readFile(path, "utf8");
}

async function resolveOutsideWorktreeOutput(
  workspaceRoot: string,
  argument: string,
): Promise<string> {
  const requestedOutputPath = resolve(argument);
  const parentPath = dirname(requestedOutputPath);
  const parent = await stat(parentPath);
  if (!parent.isDirectory()) {
    throw new Error("H05 hosted proof bundle output parent must be a directory.");
  }
  const outputPath = resolve(
    await realpath(parentPath),
    basename(requestedOutputPath),
  );
  if (isPathInside(workspaceRoot, outputPath)) {
    throw new Error("H05 hosted proof bundle output must stay outside the Git worktree.");
  }
  return outputPath;
}

function commandOutput(executable: string, args: readonly string[]): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    windowsHide: true,
  }).trim();
}
