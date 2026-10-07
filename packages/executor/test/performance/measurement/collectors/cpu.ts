import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import { Session } from "node:inspector/promises";
import { url as inspectorUrl } from "node:inspector";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { threadId } from "node:worker_threads";
import { ALLOCATION_INTERVAL_BYTES, CPU_INTERVAL_MICROSECONDS, CPU_LIMITS, captureAllocationProfile,
  captureCpuProfile, decodeCpuEvidence, decodeGcDetail, type CpuEvidence, type CpuFaultStage } from "../cpu";
import type { ResourceReading } from "../cpu";

type CpuSession = { connect(): void; post(method: string, parameters?: object): Promise<unknown>; disconnect(): void };
type GcEntry = { readonly startTime: number; readonly duration: number; readonly detail: unknown };
type GcObserver = { observe(): void; takeRecords(): readonly GcEntry[]; disconnect(): void };
type MemoryReading = Omit<NonNullable<CpuEvidence["memory"]["before"]>, "atMonotonicMs">;
type Counters = { readonly cpu: NodeJS.CpuUsage; readonly thread: NodeJS.CpuUsage | null;
  readonly eventLoop: ReturnType<typeof performance.eventLoopUtilization> };
/** Counter-only observation performs no inspector, heap or GC acquisition. */
export function readNodeResourceCounters(): ResourceReading {
  return { process: process.cpuUsage(), thread: typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : null,
    eventLoop: performance.eventLoopUtilization() };
}
/** Narrow Node adapter seams for deterministic lifecycle witnesses, not a telemetry plugin API. */
export interface CpuCollectorRuntime {
  readonly now: () => number;
  readonly session: () => CpuSession;
  readonly gcObserver: (receive: (entries: readonly GcEntry[]) => void) => GcObserver;
  readonly gcSupported: boolean;
  readonly counters: () => Counters;
  readonly memory: () => MemoryReading;
  readonly drainGc: () => Promise<void>;
  readonly conflict: () => boolean;
}
const entryTypes = "supportedEntryTypes" in PerformanceObserver ? PerformanceObserver.supportedEntryTypes : undefined;
const live: CpuCollectorRuntime = {
  now: () => performance.now(),
  session: () => new Session(),
  gcSupported: Schema.is(Schema.Array(Schema.String))(entryTypes) && entryTypes.includes("gc"),
  gcObserver: receive => {
    const project = (entries: readonly import("node:perf_hooks").PerformanceEntry[]) => entries.map(entry => ({
      startTime: entry.startTime, duration: entry.duration, detail: "detail" in entry ? entry.detail : undefined }));
    const observer = new PerformanceObserver(list => receive(project(list.getEntriesByType("gc"))));
    return { observe: () => observer.observe({ entryTypes: ["gc"] }),
      takeRecords: () => project(observer.takeRecords()), disconnect: () => observer.disconnect() };
  },
  counters: () => {
    const reading = readNodeResourceCounters();
    return { cpu: reading.process, thread: reading.thread, eventLoop: reading.eventLoop };
  },
  memory: () => {
    const memory = process.memoryUsage(), heap = getHeapStatistics();
    return { ...memory, usedHeapSize: heap.used_heap_size, heapSizeLimit: heap.heap_size_limit, mallocedMemory: heap.malloced_memory };
  },
  // GC performance entries are delivered asynchronously. Two turns include the
  // native GC notification and the observer delivery; takeRecords drains its queue.
  drainGc: () => new Promise(resolve => setImmediate(() => setImmediate(resolve))),
  conflict: () => inspectorUrl() !== undefined || [...process.execArgv, process.env.NODE_OPTIONS ?? ""]
    .some(option => /(?:^|\s)--(?:inspect(?:-brk|-wait)?|cpu-prof|heap-prof)(?:[=\s-]|$)/.test(option)),
};
export class CpuMeasurementConflict extends Data.TaggedError("CpuMeasurementConflict")<{
  readonly reason: "activeCapture" | "profilerConfiguration" | "reusedCollector";
}> {}
let activeCapture: object | undefined;
/** This gate detects this isolate's SDK captures; it is not a process-wide lock. */
export function assertCpuMeasurementIdle(): void {
  if (activeCapture !== undefined) throw new CpuMeasurementConflict({ reason: "activeCapture" });
}

