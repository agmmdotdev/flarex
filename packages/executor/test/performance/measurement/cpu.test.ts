import { Result } from "effect";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CPU_LIMITS, analyzeCpuEvidence, captureAllocationProfile, captureCpuProfile, decodeCpuEvidence, type CpuEvidence } from "./cpu";

const frame = { functionName: "work", scriptId: "1", url: join(process.cwd(), "packages/core.ts"), lineNumber: 0, columnNumber: 0 };
const rawCpu = () => ({ nodes: [
  { id: 1, callFrame: { ...frame, functionName: "(root)", url: "" }, children: [2] },
  { id: 2, callFrame: frame },
], startTime: 1_000_000, endTime: 1_010_000, samples: [2, 2, 2, 2], timeDeltas: [2_000, 2_000, 2_000, 2_000] });
const rawHeap = () => ({ head: { id: 1, callFrame: frame, selfSize: 0, children: [
  { id: 2, callFrame: frame, selfSize: 4_096, children: [] },
] }, samples: [{ size: 4_096, nodeId: 2, ordinal: 1 }] });
function evidence(): CpuEvidence {
  const memory = { atMonotonicMs: 12, rss: 100, heapTotal: 100, heapUsed: 100, external: 100,
    arrayBuffers: 100, usedHeapSize: 100, heapSizeLimit: 100, mallocedMemory: 100 };
  return { complete: true, host: { pid: 1, threadId: 0, node: "24", v8: "13", platform: "win32",
    exclusivity: "controlled-isolate-only", externalContention: "unavailable" }, limits: CPU_LIMITS,
    cpuIntervalMicroseconds: 1_000, allocationSampling: "enabled", allocationIntervalBytes: 32_768, includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true, callWindow: { startMonotonicMs: 12, endMonotonicMs: 20 },
    cpuStartCommand: { startMonotonicMs: 10, endMonotonicMs: 12 },
    cpuStopCommand: { startMonotonicMs: 20, endMonotonicMs: 22 },
    allocationWindow: { startMonotonicMs: 11, endMonotonicMs: 23 },
    cpuProfile: Result.getOrThrow(captureCpuProfile(rawCpu())), allocationProfile: Result.getOrThrow(captureAllocationProfile(rawHeap())),
    counters: { window: { startMonotonicMs: 12, endMonotonicMs: 20 }, process: { user: 20_000, system: 1_000 },
      thread: null, eventLoop: { active: 7, idle: 1, utilization: 0.875 } },
    memory: { before: memory, after: { ...memory, atMonotonicMs: 21, heapUsed: 80 } },
    gc: { supported: true, droppedEvents: 0, observerIntervals: [], events: [{ startMonotonicMs: 12, durationMs: 3, kind: 1, flags: 0 }] },
    timedOut: false, retainedBytes: 1, droppedFailures: 0, failures: [] };
}

