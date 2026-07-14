import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
  probeSpanId,
} from "../src/identity";

describe("runtime topology probe identities", () => {
  it("derives deterministic, purpose-separated synthetic identities", () => {
    const runId = Effect.runSync(decodeProbeRunIdEffect("run_a"));
    const zero = Effect.runSync(decodeProbeOrdinalEffect(0));
    const one = Effect.runSync(decodeProbeOrdinalEffect(1));

    expect(probeScopeId(runId)).toBe("rtp-scope-run_a");
    expect(probeSampleId(runId, one)).toBe("rtp-sample-run_a-1");
    expect(probeSessionId(runId, one)).toBe("rtp-session-run_a-1");
    expect(probeAttemptId(runId, one, zero)).toBe(
      "rtp-attempt-run_a-1-0",
    );
    expect(probeCodeId({ mode: "stable", profile: "direct" })).toBe(
      "rtp-code-direct-v1-stable",
    );
    expect(probeCodeId({
      mode: "new-code",
      profile: "facet",
      runId,
      version: one,
    })).toBe(
      "rtp-code-facet-v1-run_a-1",
    );
    expect(probeSpanId(one)).toBe("rtp-span-1");
  });

  it("keeps every execution profile code identity distinct", () => {
    const profiles = ["direct", "facet", "invoke", "rerun"] as const;
    const identities = profiles.map(
      profile => probeCodeId({ mode: "stable", profile }),
    );

    expect(new Set(identities).size).toBe(identities.length);
  });

  it.each(["", "UPPER", "-leading", "contains space", "a".repeat(41)])(
    "rejects invalid run ID %j with a typed identity error",
    value => {
      const failure = Effect.runSync(
        Effect.flip(decodeProbeRunIdEffect(value)),
      );
      expect(failure._tag).toBe("ProbeIdentityValidationError");
      expect(failure.field).toBe("runId");
    },
  );

  it.each([-1, 1.5, 1_000_000, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid ordinal %s",
    value => {
      const failure = Effect.runSync(
        Effect.flip(decodeProbeOrdinalEffect(value)),
      );
      expect(failure._tag).toBe("ProbeIdentityValidationError");
      expect(failure.field).toBe("ordinal");
    },
  );
});
