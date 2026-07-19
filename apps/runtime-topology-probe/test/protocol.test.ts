import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
} from "../src/identity";
import {
  boundedProbeIntegerSchema,
  decodeProbeRunRequestV1Effect,
  decodeProbeSampleResultV1Effect,
  probeSampleIdentityV1,
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
  sameProbeNormalizedErrorV1,
  sameProbeSampleIdentityV1,
} from "../src/protocol";
import { validSample } from "./fixtures";
import { runEffectTestSync } from "./effectTest";

const runId = Effect.runSync(decodeProbeRunIdEffect("run_a"));

describe("runtime topology probe protocol", () => {
  it("builds the shared bounded-integer protocol Schema", () => {
    const decode = Schema.decodeUnknownSync(
      boundedProbeIntegerSchema(0, 4, "probe count"),
    );

    expect(decode(0)).toBe(0);
    expect(decode(4)).toBe(4);
    const negativeZero = decode(-0);
    expect(Object.is(negativeZero, -0)).toBe(true);
    expect(() => decode(-1)).toThrow(
      "probe count must be an integer from 0 through 4",
    );
    expect(() => decode(5)).toThrow(
      "probe count must be an integer from 0 through 4",
    );
    expect(() => decode(2.5)).toThrow();
  });

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
        codeId: "rtp-code-invoke-v2-run_b-0",
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

  it("decodes historical v1 source identities without admitting them for Postgres", () => {
    const historical = validSample("full_invoke");
    const historicalCodeId = historical.identity.codeId?.replace(
      "-v2-",
      "-v1-",
    );
    const decoded = runEffectTestSync(
      decodeProbeSampleResultV1Effect({
        ...historical,
        identity: { ...historical.identity, codeId: historicalCodeId },
      }),
    );
    expect(decoded.identity.codeId).toBe(historicalCodeId);

    const postgres = validSample("facet_finalizer_postgres_warm_invoke");
    const postgresV1CodeId = postgres.identity.codeId?.replace(
      "-v2-",
      "-v1-",
    );
    expect(
      runEffectTestSync(
        Effect.flip(
          decodeProbeSampleResultV1Effect({
            ...postgres,
            identity: { ...postgres.identity, codeId: postgresV1CodeId },
          }),
        ),
      ).boundary,
    ).toBe("sample-result-v1");
  });

  it("rejects successful or partially known unobserved callback cohorts", () => {
    const sample = validSample("full_invoke");
    const successFailure = runEffectTestSync(
      Effect.flip(
        decodeProbeSampleResultV1Effect({
          ...sample,
          startup: {
            workerLoader: "callback-unobserved",
            facet: "callback-unobserved",
          },
        }),
      ),
    );
    const error = {
      code: "runtime_failure",
      retryable: false,
      stage: "gateway_session_rtt",
    } as const;
    const mixedFailure = runEffectTestSync(
      Effect.flip(
        decodeProbeSampleResultV1Effect({
          ...sample,
          outcome: { kind: "error", error },
          startup: {
            workerLoader: "callback-unobserved",
            facet: "callback-not-run",
          },
        }),
      ),
    );

    expect(successFailure.boundary).toBe("sample-result-v1");
    expect(mixedFailure.boundary).toBe("sample-result-v1");
  });

  it("compares normalized errors by every protocol field", () => {
    const error = {
      code: "runtime_failure",
      retryable: false,
      stage: "external_request",
    } as const;

    expect(sameProbeNormalizedErrorV1(error, { ...error })).toBe(true);
    expect(sameProbeNormalizedErrorV1(error, {
      ...error,
      code: "invalid_request",
    })).toBe(false);
    expect(sameProbeNormalizedErrorV1(error, {
      ...error,
      retryable: true,
    })).toBe(false);
    expect(sameProbeNormalizedErrorV1(error, {
      ...error,
      stage: "request",
    })).toBe(false);
  });

  it("compares sample identities by every protocol field", () => {
    const identity = validSample("full_invoke").identity;
    const otherRunId = Effect.runSync(decodeProbeRunIdEffect("run_b"));
    const negativeZeroOrdinal = Effect.runSync(decodeProbeOrdinalEffect(-0));
    const otherOrdinal = Effect.runSync(decodeProbeOrdinalEffect(1));
    const otherRun = Effect.runSync(
      decodeProbeRunRequestV1Effect({ ...validRequest(), runId: otherRunId }),
    );
    const otherIdentity = probeSampleIdentityV1(
      otherRun.runId,
      otherRun.scenario,
      otherRun.dimensions,
      otherOrdinal,
    );
    const newCodeRun = Effect.runSync(
      decodeProbeRunRequestV1Effect({
        ...validRequest(),
        repetitions: 2,
        warmupRepetitions: 0,
        dimensions: {
          ...validRequest().dimensions,
          codeMode: "new-code",
        },
      }),
    );
    const otherCodeIdentity = probeSampleIdentityV1(
      newCodeRun.runId,
      newCodeRun.scenario,
      newCodeRun.dimensions,
      otherOrdinal,
    );
    if (
      identity.kind !== "facet-session" ||
      otherIdentity.kind !== "facet-session" ||
      otherCodeIdentity.kind !== "facet-session"
    ) {
      throw new Error("Expected facet-session identity fixtures.");
    }

    expect(sameProbeSampleIdentityV1(identity, { ...identity })).toBe(true);
    expect(Object.is(negativeZeroOrdinal, -0)).toBe(true);
    expect(sameProbeSampleIdentityV1(identity, {
      ...identity,
      sampleOrdinal: negativeZeroOrdinal,
    })).toBe(true);
    expect(sameProbeSampleIdentityV1(
      identity,
      validSample("session_echo").identity,
    )).toBe(false);
    expect(sameProbeSampleIdentityV1(identity, {
      ...identity,
      sampleOrdinal: otherIdentity.sampleOrdinal,
    })).toBe(false);
    expect(sameProbeSampleIdentityV1(identity, {
      ...identity,
      scopeId: otherIdentity.scopeId,
    })).toBe(false);
    expect(sameProbeSampleIdentityV1(identity, {
      ...identity,
      sessionId: otherIdentity.sessionId,
    })).toBe(false);
    expect(sameProbeSampleIdentityV1(identity, {
      ...identity,
      attemptId: otherIdentity.attemptId,
    })).toBe(false);
    expect(sameProbeSampleIdentityV1(identity, {
      ...identity,
      codeId: otherCodeIdentity.codeId,
    })).toBe(false);
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
    [
      "sync rerun session reuse",
      {
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId,
        scenario: "sync_rerun",
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
