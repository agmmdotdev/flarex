import type { H05ControlPlaneSourceEvidence } from "../h05/controlPlaneEvidence";
import type { H05HostedProofBundle } from "../h05/hostedProofBundle";
import {
  H05SourceEvidenceError,
  h05SourceEvidenceSha256,
  readH05SourceEvidence,
} from "./h05SourceEvidence";

export type H05SourceEvidenceReader = () => H05ControlPlaneSourceEvidence;

export function validateH05HostedProofBundleLocalSource(
  bundle: H05HostedProofBundle,
  readSource: H05SourceEvidenceReader = readH05SourceEvidence,
): string | undefined {
  let current: H05ControlPlaneSourceEvidence;
  try {
    current = readSource();
  } catch (error) {
    if (
      error instanceof H05SourceEvidenceError &&
      error.code === "dirty-worktree"
    ) {
      return "H05 hosted proof bundle requires a clean local worktree.";
    }
    return "H05 hosted proof bundle local source verification could not run.";
  }
  const source = bundle.receipt.source;
  if (current.commit !== source.commit) {
    return "H05 hosted proof bundle source commit does not match local HEAD.";
  }
  if (current.wranglerVersion !== source.wranglerVersion) {
    return "H05 hosted proof bundle Wrangler version does not match the local CLI.";
  }
  if (h05SourceEvidenceSha256(current) !== source.evidenceSha256) {
    return "H05 hosted proof bundle source evidence hash does not match local Git and Wrangler state.";
  }
  return undefined;
}
