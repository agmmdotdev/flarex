import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeDirectEchoRequestV1Effect,
  decodeProbeDirectEchoResponseV1Effect,
  probeDirectWorkerCode,
  PROBE_DIRECT_WORKER_MAIN_MODULE,
} from "../src/dynamicProtocol";
import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeCodeId,
  probeSampleId,
} from "../src/identity";
import { PROBE_PROTOCOL_VERSION_V1 } from "../src/protocol";

const runId = Effect.runSync(decodeProbeRunIdEffect("p03_dynamic"));
const ordinal = Effect.runSync(decodeProbeOrdinalEffect(1));

describe("direct Dynamic Worker protocol", () => {
  it("binds stable and new-code receipts to the direct source profile", () => {
    const stable = Effect.runSync(
      decodeProbeDirectEchoRequestV1Effect(directRequest("stable")),
    );
    const newCode = Effect.runSync(
      decodeProbeDirectEchoRequestV1Effect(directRequest("new-code")),
    );

    expect(stable.codeId).toBe("rtp-code-direct-v2-stable");
    expect(newCode.codeId).toBe("rtp-code-direct-v2-p03_dynamic-1");
  });

  it("rejects another runtime profile and excess fields", () => {
    const wrongProfile = {
      ...directRequest("stable"),
      codeId: "rtp-code-facet-v2-stable",
    };
    const excess = { ...directRequest("stable"), extra: true };

    expect(
      Effect.runSync(
        Effect.flip(decodeProbeDirectEchoRequestV1Effect(wrongProfile)),
      ).boundary,
    ).toBe("direct-request");
    expect(
      Effect.runSync(
        Effect.flip(decodeProbeDirectEchoRequestV1Effect(excess)),
      ).boundary,
    ).toBe("direct-request");
  });

  it("strictly decodes the payload-free receipt", () => {
    const request = directRequest("stable");
    const decoded = Effect.runSync(
      decodeProbeDirectEchoResponseV1Effect({
        protocolVersion: request.protocolVersion,
        runId: request.runId,
        sampleId: request.sampleId,
        sampleOrdinal: request.sampleOrdinal,
        codeMode: request.codeMode,
        codeId: request.codeId,
        payloadBytes: request.payload.length,
      }),
    );
    expect(decoded.payloadBytes).toBe(4);
  });

  it("loads fixed source with no environment capabilities or outbound network", () => {
    const code = probeDirectWorkerCode();
    expect(code.mainModule).toBe(PROBE_DIRECT_WORKER_MAIN_MODULE);
    expect(code.modules[PROBE_DIRECT_WORKER_MAIN_MODULE]).toContain(
      "/v1/direct-echo",
    );
    expect(code.env).toBeUndefined();
    expect(code.globalOutbound).toBeNull();
    expect(code.limits).toEqual({ cpuMs: 50, subRequests: 1 });
  });
});

function directRequest(codeMode: "new-code" | "stable") {
  return {
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, ordinal),
    sampleOrdinal: ordinal,
    codeMode,
    codeId: codeMode === "stable"
      ? probeCodeId({ mode: "stable", profile: "direct" })
      : probeCodeId({
          mode: "new-code",
          profile: "direct",
          runId,
          version: ordinal,
        }),
    payload: "xxxx",
  };
}
