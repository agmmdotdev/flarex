import { Cause } from "effect";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeCpuEvidence, CPU_LIMITS } from "../cpu";
import { assertCpuMeasurementIdle, CpuMeasurementConflict, createCpuMeasurementCollector, type CpuCollectorRuntime } from "./cpu";

function fixture() {
  let tick = 0, memoryReads = 0, counterReads = 0;
  const calls: string[] = [], parameters = new Map<string, object | undefined>();
  const errors = new Map<string, unknown>();
  const frame = { functionName: "work", scriptId: "1", url: join(process.cwd(), "packages/core.ts"), lineNumber: 0, columnNumber: 0 };
  const cpuProfile = { nodes: [{ id: 1, callFrame: { ...frame, functionName: "(root)", url: "" }, children: [2] },
    { id: 2, callFrame: frame }], startTime: 1_000, endTime: 20_000, samples: [2], timeDeltas: [1_000] };
  const heapProfile = { head: { id: 1, callFrame: frame, selfSize: 4_096, children: [] },
    samples: [{ size: 4_096, nodeId: 1, ordinal: 1 }] };
  const pendingGc = [{ startTime: 1, duration: 2, detail: { kind: 1, flags: 0 } }];
  let gcReceive: ((entries: readonly typeof pendingGc[number][]) => void) | undefined;
  const execute = (method: string) => { calls.push(method); if (errors.has(method)) throw errors.get(method); };
  const runtime: CpuCollectorRuntime = {
    now: () => tick++, conflict: () => false, gcSupported: true,
    session: () => ({ connect: () => execute("connect"), disconnect: () => execute("disconnect"),
      post: async (method, value) => {
        parameters.set(method, value); execute(method);
        return method === "Profiler.stop" ? { profile: cpuProfile } : method === "HeapProfiler.stopSampling" ? { profile: heapProfile } : {};
      } }),
    gcObserver: receive => {
      gcReceive = receive;
      return { observe: () => execute("gcObserve"), takeRecords: () => { execute("gcRecords"); return pendingGc; },
        disconnect: () => execute("gcDisconnect") };
    },
    drainGc: async () => { execute("gcDrain"); gcReceive?.([{ startTime: 2, duration: 3, detail: { kind: 4, flags: 0 } }]); },
    counters: () => { counterReads++; return { cpu: { user: counterReads * 1_000, system: counterReads * 500 },
      thread: { user: counterReads * 500, system: counterReads * 100 },
      eventLoop: { active: counterReads * 2, idle: counterReads, utilization: 2 / 3 } }; },
    memory: () => { memoryReads++; return { rss: 100, heapTotal: 100, heapUsed: memoryReads === 1 ? 100 : 80,
      external: 50, arrayBuffers: 30, usedHeapSize: 100, heapSizeLimit: 200, mallocedMemory: 1 }; },
  };
  return { runtime, calls, parameters, errors, cpuProfile, heapProfile, pendingGc };
}

