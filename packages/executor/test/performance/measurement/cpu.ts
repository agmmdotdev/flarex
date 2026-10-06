import { Data, Result, Schema } from "effect";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const CPU_LIMITS = { nodes: 20_000, samples: 100_000, depth: 128, label: 160,
  exportBytes: 16 * 1024 * 1024, durationMs: 30_000, gcEvents: 10_000, failures: 256 } as const;
export const CPU_INTERVAL_MICROSECONDS = 1_000;
export const ALLOCATION_INTERVAL_BYTES = 32_768;
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const Label = Schema.String.check(Schema.isMaxLength(CPU_LIMITS.label));
const Window = Schema.Struct({ startMonotonicMs: Nonnegative, endMonotonicMs: Nonnegative })
  .check(Schema.makeFilter(value => value.endMonotonicMs >= value.startMonotonicMs ? undefined : "Reversed CPU window"));
const Frame = Schema.Struct({ functionName: Label, scriptId: Label, url: Label,
  lineNumber: Schema.Int, columnNumber: Schema.Int });
const CpuNode = Schema.Struct({ id: Schema.Natural, callFrame: Frame,
  children: Schema.Array(Schema.Natural).check(Schema.isMaxLength(CPU_LIMITS.nodes)),
  hitCount: Schema.optional(Schema.Natural),
  positionTicks: Schema.optional(Schema.Array(Schema.Struct({ line: Schema.Natural, ticks: Schema.Natural }))
    .check(Schema.isMaxLength(CPU_LIMITS.samples))) });
export const CpuProfileSchema = Schema.Struct({
  nodes: Schema.Array(CpuNode).check(Schema.isMaxLength(CPU_LIMITS.nodes)),
  startTime: Nonnegative, endTime: Nonnegative,
  samples: Schema.NullOr(Schema.Array(Schema.Natural).check(Schema.isMaxLength(CPU_LIMITS.samples))),
  timeDeltas: Schema.NullOr(Schema.Array(Nonnegative).check(Schema.isMaxLength(CPU_LIMITS.samples))),
}).check(Schema.makeFilter(profile => {
  if (profile.endTime < profile.startTime) return "Reversed inspector profile";
  const ids = new Set(profile.nodes.map(node => node.id));
  if (ids.size !== profile.nodes.length) return "Duplicate CPU node";
  if (profile.samples !== null && profile.samples.some(id => !ids.has(id))) return "Unknown CPU sample node";
  if (profile.samples !== null && profile.timeDeltas !== null && profile.samples.length !== profile.timeDeltas.length)
    return "CPU sample/delta lengths differ";
  return checkTree(profile.nodes);
}));
export type CpuProfile = typeof CpuProfileSchema.Type;
const AllocationNode = Schema.Struct({ id: Schema.Natural, parentId: Schema.NullOr(Schema.Natural),
  callFrame: Frame, selfSize: Nonnegative });
/** A lossless bounded flattening of the sampling tree. Ordinals are order, not timestamps. */
export const AllocationProfileSchema = Schema.Struct({
  nodes: Schema.Array(AllocationNode).check(Schema.isMaxLength(CPU_LIMITS.nodes)),
  samples: Schema.Array(Schema.Struct({ size: Nonnegative, nodeId: Schema.Natural, ordinal: Schema.Natural }))
    .check(Schema.isMaxLength(CPU_LIMITS.samples)),
}).check(Schema.makeFilter(profile => {
  const ids = new Set(profile.nodes.map(node => node.id));
  if (ids.size !== profile.nodes.length) return "Duplicate allocation node";
  if (profile.nodes.filter(node => node.parentId === null).length !== 1) return "Allocation tree requires one root";
  const parents = new Map(profile.nodes.map(node => [node.id, node.parentId]));
  for (const node of profile.nodes) {
    const seen = new Set<number>();
    let current: number | null = node.id;
    while (current !== null) {
      if (seen.has(current) || seen.size > CPU_LIMITS.depth) return "Cyclic or deep allocation tree";
      seen.add(current);
      const parent = parents.get(current);
      if (parent === undefined) return "Unknown allocation parent";
      current = parent;
    }
  }
  if (profile.samples.some(sample => !ids.has(sample.nodeId))) return "Unknown allocation sample node";
  const ordinals = new Set(profile.samples.map(sample => sample.ordinal));
  return ordinals.size === profile.samples.length ? undefined : "Duplicate allocation ordinal";
}));
export type AllocationProfile = typeof AllocationProfileSchema.Type;
const Counter = Schema.Struct({ user: Nonnegative, system: Nonnegative });
const Memory = Schema.Struct({ atMonotonicMs: Nonnegative, rss: Nonnegative, heapTotal: Nonnegative,
  heapUsed: Nonnegative, external: Nonnegative, arrayBuffers: Nonnegative, usedHeapSize: Nonnegative,
  heapSizeLimit: Nonnegative, mallocedMemory: Nonnegative });
