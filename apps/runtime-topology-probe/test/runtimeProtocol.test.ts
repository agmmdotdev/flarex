import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeGatewaySampleRequestV1Effect,
  decodeProbeGatewaySampleV1Effect,
  completeProbeGatewaySampleV1,
  gatewaySampleFromRun,
} from "../src/runtimeProtocol";
import { validateProbeTraceV1 } from "../src/trace";
import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeSpanId,
} from "../src/identity";
import {
  decodeProbeRunRequestV1Effect,
  ProbeDurationMsSchema,
  ProbeTraceSpanV1Schema,
} from "../src/protocol";

const runId = Effect.runSync(decodeProbeRunIdEffect("p02_protocol"));
const sampleOrdinal = Effect.runSync(decodeProbeOrdinalEffect(1));

describe("P02 gateway runtime protocol", () => {
  it("validates one measured sample and its exact transported bytes", () => {
    const request = Effect.runSync(
      decodeProbeGatewaySampleRequestV1Effect({
        run: runRequest(),
        sampleOrdinal,
        phase: "measurement",
        payload: "xxxx",
      }),
    );

    expect(request.sampleOrdinal).toBe(1);
    expect(request.payload).toHaveLength(4);
  });

  it.each([
    ["phase", { phase: "warmup" }],
    ["ordinal", { sampleOrdinal: 3 }],
    ["payload size", { payload: "xxx" }],
    ["synthetic payload", { payload: "secret" }],
    ["unknown field", { extra: true }],
  ])("rejects an invalid %s relationship", (_, override) => {
    const failure = Effect.runSync(
      Effect.flip(
        decodeProbeGatewaySampleRequestV1Effect({
          run: runRequest(),
          sampleOrdinal,
          phase: "measurement",
          payload: "xxxx",
          ...override,
        }),
      ),
    );
    expect(failure.boundary).toBe("gateway-sample-request-v1");
  });

  it("completes an edge fragment only with the collector-owned root", () => {
    const run = Effect.runSync(decodeProbeRunRequestV1Effect(runRequest("edge_echo")));
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "ok" },
      spans: [],
    });
    const decoded = Effect.runSync(decodeProbeGatewaySampleV1Effect(fragment));
    const sample = completeProbeGatewaySampleV1(decoded, 1.25);

    expect(sample.spans.map(span => span.name)).toEqual(["external_request"]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
  });

  it("completes a session fragment into the exact P01 trace", () => {
    const run = Effect.runSync(decodeProbeRunRequestV1Effect(runRequest()));
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: "SJC",
      outcome: { kind: "ok" },
      spans: [
        ProbeTraceSpanV1Schema.make({
          spanId: probeSpanId(Effect.runSync(decodeProbeOrdinalEffect(1))),
          parentSpanId: probeSpanId(Effect.runSync(decodeProbeOrdinalEffect(0))),
          name: "gateway_session_rtt",
          durationMs: ProbeDurationMsSchema.make(0),
          outcome: { kind: "ok" },
        }),
      ],
    });
    const sample = completeProbeGatewaySampleV1(fragment, 2);

    expect(sample.spans.map(span => span.name)).toEqual([
      "external_request",
      "gateway_session_rtt",
    ]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
  });
});

function runRequest(scenario: "edge_echo" | "session_echo" = "session_echo") {
  return {
    protocolVersion: 1,
    runId,
    scenario,
    repetitions: 2,
    warmupRepetitions: 1,
    dimensions: {
      codeMode: "stable",
      concurrency: 1,
      journalEntries: 0,
      payloadBytes: 4,
      sessionMode: "new-session",
    },
  };
}
