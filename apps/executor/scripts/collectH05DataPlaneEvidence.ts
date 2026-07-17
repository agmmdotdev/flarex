import { realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { argv } from "node:process";

import { runHostedExecutorOccProof } from "../h05/hostedPostgresProof";
import { isH05FullLowercaseGitCommit } from "../h05/gitCommit";
import {
  compileH05DataPlaneEvidence,
  h05DataPlaneEvidenceFormat,
  serializeH05DataPlaneEvidence,
} from "../h05/receipt";
import { commandOutput } from "./commandOutput";
import {
  assertNewEvidencePath,
  isPathInside,
  writeNewAtomicEvidenceFile,
} from "./h05EvidenceOutput";
import { decodeVerifiedH05DataPlaneEvidenceJson } from "./h05DataPlaneEvidence";

const outputArgument = argv[2];
if (outputArgument === undefined || argv.length !== 3) {
  throw new Error(
    "Usage: pnpm collect:h05-data-plane-evidence <outside-worktree-output.json>",
  );
}

const workspaceRoot = await realpath(
  resolve(commandOutput("git", ["rev-parse", "--show-toplevel"])),
);
const requestedOutputPath = resolve(outputArgument);
const parentPath = dirname(requestedOutputPath);
const parent = await stat(parentPath);
if (!parent.isDirectory()) {
  throw new Error("H05 data-plane evidence output parent must be a directory.");
}
const outputPath = resolve(
  await realpath(parentPath),
  basename(requestedOutputPath),
);
if (isPathInside(workspaceRoot, outputPath)) {
  throw new Error("H05 data-plane evidence output must stay outside the Git worktree.");
}
const sourceCommit = readSourceCommit();
assertCleanWorktree();
await assertNewEvidencePath(outputPath);

const startedAt = new Date().toISOString();
const result = await runHostedExecutorOccProof();
const finishedAt = new Date().toISOString();
const compiled = compileH05DataPlaneEvidence({
  format: h05DataPlaneEvidenceFormat,
  source: { commit: sourceCommit, worktreeClean: true },
  window: { startedAt, finishedAt },
  run: {
    runId: result.runId,
    deploymentId: result.fixture.deploymentId,
    projectId: result.fixture.projectId,
  },
  invocation: result.invocation,
  postgresCleanup: result.cleanup,
});
if (!compiled.ok) throw new Error(compiled.message);
const dataPlaneEvidenceJson = serializeH05DataPlaneEvidence(compiled.value);
const verified = decodeVerifiedH05DataPlaneEvidenceJson(
  dataPlaneEvidenceJson,
);
if (!verified.ok) throw new Error(verified.message);
if (readSourceCommit() !== sourceCommit) {
  throw new Error("Git HEAD changed during H05 data-plane evidence collection.");
}
assertCleanWorktree();
await writeNewAtomicEvidenceFile(outputPath, dataPlaneEvidenceJson);
console.log(
  `Collected H05 data-plane evidence for ${result.fixture.deploymentId}; PostgreSQL cleanup retained ${result.cleanup.proofRowsRemaining} rows.`,
);

function readSourceCommit(): string {
  const commit = commandOutput("git", ["rev-parse", "HEAD"]);
  if (!isH05FullLowercaseGitCommit(commit)) {
    throw new Error("H05 data-plane evidence requires a full lowercase Git commit ID.");
  }
  return commit;
}

function assertCleanWorktree(): void {
  if (
    commandOutput("git", [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]) !== ""
  ) {
    throw new Error("H05 data-plane evidence collection requires a clean worktree.");
  }
}
