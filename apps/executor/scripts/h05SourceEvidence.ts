import { createRequire } from "node:module";

import type { H05ControlPlaneSourceEvidence } from "../h05/controlPlaneEvidence";
import { commandOutput } from "./commandOutput";
export { h05SourceEvidenceSha256 } from "../h05/controlPlaneEvidence";

export type H05SourceEvidenceErrorCode =
  | "command-failed"
  | "dirty-worktree"
  | "invalid-commit"
  | "unsupported-wrangler";

export class H05SourceEvidenceError extends Error {
  readonly code: H05SourceEvidenceErrorCode;

  constructor(code: H05SourceEvidenceErrorCode, message: string) {
    super(message);
    this.name = "H05SourceEvidenceError";
    this.code = code;
  }
}

export function readH05SourceEvidence(): H05ControlPlaneSourceEvidence {
  const commit = sourceEvidenceCommandOutput("git", ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new H05SourceEvidenceError(
      "invalid-commit",
      "H05 source evidence requires a full lowercase Git commit ID.",
    );
  }
  if (
    sourceEvidenceCommandOutput("git", [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]) !== ""
  ) {
    throw new H05SourceEvidenceError(
      "dirty-worktree",
      "H05 source evidence requires a clean worktree.",
    );
  }
  const wranglerVersion = sourceEvidenceCommandOutput(process.execPath, [
    "--no-warnings",
    createRequire(import.meta.url).resolve("wrangler"),
    "--version",
  ]);
  if (!/^4\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(wranglerVersion)) {
    throw new H05SourceEvidenceError(
      "unsupported-wrangler",
      "H05 source evidence observed an unsupported Wrangler version.",
    );
  }
  return { commit, worktreeClean: true, wranglerVersion };
}

export function assertH05SourceEvidenceUnchanged(
  expected: H05ControlPlaneSourceEvidence,
): void {
  const current = readH05SourceEvidence();
  if (
    current.commit !== expected.commit ||
    current.wranglerVersion !== expected.wranglerVersion
  ) {
    throw new Error("H05 source evidence changed during collection.");
  }
}

function sourceEvidenceCommandOutput(
  executable: string,
  args: readonly string[],
): string {
  try {
    return commandOutput(executable, args);
  } catch {
    throw new H05SourceEvidenceError(
      "command-failed",
      "H05 source evidence command could not run.",
    );
  }
}
