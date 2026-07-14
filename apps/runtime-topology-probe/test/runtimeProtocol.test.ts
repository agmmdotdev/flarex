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
import { runEffectTestSync } from "./effectTest";

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

  it("completes a direct Dynamic Worker fragment and callback cohort", () => {
    const run = Effect.runSync(
      decodeProbeRunRequestV1Effect(runRequest("dynamic_direct_echo")),
    );
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "ok" },
      spans: [
        ProbeTraceSpanV1Schema.make({
          spanId: probeSpanId(Effect.runSync(decodeProbeOrdinalEffect(1))),
          parentSpanId: probeSpanId(Effect.runSync(decodeProbeOrdinalEffect(0))),
          name: "gateway_dynamic_rtt",
          durationMs: ProbeDurationMsSchema.make(1),
          outcome: { kind: "ok" },
        }),
      ],
      startup: {
        workerLoader: "callback-ran",
        facet: "not-applicable",
      },
    });
    const sample = completeProbeGatewaySampleV1(fragment, 2);

    expect(sample.identity.codeId).toBe("rtp-code-direct-v1-stable");
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });
  });

  it("keeps zero-span and cursor-prefix commit failures as measured samples", () => {
    const run = runEffectTestSync(
      decodeProbeRunRequestV1Effect(runRequest("commit_wake")),
    );
    const transportError = {
      code: "runtime_failure",
      retryable: true,
      stage: "mock_sync_wake_rtt",
    } as const;
    const transportFragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "error", error: transportError },
      spans: [],
    });
    const transportSample = completeProbeGatewaySampleV1(
      transportFragment,
      2,
    );

    expect(transportSample.spans).toHaveLength(1);
    expect(transportSample.spans[0]?.outcome).toEqual({
      kind: "error",
      error: transportError,
    });
    expect(validateProbeTraceV1(transportSample)).toEqual({
      ok: false,
      issue: "missing_or_extra_span",
      spanName: null,
    });

    const cursorError = {
      code: "runtime_failure",
      retryable: false,
      stage: "sync_cursor_io",
    } as const;
    const cursorFragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "error", error: cursorError },
      spans: [
        span("mock_sync_wake_rtt", 1, 0, { kind: "ok" }),
        span("sync_cursor_io", 2, 1, {
          kind: "error",
          error: cursorError,
        }),
      ],
    });
    const cursorSample = completeProbeGatewaySampleV1(cursorFragment, 3);

    expect(validateProbeTraceV1(cursorSample)).toEqual({ ok: true });
  });

  it("accepts a failed full-invoke prefix only with unobserved callbacks", () => {
    const run = runEffectTestSync(
      decodeProbeRunRequestV1Effect(runRequest("full_invoke")),
    );
    const error = {
      code: "runtime_failure",
      retryable: false,
      stage: "gateway_session_rtt",
    } as const;
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "error", error },
      spans: [
        span("gateway_session_rtt", 1, 0, {
          kind: "error",
          error,
        }),
      ],
      startup: {
        workerLoader: "callback-unobserved",
        facet: "callback-unobserved",
      },
    });
    const sample = completeProbeGatewaySampleV1(fragment, 3);

    expect(validateProbeTraceV1(sample)).toEqual({
      ok: false,
      issue: "missing_or_extra_span",
      spanName: null,
    });

    const failure = runEffectTestSync(
      Effect.flip(
        decodeProbeGatewaySampleV1Effect({
          ...fragment,
          outcome: { kind: "ok" },
          spans: [span("gateway_session_rtt", 1, 0, { kind: "ok" })],
        }),
      ),
    );
    expect(failure.boundary).toBe("gateway-sample-v1");
  });

  it("completes the exact sync-to-runtime rerun trace and callback cohort", () => {
    const run = runEffectTestSync(
      decodeProbeRunRequestV1Effect(runRequest("sync_rerun")),
    );
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "ok" },
      spans: [
        span("sync_runtime_rerun_rtt", 1, 0, { kind: "ok" }),
        span("gateway_session_rtt", 2, 1, { kind: "ok" }),
        span("session_facet_rtt", 3, 2, { kind: "ok" }),
      ],
      startup: {
        workerLoader: "callback-ran",
        facet: "callback-ran",
      },
    });
    const sample = completeProbeGatewaySampleV1(fragment, 3);

    expect(fragment.identity.codeId).toBe("rtp-code-rerun-v1-stable");
    expect(sample.spans.map(current => current.name)).toEqual([
      "external_request",
      "sync_runtime_rerun_rtt",
      "gateway_session_rtt",
      "session_facet_rtt",
    ]);
    expect(validateProbeTraceV1(sample)).toEqual({ ok: true });

    const staleFacetFailure = runEffectTestSync(
      Effect.flip(
        decodeProbeGatewaySampleV1Effect({
          ...fragment,
          startup: {
            workerLoader: "callback-not-run",
            facet: "callback-not-run",
          },
        }),
      ),
    );
    expect(staleFacetFailure.boundary).toBe("gateway-sample-v1");
  });

  it("keeps an unavailable sync rerun callback as a measured failure", () => {
    const run = runEffectTestSync(
      decodeProbeRunRequestV1Effect(runRequest("sync_rerun")),
    );
    const error = {
      code: "runtime_failure",
      retryable: true,
      stage: "sync_runtime_rerun_rtt",
    } as const;
    const fragment = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "error", error },
      spans: [],
      startup: {
        workerLoader: "callback-unobserved",
        facet: "callback-unobserved",
      },
    });
    const sample = completeProbeGatewaySampleV1(fragment, 3);

    expect(sample.spans).toHaveLength(1);
    expect(validateProbeTraceV1(sample)).toEqual({
      ok: false,
      issue: "missing_or_extra_span",
      spanName: null,
    });
  });

  it("rejects a failed terminal span whose name disagrees with its stage", () => {
    const run = runEffectTestSync(
      decodeProbeRunRequestV1Effect(runRequest("commit_wake")),
    );
    const validError = {
      code: "runtime_failure",
      retryable: false,
      stage: "sync_cursor_io",
    } as const;
    const valid = gatewaySampleFromRun(run, sampleOrdinal, {
      edgeColo: null,
      outcome: { kind: "error", error: validError },
      spans: [
        span("mock_sync_wake_rtt", 1, 0, { kind: "ok" }),
        span("sync_cursor_io", 2, 1, {
          kind: "error",
          error: validError,
        }),
      ],
    });
    const wrongError = {
      ...validError,
      stage: "mock_sync_wake_rtt",
    } as const;
    const failure = runEffectTestSync(
      Effect.flip(
        decodeProbeGatewaySampleV1Effect({
          ...valid,
          outcome: { kind: "error", error: wrongError },
          spans: [
            valid.spans[0],
            {
              ...valid.spans[1],
              outcome: { kind: "error", error: wrongError },
            },
          ],
        }),
      ),
    );

    expect(failure.boundary).toBe("gateway-sample-v1");
  });
});

function span(
  name: typeof ProbeTraceSpanV1Schema.Type["name"],
  spanOrdinal: number,
  parentOrdinal: number,
  outcome: typeof ProbeTraceSpanV1Schema.Type["outcome"],
) {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(runEffectTestSync(decodeProbeOrdinalEffect(spanOrdinal))),
    parentSpanId: probeSpanId(
      runEffectTestSync(decodeProbeOrdinalEffect(parentOrdinal)),
    ),
    name,
    durationMs: ProbeDurationMsSchema.make(1),
    outcome,
  });
}

function runRequest(
  scenario:
    | "commit_wake"
    | "dynamic_direct_echo"
    | "edge_echo"
    | "full_invoke"
    | "sync_rerun"
    | "session_echo" = "session_echo",
) {
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
