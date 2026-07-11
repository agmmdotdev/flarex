import { describe, expect, it } from "vitest";

import type { H05ControlPlaneSourceEvidence } from "../h05/controlPlaneEvidence";
import { h05SourceEvidenceSha256 } from "../scripts/h05SourceEvidence";

describe("H05 source evidence", () => {
  it("hashes one fixed canonical shape regardless of object insertion order", () => {
    const first: H05ControlPlaneSourceEvidence = {
      commit: "a".repeat(40),
      worktreeClean: true,
      wranglerVersion: "4.100.0",
    };
    const second: H05ControlPlaneSourceEvidence = {
      wranglerVersion: "4.100.0",
      worktreeClean: true,
      commit: "a".repeat(40),
    };

    expect(h05SourceEvidenceSha256(first)).toBe(
      h05SourceEvidenceSha256(second),
    );
  });
});