const Elu = Schema.Struct({ idle: Nonnegative, active: Nonnegative, utilization: Nonnegative });
const FaultStage = Schema.Literals(["conflict", "connect", "cpuEnable", "cpuInterval", "cpuStart", "heapEnable",
  "heapStart", "gcStart", "beforeCounters", "afterCounters", "cpuStop", "heapStop", "cpuDecode", "heapDecode",
  "gcDelivery", "gcDecode", "gcDisconnect", "disconnect", "duration", "clock", "exportBound"]);
export const CpuEvidenceSchema = Schema.Struct({
  complete: Schema.Boolean,
  host: Schema.Struct({ pid: Schema.Natural, threadId: Schema.Natural, node: Label, v8: Label, platform: Label,
    exclusivity: Schema.Literal("controlled-isolate-only"), externalContention: Schema.Literal("unavailable") }),
  limits: Schema.Struct({ nodes: Schema.Natural, samples: Schema.Natural, depth: Schema.Natural, label: Schema.Natural,
    exportBytes: Schema.Natural, durationMs: Nonnegative, gcEvents: Schema.Natural, failures: Schema.Natural }),
  cpuIntervalMicroseconds: Schema.Natural, allocationIntervalBytes: Schema.Natural,
  includeObjectsCollectedByMajorGC: Schema.Literal(true), includeObjectsCollectedByMinorGC: Schema.Literal(true),
  callWindow: Schema.NullOr(Window), cpuStartCommand: Schema.NullOr(Window), cpuStopCommand: Schema.NullOr(Window),
  allocationWindow: Schema.NullOr(Window), cpuProfile: Schema.NullOr(CpuProfileSchema),
  allocationProfile: Schema.NullOr(AllocationProfileSchema),
  counters: Schema.NullOr(Schema.Struct({ window: Window, process: Counter, thread: Schema.NullOr(Counter),
    eventLoop: Elu })),
  memory: Schema.Struct({ before: Schema.NullOr(Memory), after: Schema.NullOr(Memory) }),
  gc: Schema.Struct({ supported: Schema.Boolean,
    events: Schema.Array(Schema.Struct({ startMonotonicMs: Nonnegative, durationMs: Nonnegative,
      kind: Schema.Natural, flags: Schema.Natural })).check(Schema.isMaxLength(CPU_LIMITS.gcEvents)),
    droppedEvents: Schema.Natural,
    observerIntervals: Schema.Array(Window).check(Schema.isMaxLength(CPU_LIMITS.gcEvents + 1)) }),
  timedOut: Schema.Boolean, retainedBytes: Schema.Natural, droppedFailures: Schema.Natural,
  failures: Schema.Array(FaultStage).check(Schema.isMaxLength(CPU_LIMITS.failures)),
}).check(Schema.makeFilter(evidence => {
  if (evidence.retainedBytes > CPU_LIMITS.exportBytes) return "CPU evidence exceeds export bound";
  if (evidence.limits.durationMs > CPU_LIMITS.durationMs) return "CPU duration exceeds collector bound";
  if (evidence.complete && (evidence.failures.length > 0 || evidence.droppedFailures > 0 || evidence.timedOut ||
    evidence.gc.droppedEvents > 0 || !evidence.gc.supported || evidence.cpuProfile === null || evidence.allocationProfile === null ||
    evidence.callWindow === null || evidence.cpuStartCommand === null || evidence.cpuStopCommand === null || evidence.allocationWindow === null ||
    evidence.counters === null || evidence.memory.before === null || evidence.memory.after === null))
    return "Complete CPU evidence requires settled available collectors without faults";
  return undefined;
}));
export type CpuEvidence = typeof CpuEvidenceSchema.Type;
export type CpuFaultStage = typeof FaultStage.Type;
export type CpuWindow = typeof Window.Type;
export const decodeCpuEvidence = Schema.decodeUnknownResult(CpuEvidenceSchema, { onExcessProperty: "error" });
const decodeProfile = Schema.decodeUnknownResult(CpuProfileSchema);
const decodeAllocation = Schema.decodeUnknownResult(AllocationProfileSchema);
export const decodeGcDetail = Schema.decodeUnknownResult(Schema.Struct({ kind: Schema.Natural, flags: Schema.Natural }));
export class InvalidCpuProfile extends Data.TaggedError("InvalidCpuProfile")<{ readonly reason: string; readonly cause?: unknown }> {}

