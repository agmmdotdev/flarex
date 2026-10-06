import { describe, expect, it } from "vitest";
import type { Profiler } from "node:inspector";
import { summarizeBenchmarkCpuProfile } from "./benchmarkCpuProfiler";

describe("benchmark CPU evidence", () => {
  it("keeps startup and idle/GC observations and reports actual deltas separately from the requested interval", () => {
    const profile: Profiler.Profile = {
      startTime: 1000, endTime: 401700,
      nodes: [
        { id: 1, callFrame: { functionName: "post", scriptId: "1", url: "node:inspector", lineNumber: 0, columnNumber: 0 } },
        { id: 2, callFrame: { functionName: "(idle)", scriptId: "0", url: "", lineNumber: -1, columnNumber: -1 } },
        { id: 3, callFrame: { functionName: "(garbage collector)", scriptId: "0", url: "", lineNumber: -1, columnNumber: -1 } },
        { id: 4, callFrame: { functionName: "request", scriptId: "2", url: "benchmark.ts", lineNumber: 7, columnNumber: 3 } },
      ],
      samples: [1, 2, 3, 4, 4], timeDeltas: [400000, 100, 150, 200, 250],
    };
    const original = JSON.stringify(profile);
    const evidence = summarizeBenchmarkCpuProfile(profile);
    expect(evidence).toMatchObject({ startTime: 1000, endTime: 401700, profileSpanMicroseconds: 400700,
      requestedSamplingIntervalMicroseconds: 100, sampleCount: 5, timeDeltaCount: 5,
      actualTimeDeltasMicroseconds: { first: 400000, min: 100, max: 400000, median: 200, sum: 400700 } });
    expect(evidence.sampledSelfFrames.map(frame => [frame.callFrame.functionName, frame.samples]))
      .toEqual([["request", 2], ["post", 1], ["(idle)", 1], ["(garbage collector)", 1]]);
    expect(JSON.stringify(profile)).toBe(original);
  });

  it("retains missing samples/deltas as absence rather than manufacturing timing evidence", () => {
    expect(summarizeBenchmarkCpuProfile({ nodes: [], startTime: 1, endTime: 2 })).toMatchObject({
      sampleCount: null, timeDeltaCount: null, actualTimeDeltasMicroseconds: null, sampledSelfFrames: [],
    });
  });
});