describe("request-local CPU measurement collector", () => {
  it("starts after preparation, captures exactly one invocation and fully drains before returning", async () => {
    const state = fixture(), collector = createCpuMeasurementCollector({ runtime: state.runtime });
    state.calls.push("prepare");
    expect(await collector.capture(async () => { state.calls.push("invoke"); return 7; })).toBe(7);
    state.calls.push("verify");
    expect(state.calls.indexOf("Profiler.start")).toBeGreaterThan(state.calls.indexOf("prepare"));
    expect(state.calls.indexOf("Profiler.setSamplingInterval")).toBeLessThan(state.calls.indexOf("Profiler.start"));
    expect(state.calls.indexOf("Profiler.stop")).toBeGreaterThan(state.calls.indexOf("invoke"));
    expect(state.calls.indexOf("HeapProfiler.stopSampling")).toBeLessThan(state.calls.indexOf("gcDrain"));
    expect(state.calls.indexOf("gcRecords")).toBeLessThan(state.calls.indexOf("gcDisconnect"));
    expect(state.calls.indexOf("disconnect")).toBeLessThan(state.calls.indexOf("verify"));
    expect(state.calls.filter(value => value === "invoke")).toHaveLength(1);
    expect(state.parameters.get("HeapProfiler.startSampling")).toEqual({ samplingInterval: 32_768,
      includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const evidence = collector.evidence();
    expect(evidence.complete).toBe(true);
    expect(evidence.gc.events).toHaveLength(2);
    expect(evidence.counters?.process).toEqual({ user: 1_000, system: 500 });
    expect(evidence.counters?.thread).toEqual({ user: 500, system: 100 });
    expect(evidence.callWindow?.endMonotonicMs).toBeLessThan(evidence.cpuStopCommand?.startMonotonicMs ?? 0);
    expect(analyzeCpuEvidence(evidence).memoryOccupancyDeltaBytes?.heapUsed).toBe(-20);
    expect(collector.failures()).toEqual([]);
    expect(evidence.retainedBytes).toBe(Buffer.byteLength(JSON.stringify(evidence), "utf8"));
    expect(() => assertCpuMeasurementIdle()).not.toThrow();
  });

  it("keeps original business Cause identity and every independent cleanup failure", async () => {
    const state = fixture();
    const original = Cause.combine(Cause.fail({ _tag: "Refused" }), Cause.die(new Error("defect")));
    const cpuStop = new Error("CPU stop fault"), heapStop = new Error("heap stop fault"), gc = new Error("GC disconnect fault"), session = new Error("disconnect fault");
    state.errors.set("Profiler.stop", cpuStop); state.errors.set("HeapProfiler.stopSampling", heapStop);
    state.errors.set("gcDisconnect", gc); state.errors.set("disconnect", session);
    const collector = createCpuMeasurementCollector({ runtime: state.runtime });
    const rejected = await collector.capture(async () => { throw original; }).catch((cause: unknown) => cause);
    expect(rejected).toBe(original);
    expect(collector.failures().map(failure => failure.cause)).toEqual([cpuStop, heapStop, gc, session]);
    expect(collector.evidence().complete).toBe(false);
    expect(() => assertCpuMeasurementIdle()).not.toThrow();
  });

  it.each(["connect", "Profiler.enable", "Profiler.setSamplingInterval", "Profiler.start", "HeapProfiler.enable", "HeapProfiler.startSampling", "gcObserve"])(
    "releases partially acquired resources after %s faults without changing the business result", async method => {
      const state = fixture(), failure = new Error(method);
      state.errors.set(method, failure);
      const collector = createCpuMeasurementCollector({ runtime: state.runtime });
      expect(await collector.capture(async () => "business-result")).toBe("business-result");
      expect(collector.evidence().complete).toBe(false);
      expect(collector.failures().some(fault => fault.cause === failure)).toBe(true);
      expect(state.calls.at(-1)).toBe("disconnect");
      expect(state.calls).toContain("gcDisconnect");
      if (method !== "connect") {
        expect(state.calls).toContain("Profiler.stop"); expect(state.calls).toContain("HeapProfiler.stopSampling");
      }
    });

  it("makes missing/malformed profiles incomplete and still releases both profiler domains", async () => {
    const state = fixture();
    state.cpuProfile.samples = [99];
    state.heapProfile.samples = [{ size: 4_096, nodeId: 99, ordinal: 1 }];
    const collector = createCpuMeasurementCollector({ runtime: state.runtime });
    await collector.capture(async () => undefined);
    expect(collector.evidence()).toMatchObject({ complete: false, cpuProfile: null, allocationProfile: null,
      failures: ["cpuDecode", "heapDecode"] });
    expect(state.calls.at(-1)).toBe("disconnect");
  });

  it("refuses conflicts/reuse and makes a simultaneous quiet SDK command detectable", async () => {
    const state = fixture(), collector = createCpuMeasurementCollector({ runtime: state.runtime });
    const invoke = vi.fn(async () => {
      expect(() => assertCpuMeasurementIdle()).toThrow(CpuMeasurementConflict);
      await expect(createCpuMeasurementCollector({ runtime: state.runtime }).capture(async () => undefined)).rejects.toMatchObject({ reason: "activeCapture" });
    });
    await collector.capture(invoke);
    expect(invoke).toHaveBeenCalledOnce();
    await expect(collector.capture(invoke)).rejects.toMatchObject({ reason: "reusedCollector" });
    expect(invoke).toHaveBeenCalledOnce();
    const debuggerCollector = createCpuMeasurementCollector({ runtime: { ...state.runtime, conflict: () => true } });
    await expect(debuggerCollector.capture(invoke)).rejects.toMatchObject({ reason: "profilerConfiguration" });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("stops on a bounded observation deadline while allowing the business request to settle", async () => {
    const state = fixture();
    const collector = createCpuMeasurementCollector({ runtime: state.runtime, durationMs: 1 });
    const result = await collector.capture(() => new Promise<number>(resolve => setTimeout(() => resolve(5), 10)));
    expect(result).toBe(5);
    expect(collector.evidence()).toMatchObject({ complete: false, timedOut: true, failures: ["duration"] });
    expect(state.calls.filter(method => method === "Profiler.stop")).toHaveLength(1);
    expect(state.calls.filter(method => method === "HeapProfiler.stopSampling")).toHaveLength(1);
  });

  it("reports unavailable GC separately and does not create a collector for plain quiet work", async () => {
    const state = fixture(), before = [...state.calls];
    await Promise.resolve("quiet");
    expect(state.calls).toEqual(before);
    const collector = createCpuMeasurementCollector({ runtime: { ...state.runtime, gcSupported: false } });
    await collector.capture(async () => undefined);
    expect(collector.evidence()).toMatchObject({ complete: false, gc: { supported: false, events: [] } });
    expect(state.calls).not.toContain("gcObserve");
  });

  it("bounds asynchronous GC retention and fault capture without turning missing evidence into zero", async () => {
    const state = fixture();
    state.pendingGc.push(...Array.from({ length: CPU_LIMITS.gcEvents + 5 }, () => ({ startTime: 1, duration: 1, detail: { kind: 1, flags: 0 } })));
    const collector = createCpuMeasurementCollector({ runtime: state.runtime });
    await collector.capture(async () => undefined);
    expect(collector.evidence().complete).toBe(false);
    expect(collector.evidence().gc.events).toHaveLength(CPU_LIMITS.gcEvents);
    expect(collector.evidence().gc.droppedEvents).toBeGreaterThan(0);
    const bad = fixture();
    bad.pendingGc.push(...Array.from({ length: CPU_LIMITS.failures + 20 }, () => ({ startTime: 1, duration: 1, detail: { kind: -1, flags: 0 } })));
    const failed = createCpuMeasurementCollector({ runtime: bad.runtime });
    await failed.capture(async () => undefined);
    expect(failed.failures()).toHaveLength(CPU_LIMITS.failures);
    expect(failed.evidence().droppedFailures).toBeGreaterThan(0);
    expect(failed.evidence().complete).toBe(false);
  });

  it("checks the actual Node APIs with controlled work without unstable sample-count thresholds", async () => {
    const collector = createCpuMeasurementCollector();
    const retained: object[] = [];
    const result = await collector.capture(async () => {
      for (let index = 0; index < 40_000; index++) retained.push({ index, values: [index, index + 1, index + 2] });
      return retained.length;
    });
    expect(result).toBe(40_000);
    const evidence = collector.evidence();
    expect(evidence.complete).toBe(true);
    expect(evidence.cpuProfile).not.toBeNull();
    expect(evidence.allocationProfile).not.toBeNull();
    expect(evidence.cpuIntervalMicroseconds).toBe(1_000);
    expect(evidence.retainedBytes).toBeLessThanOrEqual(CPU_LIMITS.exportBytes);
    expect(evidence.counters?.process.user).toBeGreaterThanOrEqual(0);
    expect(evidence.callWindow).not.toBeNull();
    expect(analyzeCpuEvidence(evidence).alignment.status).toBe("bracketed-estimate");
    expect(collector.failures()).toEqual([]);
  });
});