export function createCpuMeasurementCollector(input: { readonly runtime?: CpuCollectorRuntime; readonly sourceRoot?: string;
  readonly durationMs?: number; readonly allocations?: boolean } = {}) {
  const runtime = input.runtime ?? live;
  const allocations = input.allocations ?? true;
  const durationMs = input.durationMs ?? CPU_LIMITS.durationMs;
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > CPU_LIMITS.durationMs)
    throw new RangeError("CPU diagnostic duration must be between 1 and 30000 milliseconds");
  const faults: { stage: CpuFaultStage; cause: unknown }[] = [];
  let used = false, settled = false;
  let session: CpuSession | undefined, observer: GcObserver | undefined;
  let connected = false, cpuAttempted = false, heapAttempted = false;
  let stopping: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beforeCounters: Counters | undefined, countersStarted = 0;
  let allocationStarted = 0;
  const gcEvents: CpuEvidence["gc"]["events"][number][] = [];
  const gcObserverIntervals: CpuEvidence["gc"]["observerIntervals"][number][] = [];
  let droppedGc = 0;
  const evidence: CpuEvidence = {
    complete: false, host: { pid: process.pid, threadId, node: process.versions.node, v8: process.versions.v8,
      platform: process.platform, exclusivity: "controlled-isolate-only", externalContention: "unavailable" },
    limits: { ...CPU_LIMITS, durationMs }, cpuIntervalMicroseconds: CPU_INTERVAL_MICROSECONDS,
    allocationSampling: allocations ? "enabled" : "disabled",
    allocationIntervalBytes: allocations ? ALLOCATION_INTERVAL_BYTES : null,
    includeObjectsCollectedByMajorGC: allocations ? true : null,
    includeObjectsCollectedByMinorGC: allocations ? true : null, callWindow: null, cpuStartCommand: null, cpuStopCommand: null,
    allocationWindow: null, cpuProfile: null, allocationProfile: null, counters: null,
    memory: { before: null, after: null }, gc: { supported: runtime.gcSupported, events: [], droppedEvents: 0, observerIntervals: [] },
    timedOut: false, retainedBytes: 0, droppedFailures: 0, failures: [],
  };
  // State is request-local. The detached Schema-derived evidence is built only at settlement.
  let state = evidence;
  const fault = (stage: CpuFaultStage, cause: unknown) => {
    if (faults.length >= CPU_LIMITS.failures) {
      state = { ...state, droppedFailures: state.droppedFailures + 1 }; return;
    }
    faults.push({ stage, cause });
    state = { ...state, failures: [...state.failures, stage] };
  };
  let previousClock = 0;
  const now = () => {
    try {
      const reading = runtime.now();
      if (!Number.isFinite(reading) || reading < previousClock) throw new Error("Invalid CPU monotonic clock");
      previousClock = reading;
      return reading;
    } catch (cause) { fault("clock", cause); return previousClock; }
  };
  const receiveGc = (entries: readonly GcEntry[]) => {
    const start = now();
    try {
      const available = CPU_LIMITS.gcEvents - gcEvents.length;
      const retained = Math.min(available, entries.length);
      droppedGc += entries.length - retained;
      for (let index = 0; index < retained; index++) {
        const entry = entries[index];
        if (entry === undefined) { fault("gcDecode", new Error("Missing GC entry")); continue; }
        Result.match(decodeGcDetail(entry.detail), {
          onFailure: cause => fault("gcDecode", cause),
          onSuccess: detail => {
            if (!Number.isFinite(entry.startTime) || entry.startTime < 0 || !Number.isFinite(entry.duration) || entry.duration < 0) {
              fault("gcDecode", new Error("Invalid GC interval")); return;
            }
            gcEvents.push({ startMonotonicMs: entry.startTime,
              durationMs: entry.duration, kind: detail.kind, flags: detail.flags });
          },
        });
      }
    } catch (cause) { fault("gcDelivery", cause); }
    finally {
      if (gcObserverIntervals.length < CPU_LIMITS.gcEvents + 1)
        gcObserverIntervals.push({ startMonotonicMs: start, endMonotonicMs: now() });
      else droppedGc++;
    }
  };
  const command = async (stage: CpuFaultStage, method: string, parameters?: object) => {
    try { return await session?.post(method, parameters); } catch (cause) { fault(stage, cause); return undefined; }
  };
  const profileField = (value: unknown) => {
    if (typeof value !== "object" || value === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "profile");
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  };
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (cpuAttempted) {
        try {
          const start = now();
          const result = await command("cpuStop", "Profiler.stop");
          state = { ...state, cpuStopCommand: { startMonotonicMs: start, endMonotonicMs: now() } };
          if (result !== undefined) Result.match(captureCpuProfile(profileField(result), input.sourceRoot), {
            onFailure: cause => fault("cpuDecode", cause), onSuccess: cpuProfile => { state = { ...state, cpuProfile }; },
          });
        } catch (cause) { fault("cpuDecode", cause); }
        finally { cpuAttempted = false; }
      }
      if (heapAttempted) {
        try {
          const result = await command("heapStop", "HeapProfiler.stopSampling");
          state = { ...state, allocationWindow: { startMonotonicMs: allocationStarted, endMonotonicMs: now() } };
          if (result !== undefined) Result.match(captureAllocationProfile(profileField(result), input.sourceRoot), {
            onFailure: cause => fault("heapDecode", cause), onSuccess: allocationProfile => { state = { ...state, allocationProfile }; },
          });
        } catch (cause) { fault("heapDecode", cause); }
        finally { heapAttempted = false; }
      }
      if (observer !== undefined) {
        try { await runtime.drainGc(); receiveGc(observer.takeRecords()); } catch (cause) { fault("gcDelivery", cause); }
        try { observer.disconnect(); } catch (cause) { fault("gcDisconnect", cause); }
      }
    })();
    return stopping;
  };
  const acquire = async () => {
    try { session = runtime.session(); session.connect(); connected = true; } catch (cause) { fault("connect", cause); }
    if (connected) {
      await command("cpuEnable", "Profiler.enable");
      await command("cpuInterval", "Profiler.setSamplingInterval", { interval: CPU_INTERVAL_MICROSECONDS });
      const start = now();
      cpuAttempted = true; // A rejected transport cannot prove start did not happen.
      await command("cpuStart", "Profiler.start");
      state = { ...state, cpuStartCommand: { startMonotonicMs: start, endMonotonicMs: now() } };
      if (allocations) {
        await command("heapEnable", "HeapProfiler.enable");
        allocationStarted = now();
        heapAttempted = true;
        await command("heapStart", "HeapProfiler.startSampling", { samplingInterval: ALLOCATION_INTERVAL_BYTES,
          includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      }
    }
    if (runtime.gcSupported) {
      try { observer = runtime.gcObserver(receiveGc); observer.observe(); } catch (cause) { fault("gcStart", cause); }
    }
    timer = setTimeout(() => {
      state = { ...state, timedOut: true };
      fault("duration", new Error("CPU diagnostic window expired"));
      void stop();
    }, durationMs);
  };
  const release = async () => {
    if (timer !== undefined) clearTimeout(timer);
    try { await stop(); } catch (cause) { fault("cpuStop", cause); }
    if (session !== undefined) {
      try { session.disconnect(); } catch (cause) { fault("disconnect", cause); }
    }
    settled = true;
    state = { ...state, gc: { ...state.gc, events: gcEvents, observerIntervals: gcObserverIntervals, droppedEvents: droppedGc } };
  };
  const snapshotBefore = () => {
    try {
      state = { ...state, memory: { ...state.memory, before: { ...runtime.memory(), atMonotonicMs: now() } } };
      countersStarted = now();
      beforeCounters = runtime.counters();
    } catch (cause) { fault("beforeCounters", cause); }
  };
  const snapshotAfter = () => {
    try {
      const after = runtime.counters(), ended = now();
      if (beforeCounters !== undefined) {
        const diff = (start: NodeJS.CpuUsage, end: NodeJS.CpuUsage) => ({ user: end.user - start.user, system: end.system - start.system });
        const active = after.eventLoop.active - beforeCounters.eventLoop.active;
        const idle = after.eventLoop.idle - beforeCounters.eventLoop.idle;
        state = { ...state, counters: { window: { startMonotonicMs: countersStarted, endMonotonicMs: ended },
          process: diff(beforeCounters.cpu, after.cpu), thread: beforeCounters.thread === null || after.thread === null
            ? null : diff(beforeCounters.thread, after.thread), eventLoop: { active, idle,
              utilization: active + idle === 0 ? 0 : active / (active + idle) } } };
      }
      state = { ...state, memory: { ...state.memory, after: { ...runtime.memory(), atMonotonicMs: now() } } };
    } catch (cause) { fault("afterCounters", cause); }
  };
  return {
    async capture<A>(invoke: () => Promise<A>): Promise<A> {
      if (used) throw new CpuMeasurementConflict({ reason: "reusedCollector" });
      assertCpuMeasurementIdle();
      if (runtime.conflict()) throw new CpuMeasurementConflict({ reason: "profilerConfiguration" });
      used = true;
      const token = {};
      activeCapture = token;
      const scoped = Effect.scoped(Effect.gen(function* () {
        // Promise adapters are the genuine executable edges. No callback/event runs a runtime.
        // Register release before partial foreign acquisition. A defect/rejection
        // while constructing a Node observer still closes an acquired session.
        yield* Effect.acquireRelease(Effect.succeed(token), () => Effect.promise(release));
        yield* Effect.tryPromise({ try: acquire, catch: cause => cause });
        snapshotBefore();
        const start = now();
        const result = yield* Effect.tryPromise({ try: invoke, catch: cause => cause }).pipe(
          Effect.onExit(() => Effect.sync(() => {
            state = { ...state, callWindow: { startMonotonicMs: start, endMonotonicMs: now() } };
            snapshotAfter();
          })));
        return result;
      }));
      try {
        const exit = await Effect.runPromiseExit(scoped);
        return Exit.match(exit, { onSuccess: value => value, onFailure: cause => {
          const reason = cause.reasons[0];
          if (cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)) throw reason.error;
          throw cause;
        } });
      } finally { if (activeCapture === token) activeCapture = undefined; }
    },
    evidence(): CpuEvidence {
      if (!settled) throw new Error("CPU evidence requested before collector settlement");
      let result = { ...state, complete: faults.length === 0 && state.droppedFailures === 0 && !state.timedOut && state.gc.droppedEvents === 0 &&
        state.cpuProfile !== null && (!allocations || state.allocationProfile !== null) && state.gc.supported && state.counters !== null &&
        state.memory.before !== null && state.memory.after !== null };
      // Profiles returned by V8 have transient memory outside this retention/export bound.
      const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
      if (bytes > CPU_LIMITS.exportBytes) {
        fault("exportBound", new Error("CPU artifact retention bound exceeded"));
        state = { ...state, cpuProfile: null, allocationProfile: null };
        result = { ...result, complete: false, cpuProfile: null, allocationProfile: null,
          failures: [...state.failures] };
      }
      // The byte-count field itself changes the serialized length. Reach its
      // short fixed point without claiming the size of the surrounding SDK report.
      for (let attempt = 0; attempt < 4; attempt++) {
        const retainedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
        if (retainedBytes === result.retainedBytes) break;
        result = { ...result, retainedBytes };
      }
      return Result.getOrThrow(decodeCpuEvidence(structuredClone(result)));
    },
    failures: () => [...faults],
  };
}
