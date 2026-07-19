import { describe, expect, it } from "vitest";

import {
  decodeProbeSampleResultV1Effect,
  ProbeDurationMsSchema,
} from "../src/protocol";
import {
  nearestRankPercentile,
  ProbeCohortKeyV1Schema,
  ProbeLatencySummaryV1Schema,
  ProbePercentile,
  summarizeProbeMeasurements,
  summarizeProbeSamples,
} from "../src/statistics";
import { controlledSample, validSample } from "./fixtures";
import { runEffectTestSync } from "./effectTest";

const duration = (value: number) => ProbeDurationMsSchema.make(value);

describe("runtime topology probe statistics", () => {
  it("uses exact nearest-rank percentiles without mutating input", () => {
    const values = [duration(10), duration(1), duration(3), duration(2)];
    expect(nearestRankPercentile(values, ProbePercentile.median)).toBe(2);
    expect(nearestRankPercentile(values, ProbePercentile.p95)).toBe(10);
    expect(nearestRankPercentile(values, ProbePercentile.p99)).toBe(10);
    expect(values).toEqual([10, 1, 3, 2]);
    expect(nearestRankPercentile([], ProbePercentile.median)).toBeNull();
  });

  it("counts failures instead of dropping them from the summary", () => {
    expect(
      summarizeProbeMeasurements([
        { kind: "success", durationMs: duration(1) },
        { kind: "failure" },
        { kind: "success", durationMs: duration(5) },
      ]),
    ).toEqual({
      count: 3,
      successCount: 2,
      failureCount: 1,
      minMs: 1,
      medianMs: 1,
      p95Ms: 5,
      p99Ms: 5,
      maxMs: 5,
    });
  });

  it("rejects contradictory or unordered latency summaries", () => {
    expect(() => ProbeLatencySummaryV1Schema.make({
      count: 1,
      successCount: 0,
      failureCount: 1,
      minMs: duration(1),
      medianMs: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
    })).toThrow();
    expect(() => ProbeLatencySummaryV1Schema.make({
      count: 1,
      successCount: 1,
      failureCount: 0,
      minMs: duration(5),
      medianMs: duration(4),
      p95Ms: duration(6),
      p99Ms: duration(6),
      maxMs: duration(6),
    })).toThrow();
  });

  it("treats failed and structurally incomplete samples as failures", () => {
    const success = validSample("edge_echo");
    const incomplete = {
      ...validSample("session_echo"),
      spans: validSample("session_echo").spans.slice(0, 1),
    };
    const failedBase = validSample("edge_echo");
    const failedRoot = failedBase.spans[0];
    if (failedRoot === undefined) throw new Error("Missing failed root span.");
    const failed = runEffectTestSync(
      decodeProbeSampleResultV1Effect({
        ...failedBase,
        outcome: {
          kind: "error",
          error: {
            code: "runtime_failure",
            stage: "external_request",
            retryable: false,
          },
        },
        spans: [
          {
            ...failedRoot,
            outcome: {
              kind: "error",
              error: {
                code: "runtime_failure",
                stage: "external_request",
                retryable: false,
              },
            },
          },
        ],
      }),
    );

    const summaries = summarizeProbeSamples([
      controlledSample(success),
      controlledSample(incomplete),
      controlledSample(failed),
    ]);
    const edgeSummary = summaries.find(
      summary => summary.cohort.scenario === "edge_echo",
    );
    const incompleteSummary = summaries.find(
      summary =>
        summary.cohort.scenario === "session_echo" &&
        summary.cohort.spanName === "gateway_session_rtt",
    );
    expect(edgeSummary?.latency).toMatchObject({
      count: 2,
      successCount: 1,
      failureCount: 1,
    });
    expect(incompleteSummary?.latency).toMatchObject({
      count: 1,
      successCount: 0,
      failureCount: 1,
    });
  });

  it("separates scenarios, dimensions, callback cohorts, and every hop", () => {
    const first = validSample("full_invoke");
    const second = validSample("full_invoke", {
      dimensions: {
        ...first.dimensions,
        payloadBytes: 128,
      },
    });
    const summaries = summarizeProbeSamples([
      controlledSample(first),
      controlledSample(second),
    ]);

    expect(summaries).toHaveLength(16);
    expect(
      summaries.every(summary => summary.latency.count === 1),
    ).toBe(true);
    expect(
      new Set(summaries.map(summary => summary.cohort.spanName)).size,
    ).toBe(8);
    expect(
      new Set(summaries.map(summary => summary.cohort.payloadBytes)),
    ).toEqual(new Set([0, 128]));
  });

  it("separates first-activation and warm-reuse observations", () => {
    const first = validSample("facet_finalizer_warm_invoke", {
      startup: {
        workerLoader: "callback-ran",
        facet: "callback-ran",
        sessionActivation: "activation-observed",
      },
    });
    const warm = validSample("facet_finalizer_warm_invoke", {
      startup: {
        workerLoader: "callback-not-run",
        facet: "callback-not-run",
        sessionActivation: "activation-not-observed",
      },
    });
    const summaries = summarizeProbeSamples([
      controlledSample(first),
      controlledSample(warm),
    ]);

    expect(new Set(summaries.map(summary => summary.cohort.sessionActivation)))
      .toEqual(new Set([
        "activation-observed",
        "activation-not-observed",
      ]));
    expect(summaries.every(summary => summary.latency.count === 1)).toBe(true);

    const warmCohort = summaries.find(
      summary =>
        summary.cohort.sessionActivation === "activation-not-observed",
    )?.cohort;
    if (warmCohort === undefined) throw new Error("warm cohort is missing");
    const { sessionActivation: _activation, ...missingActivation } = warmCohort;
    expect(() => ProbeCohortKeyV1Schema.make(missingActivation)).toThrow();

    const ordinaryCohort = summarizeProbeSamples([
      controlledSample(validSample("edge_echo")),
    ])[0]?.cohort;
    if (ordinaryCohort === undefined) throw new Error("ordinary cohort is missing");
    expect(() => ProbeCohortKeyV1Schema.make({
      ...ordinaryCohort,
      sessionActivation: "activation-observed",
    })).toThrow();
  });

  it("keeps duplicate wakes out of eligible latency cohorts", () => {
    const sample = validSample("commit_wake");
    const summaries = summarizeProbeSamples([
      controlledSample(sample),
      controlledSample(sample, {
        measurementDisposition: "excluded-duplicate-wake",
        syncWake: { kind: "observed", disposition: "duplicate" },
      }),
    ]);
    const eligible = summaries.filter(
      summary => summary.cohort.measurementDisposition === "eligible",
    );
    const duplicate = summaries.filter(
      summary =>
        summary.cohort.measurementDisposition === "excluded-duplicate-wake",
    );

    expect(eligible).toHaveLength(3);
    expect(duplicate).toHaveLength(3);
    expect(eligible.every(summary => summary.latency.count === 1)).toBe(true);
    expect(duplicate.every(summary => summary.latency.count === 1)).toBe(true);
    expect(eligible[0]?.cohort).toMatchObject({
      configuredConcurrency: 1,
      observedOutstandingClaims: 1,
      phase: "measurement",
    });
  });
});
