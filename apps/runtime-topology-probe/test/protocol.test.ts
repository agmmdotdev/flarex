import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeProbeRunIdEffect } from "../src/identity";
import {
  decodeProbeRunRequestV1Effect,
  decodeProbeSampleResultV1Effect,
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
} from "../src/protocol";
import { validSample } from "./fixtures";

const runId = Effect.runSync(decodeProbeRunIdEffect("run_a"));

describe("runtime topology probe protocol", () => {
  it("decodes one exact bounded run request", () => {
    const decoded = Effect.runSync(
      decodeProbeRunRequestV1Effect(validRequest()),
    );
    expect(decoded.runId).toBe(runId);
    expect(decoded.scenario).toBe("full_invoke");
    expect(decoded.repetitions).toBe(10);
  });

  it.each([
    ["unknown field", { ...validRequest(), extra: true }],
    ["zero repetitions", { ...validRequest(), repetitions: 0 }],
    [
      "unbounded payload",
      {
        ...validRequest(),
        dimensions: {
          ...validRequest().dimensions,
          payloadBytes: PROBE_LIMITS_V1.maxPayloadBytes + 1,
        },
      },
    ],
    [
      "too many new-code creations",
      {
        ...validRequest(),
        repetitions: PROBE_LIMITS_V1.maxNewCodeRepetitions + 1,
        dimensions: { ...validRequest().dimensions, codeMode: "new-code" },
      },
    ],
    [
      "new-code warmup creation",
      {
        ...validRequest(),
        warmupRepetitions: 1,
        dimensions: { ...validRequest().dimensions, codeMode: "new-code" },
      },
    ],
  ])("rejects %s with a typed protocol failure", (_, value) => {
    const failure = Effect.runSync(
      Effect.flip(decodeProbeRunRequestV1Effect(value)),
    );
    expect(failure._tag).toBe("ProbeProtocolValidationError");
    expect(failure.boundary).toBe("run-request-v1");
  });

  it("rejects non-canonical durations and raw error details", () => {
    const sample = validSample("edge_echo");
    const invalidDuration = {
      ...sample,
      spans: [{ ...sample.spans[0], durationMs: Number.POSITIVE_INFINITY }],
    };
    const rawErrorDetail = {
      ...sample,
      outcome: {
        kind: "error",
        error: {
          code: "runtime_failure",
          stage: "external_request",
          retryable: false,
          message: "sensitive",
        },
      },
    };

    const durationFailure = Effect.runSync(
      Effect.flip(decodeProbeSampleResultV1Effect(invalidDuration)),
    );
    const detailFailure = Effect.runSync(
      Effect.flip(decodeProbeSampleResultV1Effect(rawErrorDetail)),
    );
    expect(durationFailure.boundary).toBe("sample-result-v1");
    expect(detailFailure.boundary).toBe("sample-result-v1");
  });

  it("rejects cross-run and wrong execution identities", () => {
    const sample = validSample("full_invoke");
    const otherRun = Effect.runSync(decodeProbeRunIdEffect("run_b"));
    const crossRun = {
      ...sample,
      sampleId: `rtp-sample-${otherRun}-0`,
    };
    const wrongIdentity = {
      ...sample,
      identity: {
        ...sample.identity,
        codeId: "rtp-code-invoke-v1-run_b-0",
      },
    };
    const wrongAttempt = {
      ...sample,
      identity: {
        ...sample.identity,
        attemptId: "rtp-attempt-run_a-0-1",
      },
    };
    const wrongStartupCohort = {
      ...sample,
      startup: {
        workerLoader: "not-applicable",
        facet: "not-applicable",
      },
    };
    const impossibleStartupOrdering = {
      ...sample,
      startup: {
        workerLoader: "callback-ran",
        facet: "callback-not-run",
      },
    };

    expect(
      Effect.runSync(
        Effect.flip(decodeProbeSampleResultV1Effect(crossRun)),
      ).boundary,
    ).toBe("sample-result-v1");
    expect(
      Effect.runSync(
        Effect.flip(decodeProbeSampleResultV1Effect(wrongIdentity)),
      ).boundary,
    ).toBe("sample-result-v1");
    expect(
      Effect.runSync(
        Effect.flip(decodeProbeSampleResultV1Effect(wrongAttempt)),
      ).boundary,
    ).toBe("sample-result-v1");
    expect(
      Effect.runSync(
        Effect.flip(decodeProbeSampleResultV1Effect(wrongStartupCohort)),
      ).boundary,
    ).toBe("sample-result-v1");
    expect(
      Effect.runSync(
        Effect.flip(
          decodeProbeSampleResultV1Effect(impossibleStartupOrdering),
        ),
      ).boundary,
    ).toBe("sample-result-v1");
  });

  it.each([
    [
      "edge new-code mode",
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId,
        scenario: "edge_echo",
        repetitions: 1,
        warmupRepetitions: 0,
        dimensions: {
          codeMode: "new-code",
          concurrency: 1,
          journalEntries: 0,
          payloadBytes: 0,
          sessionMode: "new-session",
        },
      },
    ],
    [
      "direct Dynamic Worker session reuse",
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId,
        scenario: "dynamic_direct_echo",
        repetitions: 1,
        warmupRepetitions: 0,
        dimensions: {
          codeMode: "stable",
          concurrency: 1,
          journalEntries: 0,
          payloadBytes: 0,
          sessionMode: "reuse-session",
        },
      },
    ],
    [
      "session echo journal entries",
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId,
        scenario: "session_echo",
        repetitions: 1,
        warmupRepetitions: 0,
        dimensions: {
          codeMode: "stable",
          concurrency: 1,
          journalEntries: 1,
          payloadBytes: 0,
          sessionMode: "new-session",
        },
      },
    ],
  ])("rejects non-applicable dimensions for %s", (_, request) => {
    const failure = Effect.runSync(
      Effect.flip(decodeProbeRunRequestV1Effect(request)),
    );
    expect(failure.boundary).toBe("run-request-v1");
  });
});

function validRequest(): Record<string, unknown> & {
  readonly dimensions: Record<string, unknown>;
} {
  return {
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    scenario: "full_invoke",
    repetitions: 10,
    warmupRepetitions: 2,
    dimensions: {
      codeMode: "stable",
      concurrency: 1,
      journalEntries: 2,
      payloadBytes: 64,
      sessionMode: "new-session",
    },
  };
}