function checkTree(nodes: readonly { readonly id: number; readonly children: readonly number[] }[]): string | undefined {
  if (nodes.length === 0) return "Missing CPU root";
  const map = new Map(nodes.map(node => [node.id, node]));
  const parents = new Set<number>();
  for (const node of nodes) for (const child of node.children) {
    if (!map.has(child)) return "Unknown CPU child";
    if (parents.has(child)) return "Multiple CPU parents";
    parents.add(child);
  }
  const root = nodes[0];
  if (root === undefined || parents.has(root.id) || parents.size !== nodes.length - 1) return "Disconnected CPU tree";
  const stack = [{ id: root.id, depth: 0 }];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    if (seen.has(item.id) || item.depth > CPU_LIMITS.depth) return "Cyclic or deep CPU tree";
    seen.add(item.id);
    for (const id of map.get(item.id)?.children ?? []) stack.push({ id, depth: item.depth + 1 });
  }
  return seen.size === nodes.length ? undefined : "Disconnected CPU tree";
}

/** No getters, arbitrary keys or payload-bearing fields cross this inspector projection. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}
function boundedArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new InvalidCpuProfile({ reason: "profileBound" });
  return value;
}
function safeSource(value: unknown, root: string): string {
  if (typeof value !== "string" || value.length > 8_192) return "[external]";
  if (value === "" || /^node:[A-Za-z0-9_./-]+$/.test(value)) return value.slice(0, CPU_LIMITS.label);
  let file: string;
  try { file = value.startsWith("file:") ? fileURLToPath(value) : value; } catch { return "[external]"; }
  if (!isAbsolute(file)) return "[generated]";
  const local = relative(root, file).replaceAll("\\", "/");
  return local !== ".." && !local.startsWith("../") && !isAbsolute(local) &&
    /^[A-Za-z0-9_./@+ -]+$/.test(local) && local.length + 2 <= CPU_LIMITS.label ? `./${local}` : "[external]";
}
function frame(value: unknown, root: string) {
  const url = safeSource(field(value, "url"), root);
  const original = field(value, "functionName");
  const meta = typeof original === "string" && ["(root)", "(idle)", "(program)", "(garbage collector)"].includes(original);
  const trusted = url.startsWith("./") || url.startsWith("node:") || meta;
  const functionName = trusted && typeof original === "string" && original.length <= CPU_LIMITS.label &&
    /^[A-Za-z0-9_$()[\].<> :/#-]*$/.test(original) ? original : "[redacted]";
  const scriptId = field(value, "scriptId");
  return { functionName, url, scriptId: typeof scriptId === "string" && /^\d{1,20}$/.test(scriptId) ? scriptId : "0",
    lineNumber: field(value, "lineNumber"), columnNumber: field(value, "columnNumber") };
}
export function captureCpuProfile(value: unknown, root = repository): Result.Result<CpuProfile, InvalidCpuProfile> {
  try {
    const rawSamples = field(value, "samples"), rawDeltas = field(value, "timeDeltas");
    let tickCount = 0;
    const projected = { startTime: field(value, "startTime"), endTime: field(value, "endTime"),
      nodes: boundedArray(field(value, "nodes"), CPU_LIMITS.nodes).map(node => {
        const rawTicks = field(node, "positionTicks"), hitCount = field(node, "hitCount");
        const ticks = rawTicks === undefined ? undefined : boundedArray(rawTicks, CPU_LIMITS.samples);
        tickCount += ticks?.length ?? 0;
        if (tickCount > CPU_LIMITS.samples) throw new InvalidCpuProfile({ reason: "positionTickBound" });
        return { id: field(node, "id"), callFrame: frame(field(node, "callFrame"), root),
          children: field(node, "children") === undefined ? [] : boundedArray(field(node, "children"), CPU_LIMITS.nodes),
          ...(hitCount === undefined ? {} : { hitCount }), ...(ticks === undefined ? {} : {
            positionTicks: ticks.map(tick => ({ line: field(tick, "line"), ticks: field(tick, "ticks") })) }) };
      }),
      samples: rawSamples === undefined ? null : boundedArray(rawSamples, CPU_LIMITS.samples),
      timeDeltas: rawDeltas === undefined ? null : boundedArray(rawDeltas, CPU_LIMITS.samples) };
    return decodeProfile(projected).pipe(Result.mapError(cause => new InvalidCpuProfile({ reason: "invalidCpuProfile", cause })));
  } catch (cause) { return Result.fail(cause instanceof InvalidCpuProfile ? cause : new InvalidCpuProfile({ reason: "cpuCapture", cause })); }
}
export function captureAllocationProfile(value: unknown, root = repository): Result.Result<AllocationProfile, InvalidCpuProfile> {
  try {
    const nodes: unknown[] = [];
    const stack: { value: unknown; parentId: unknown; depth: number }[] = [{ value: field(value, "head"), parentId: null, depth: 0 }];
    const seen = new Set<unknown>();
    while (stack.length > 0) {
      const item = stack.pop();
      if (item === undefined) break;
      if (nodes.length >= CPU_LIMITS.nodes || item.depth > CPU_LIMITS.depth || seen.has(item.value))
        throw new InvalidCpuProfile({ reason: "allocationBound" });
      seen.add(item.value);
      const id = field(item.value, "id");
      nodes.push({ id, parentId: item.parentId, callFrame: frame(field(item.value, "callFrame"), root), selfSize: field(item.value, "selfSize") });
      const children = boundedArray(field(item.value, "children"), CPU_LIMITS.nodes);
      if (stack.length + children.length + nodes.length > CPU_LIMITS.nodes) throw new InvalidCpuProfile({ reason: "allocationBound" });
      for (let index = children.length - 1; index >= 0; index--) stack.push({ value: children[index], parentId: id, depth: item.depth + 1 });
    }
    const samples = boundedArray(field(value, "samples"), CPU_LIMITS.samples).map(sample => ({
      size: field(sample, "size"), nodeId: field(sample, "nodeId"), ordinal: field(sample, "ordinal") }));
    return decodeAllocation({ nodes, samples }).pipe(Result.mapError(cause => new InvalidCpuProfile({ reason: "invalidAllocationProfile", cause })));
  } catch (cause) { return Result.fail(cause instanceof InvalidCpuProfile ? cause : new InvalidCpuProfile({ reason: "allocationCapture", cause })); }
}

/** All CPU stack weights remain sampled elapsed spacing, never scheduler CPU. */
export function analyzeCpuEvidence(evidence: CpuEvidence, root: CpuWindow | null = evidence.callWindow) {
  const profile = evidence.cpuProfile;
  const start = evidence.cpuStartCommand, stop = evidence.cpuStopCommand;
  const low = profile !== null && start !== null && stop !== null
    ? Math.max(start.startMonotonicMs - profile.startTime / 1_000, stop.startMonotonicMs - profile.endTime / 1_000) : null;
  const high = profile !== null && start !== null && stop !== null
    ? Math.min(start.endMonotonicMs - profile.startTime / 1_000, stop.endMonotonicMs - profile.endTime / 1_000) : null;
  const aligned = low !== null && high !== null && low <= high;
  const frames = new Map<number, { nodeId: number; callFrame: CpuProfile["nodes"][number]["callFrame"];
    selfSamples: number; inclusiveSamples: number; sampledElapsedWeightMs: number }>();
  const parents = new Map<number, number>();
  for (const node of profile?.nodes ?? []) {
    frames.set(node.id, { nodeId: node.id, callFrame: node.callFrame, selfSamples: 0, inclusiveSamples: 0, sampledElapsedWeightMs: 0 });
    for (const child of node.children) parents.set(child, node.id);
  }
  let definitelyInsideSamples = 0, boundaryAmbiguousSamples = 0, outsideSamples = 0, stamp = profile?.startTime ?? 0;
  for (let index = 0; index < (profile?.samples?.length ?? 0); index++) {
    const delta = profile?.timeDeltas?.[index];
    if (delta === undefined || !aligned || low === null || high === null || root === null) { boundaryAmbiguousSamples++; continue; }
    const previous = stamp;
    stamp += delta;
    const minimum = stamp / 1_000 + low, maximum = stamp / 1_000 + high;
    if (maximum < root.startMonotonicMs || minimum > root.endMonotonicMs) { outsideSamples++; continue; }
    if (minimum < root.startMonotonicMs || maximum > root.endMonotonicMs || previous / 1_000 + low < root.startMonotonicMs) {
      boundaryAmbiguousSamples++; continue;
    }
    definitelyInsideSamples++;
    const id = profile?.samples?.[index];
    if (id === undefined) continue;
    const self = frames.get(id);
    if (self !== undefined) { self.selfSamples++; self.sampledElapsedWeightMs += delta / 1_000; }
    let current: number | undefined = id;
    for (let depth = 0; current !== undefined && depth <= CPU_LIMITS.depth; depth++) {
      const currentFrame = frames.get(current);
      if (currentFrame !== undefined) currentFrame.inclusiveSamples++;
      current = parents.get(current);
    }
  }
  const gcIntervals = evidence.gc.events.map(event => ({ ...event,
    intersectionMs: root === null ? null : Math.max(0, Math.min(root.endMonotonicMs, event.startMonotonicMs + event.durationMs) -
      Math.max(root.startMonotonicMs, event.startMonotonicMs)),
    crossesRoot: root !== null && event.startMonotonicMs < root.endMonotonicMs &&
      event.startMonotonicMs + event.durationMs > root.startMonotonicMs &&
      (event.startMonotonicMs < root.startMonotonicMs || event.startMonotonicMs + event.durationMs > root.endMonotonicMs) }));
  const deltas = profile?.timeDeltas?.toSorted((a, b) => a - b) ?? [];
  return { complete: evidence.complete && aligned && profile?.samples !== null && profile?.timeDeltas !== null,
    alignment: { status: aligned ? "bracketed-estimate" : "unavailable", offsetLowMs: low, offsetHighMs: high,
      uncertaintyMs: aligned && low !== null && high !== null ? high - low : null, assumption: "shared-monotonic-rate" },
    rootWindow: root, sampleCount: profile?.samples?.length ?? null, definitelyInsideSamples, boundaryAmbiguousSamples, outsideSamples,
    actualSamplingDeltasMicroseconds: deltas.length === 0 ? null : { min: deltas[0], max: deltas.at(-1),
      median: deltas[Math.floor(deltas.length / 2)], sum: deltas.reduce((a, b) => a + b, 0) },
    sampledFrames: [...frames.values()].filter(frame => frame.inclusiveSamples > 0).toSorted((a, b) => b.selfSamples - a.selfSamples),
    allocations: evidence.allocationProfile === null ? null : { scope: "entire-profiler-window", window: evidence.allocationWindow,
      estimatedBytes: evidence.allocationProfile.nodes.reduce((sum, node) => sum + node.selfSize, 0),
      sampleCount: evidence.allocationProfile.samples.length,
      frames: evidence.allocationProfile.nodes.toSorted((a, b) => b.selfSize - a.selfSize) },
    gc: { supported: evidence.gc.supported, intervals: gcIntervals, summedRootOverlapMs: root === null ? null :
      gcIntervals.reduce((sum, event) => sum + (event.intersectionMs ?? 0), 0) },
    counters: evidence.counters,
    memoryOccupancyDeltaBytes: evidence.memory.before === null || evidence.memory.after === null ? null : {
      rss: evidence.memory.after.rss - evidence.memory.before.rss,
      heapUsed: evidence.memory.after.heapUsed - evidence.memory.before.heapUsed,
      external: evidence.memory.after.external - evidence.memory.before.external,
      arrayBuffers: evidence.memory.after.arrayBuffers - evidence.memory.before.arrayBuffers },
    limits: ["Node-host-only", "sampled-stack-weights-are-not-exact-CPU", "allocation-window-has-no-sample-timestamps",
      "GC-isolate-causality-unavailable", "memory-endpoints-are-not-total-allocation-or-peak", "external-contention-unavailable"] };
}