describe("CPU evidence and pure analysis", () => {
  it("partitions retained self samples and separates executing source from authored caller provenance", () => {
    const callFrame = (url: string, functionName: string) => ({ ...frame, url, functionName });
    const value: CpuEvidence = { ...evidence(), callWindow: { startMonotonicMs: 0, endMonotonicMs: 10 },
      cpuStartCommand: { startMonotonicMs: 0, endMonotonicMs: 0 }, cpuStopCommand: { startMonotonicMs: 10, endMonotonicMs: 10 },
      cpuProfile: { startTime: 0, endTime: 10_000, samples: [3, 3, 4, 5], timeDeltas: [2_000, 2_000, 2_000, 2_000], nodes: [
        { id: 1, callFrame: callFrame("", "(root)"), children: [2, 5] },
        { id: 2, callFrame: callFrame("./node_modules/effect/dist/internal/effect.js", "runLoop"), children: [4] },
        { id: 4, callFrame: callFrame("./packages/persistence-postgres/src/owner.ts", "validate"), children: [3] },
        { id: 3, callFrame: callFrame("./node_modules/effect/dist/SchemaParser.js", "parse"), children: [] },
        { id: 5, callFrame: callFrame("", "(idle)"), children: [] },
      ] } };
    const result = analyzeCpuEvidence(value);
    expect(result.selfLocations.reduce((sum, row) => sum + row.selfSamples, 0)).toBe(result.definitelyInsideSamples);
    expect(result.selfLocations).toEqual([
      { category: "effect-schema", executionContext: "inside-effect-runner", authoredCaller: "./packages/persistence-postgres/src/owner.ts:1 validate", selfSamples: 2 },
      { category: "persistence", executionContext: "inside-effect-runner", authoredCaller: "./packages/persistence-postgres/src/owner.ts:1 validate", selfSamples: 1 },
      { category: "idle", executionContext: "outside-effect-runner", authoredCaller: null, selfSamples: 1 },
    ]);
  });
  it("retains clock uncertainty and keeps sample weights separate from observed process CPU", () => {
    const analyzed = analyzeCpuEvidence(Result.getOrThrow(decodeCpuEvidence(evidence())), { startMonotonicMs: 13, endMonotonicMs: 19 });
    expect(analyzed.alignment).toMatchObject({ status: "bracketed-estimate", offsetLowMs: -990, offsetHighMs: -988, uncertaintyMs: 2 });
    expect(analyzed).toMatchObject({ definitelyInsideSamples: 1, boundaryAmbiguousSamples: 3, outsideSamples: 0 });
    expect(analyzed.sampledFrames.find(item => item.nodeId === 2)).toMatchObject({ selfSamples: 1, sampledElapsedWeightMs: 2 });
    expect(analyzed.counters?.process.user).toBe(20_000); // More CPU microseconds than the 6ms root is valid.
    expect(analyzed.allocations).toMatchObject({ scope: "entire-profiler-window", estimatedBytes: 4_096, sampleCount: 1 });
    expect(analyzed.allocationAvailability).toBe("available");
    expect(analyzed.gc.intervals[0]).toMatchObject({ intersectionMs: 2, crossesRoot: true });
    expect(analyzed.memoryOccupancyDeltaBytes?.heapUsed).toBe(-20);
  });

  it("distinguishes disabled allocation sampling from an incomplete enabled capture", () => {
    const disabled: CpuEvidence = { ...evidence(), allocationSampling: "disabled", allocationIntervalBytes: null,
      includeObjectsCollectedByMajorGC: null, includeObjectsCollectedByMinorGC: null,
      allocationWindow: null, allocationProfile: null };
    const analyzed = analyzeCpuEvidence(Result.getOrThrow(decodeCpuEvidence(disabled)));
    expect(analyzed).toMatchObject({ complete: true, rootWindow: disabled.callWindow,
      allocationSampling: "disabled", allocationAvailability: "disabled", allocations: null });
    expect(analyzed.gc.summedRootOverlapMs).toBe(3);
    const unavailable = analyzeCpuEvidence(Result.getOrThrow(decodeCpuEvidence({ ...evidence(), complete: false, allocationProfile: null })));
    expect(unavailable).toMatchObject({ complete: false, allocationSampling: "enabled",
      allocationAvailability: "capture-unavailable", allocations: null });
    expect(Result.isFailure(decodeCpuEvidence({ ...evidence(), allocationProfile: null }))).toBe(true);
    expect(Result.isFailure(decodeCpuEvidence({ ...disabled, failures: ["cpuStop"] }))).toBe(true);
  });

  it("rejects contradictory disabled allocation settings and artifacts", () => {
    const disabled: CpuEvidence = { ...evidence(), allocationSampling: "disabled", allocationIntervalBytes: null,
      includeObjectsCollectedByMajorGC: null, includeObjectsCollectedByMinorGC: null,
      allocationWindow: null, allocationProfile: null };
    const enabled = evidence();
    for (const field of ["allocationIntervalBytes", "includeObjectsCollectedByMajorGC", "includeObjectsCollectedByMinorGC",
      "allocationWindow", "allocationProfile"] as const) {
      expect(Result.isFailure(decodeCpuEvidence({ ...disabled, [field]: enabled[field] }))).toBe(true);
    }
    expect(Result.isFailure(decodeCpuEvidence({ ...enabled, complete: false, allocationIntervalBytes: null }))).toBe(true);
  });

  it("does not invent alignment or attribution for inconsistent brackets or missing sample deltas", () => {
    const value = evidence();
    const inconsistent = analyzeCpuEvidence({ ...value, cpuStopCommand: { startMonotonicMs: 100, endMonotonicMs: 101 } });
    expect(inconsistent.complete).toBe(false);
    expect(inconsistent.alignment.status).toBe("unavailable");
    expect(inconsistent.definitelyInsideSamples).toBe(0);
    const absent = analyzeCpuEvidence({ ...value, cpuProfile: { ...Result.getOrThrow(captureCpuProfile(rawCpu())), timeDeltas: null } });
    expect(absent.complete).toBe(false);
    expect(absent.boundaryAmbiguousSamples).toBe(4);
  });

  it("rejects unknown references, duplicated ordinals and malformed inspector intervals", () => {
    expect(Result.isFailure(captureCpuProfile({ ...rawCpu(), samples: [99], timeDeltas: [1] }))).toBe(true);
    expect(Result.isFailure(captureCpuProfile({ ...rawCpu(), timeDeltas: [1] }))).toBe(true);
    expect(Result.isFailure(captureCpuProfile({ ...rawCpu(), endTime: 1 }))).toBe(true);
    const heap = rawHeap();
    expect(Result.isFailure(captureAllocationProfile({ ...heap, samples: [{ size: 1, nodeId: 99, ordinal: 1 }] }))).toBe(true);
    expect(Result.isFailure(captureAllocationProfile({ ...heap, samples: [...heap.samples, ...heap.samples] }))).toBe(true);
  });

  it("bounds tree depth/sample retention and rejects cyclic inspector trees", () => {
    expect(Result.isFailure(captureCpuProfile({ ...rawCpu(), samples: new Array(CPU_LIMITS.samples + 1) }))).toBe(true);
    const cyclic: { id: number; callFrame: typeof frame; selfSize: number; children: unknown[] } = {
      id: 1, callFrame: frame, selfSize: 0, children: [] };
    cyclic.children.push(cyclic);
    expect(Result.isFailure(captureAllocationProfile({ head: cyclic, samples: [] }))).toBe(true);
    const nodes = Array.from({ length: CPU_LIMITS.depth + 3 }, (_entry, index) => ({ id: index, callFrame: frame,
      children: index < CPU_LIMITS.depth + 2 ? [index + 1] : [] }));
    expect(Result.isFailure(captureCpuProfile({ ...rawCpu(), nodes, samples: [], timeDeltas: [] }))).toBe(true);
  });

  it("projects code provenance and excludes external labels, arbitrary properties and accessors", () => {
    const raw = rawCpu();
    raw.nodes[1] = { id: 2, callFrame: { ...frame, functionName: "secret_business_payload", url: "https://example.com?secret=x" } };
    const profile = Result.getOrThrow(captureCpuProfile({ ...raw, payload: "secret", stack: "private" }));
    expect(profile.nodes[1]?.callFrame).toMatchObject({ functionName: "[redacted]", url: "[generated]" });
    expect(JSON.stringify(profile)).not.toContain("secret");
    const getter = { ...rawCpu(), get samples(): number[] { throw new Error("getter must not run"); } };
    expect(Result.getOrThrow(captureCpuProfile(getter)).samples).toBeNull();
    const local = Result.getOrThrow(captureAllocationProfile(rawHeap()));
    expect(local.nodes[1]?.callFrame.url).toBe("./packages/core.ts");
    expect(local.nodes[1]?.callFrame.functionName).toBe("work");
  });
});
