import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeSampleResultV1Effect,
  ProbeDurationMsSchema,
} from "../src/protocol";
import {
  nearestRankPercentile,
  ProbePercentile,
  summarizeProbeMeasurements,
  summarizeProbeSamples,
} from "../src/statistics";
import { validSample } from "./fixtures";

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

  it("treats failed and structurally incomplete samples as failures", () => {
    const success = validSample("edge_echo");
    const incomplete = {
      ...validSample("session_echo"),
      spans: validSample("session_echo").spans.slice(0, 1),
    };
    const failedBase = validSample("edge_echo");
    const failedRoot = failedBase.spans[0];
    if (failedRoot === undefined) throw new Error("Missing failed root span.");
    const failed = Effect.runSync(
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

    const summaries = summarizeProbeSamples([success, incomplete, failed]);
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
    const summaries = summarizeProbeSamples([first, second]);

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
});
