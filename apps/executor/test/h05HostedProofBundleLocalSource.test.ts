import { describe, expect, it } from "vitest";

import { compileH05HostedProofBundle } from "../h05/hostedProofBundle";
import { H05SourceEvidenceError } from "../scripts/h05SourceEvidence";
import { validateH05HostedProofBundleLocalSource } from "../scripts/h05HostedProofBundleLocalSource";
import {
  validH05ProbeTeardownEvidence,
  validH05TraceControlPlaneEvidence,
  validH05TraceDataPlaneEvidence,
  validH05TraceEvidence,
} from "./h05TraceFixtures";

describe("H05 hosted proof bundle local source gate", () => {
  it("accepts only the exact clean source projection", () => {
    const bundle = validBundle();
    expect(
      validateH05HostedProofBundleLocalSource(bundle, () => ({
        commit: bundle.receipt.source.commit,
        worktreeClean: true,
        wranglerVersion: bundle.receipt.source.wranglerVersion,
      })),
    ).toBeUndefined();
    expect(
      validateH05HostedProofBundleLocalSource(bundle, () => ({
        commit: "f".repeat(40),
        worktreeClean: true,
        wranglerVersion: bundle.receipt.source.wranglerVersion,
      })),
    ).toContain("does not match local HEAD");
    expect(
      validateH05HostedProofBundleLocalSource(bundle, () => ({
        commit: bundle.receipt.source.commit,
        worktreeClean: true,
        wranglerVersion: "4.99.0",
      })),
    ).toContain("Wrangler version does not match");
  });

  it("preserves dirty-worktree and generic source failures", () => {
    const bundle = validBundle();
    expect(
      validateH05HostedProofBundleLocalSource(bundle, () => {
        throw new H05SourceEvidenceError(
          "dirty-worktree",
          "private detail",
        );
      }),
    ).toBe("H05 hosted proof bundle requires a clean local worktree.");
    expect(
      validateH05HostedProofBundleLocalSource(bundle, () => {
        throw new Error("private detail");
      }),
    ).toBe(
      "H05 hosted proof bundle local source verification could not run.",
    );
  });
});

function validBundle() {
  const compiled = compileH05HostedProofBundle(
    validH05TraceControlPlaneEvidence("before"),
    validH05TraceDataPlaneEvidence(),
    validH05TraceControlPlaneEvidence("after"),
    validH05ProbeTeardownEvidence(),
    validH05TraceEvidence(),
  );
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.value;
}
