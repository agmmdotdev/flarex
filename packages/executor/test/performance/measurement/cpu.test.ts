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
    cpuIntervalMicroseconds: 1_000, allocationIntervalBytes: 32_768, includeObjectsCollectedByMajorGC: true,
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
  it("retains clock uncertainty and keeps sample weights separate from observed process CPU", () => {
    const analyzed = analyzeCpuEvidence(Result.getOrThrow(decodeCpuEvidence(evidence())), { startMonotonicMs: 13, endMonotonicMs: 19 });
    expect(analyzed.alignment).toMatchObject({ status: "bracketed-estimate", offsetLowMs: -990, offsetHighMs: -988, uncertaintyMs: 2 });
    expect(analyzed).toMatchObject({ definitelyInsideSamples: 1, boundaryAmbiguousSamples: 3, outsideSamples: 0 });
    expect(analyzed.sampledFrames.find(item => item.nodeId === 2)).toMatchObject({ selfSamples: 1, sampledElapsedWeightMs: 2 });
    expect(analyzed.counters?.process.user).toBe(20_000); // More CPU microseconds than the 6ms root is valid.
    expect(analyzed.allocations).toMatchObject({ scope: "entire-profiler-window", estimatedBytes: 4_096, sampleCount: 1 });
    expect(analyzed.gc.intervals[0]).toMatchObject({ intersectionMs: 2, crossesRoot: true });
    expect(analyzed.memoryOccupancyDeltaBytes?.heapUsed).toBe(-20);
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
