import { describe, expect, it } from "vitest";

import { decideTaskComputeDispatchRecovery } from
  "../src/taskComputeDelivery/DispatchRecoveryDecision";

describe("DTE06-C3 Trigger-derived dispatch recovery decision", () => {
  it("preserves moved, unchanged, and probe-uncertain branch order", () => {
    expect(decideTaskComputeDispatchRecovery({ kind: "state_moved" }))
      .toEqual({ kind: "do_not_replay", reason: "state_moved" });
    expect(decideTaskComputeDispatchRecovery({ kind: "state_unchanged" }))
      .toEqual({ kind: "replay_same_identity" });
    expect(decideTaskComputeDispatchRecovery({ kind: "probe_uncertain" }))
      .toEqual({ kind: "do_not_decide", reason: "probe_uncertain" });
  });
});
