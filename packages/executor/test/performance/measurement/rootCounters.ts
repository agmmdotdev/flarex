import { performance } from "node:perf_hooks";
import { threadId } from "node:worker_threads";
import { Data, Result, Schema } from "effect";
import { ResourceCountersSchema, ResourceReadingSchema } from "./cpu";
import { readNodeResourceCounters } from "./collectors/nodeResources";

const Window = ResourceCountersSchema.fields.window;
const Reading = Schema.Struct({ process: ResourceReadingSchema.fields.process, thread: ResourceReadingSchema.fields.thread });
const Delta = Schema.Struct({ ...Reading.fields, window: Window });
export const RootCounterEvidenceSchema = Schema.Struct({
  complete: Schema.Boolean,
  host: Schema.Struct({ pid: Schema.Natural, threadId: Schema.Natural, node: Schema.String, platform: Schema.String,
    exclusivity: Schema.Literal("controlled-isolate-only"), externalContention: Schema.Literal("unavailable") }),
  resolution: Schema.Struct({ unit: Schema.Literal("microseconds"), processMicroseconds: Schema.Null,
    threadMicroseconds: Schema.Null, wallPrecisionMs: Schema.Null }),
  callWindow: Schema.NullOr(Window),
  counterReads: Schema.Struct({ before: Schema.NullOr(Window), after: Schema.NullOr(Window) }),
  readings: Schema.Struct({ before: Schema.NullOr(Reading), after: Schema.NullOr(Reading) }),
  counters: Schema.NullOr(Delta),
  failures: Schema.Array(Schema.Literals(["beforeRead", "afterRead", "clock", "validation"])).check(Schema.isMaxLength(8)),
}).check(Schema.makeFilter(value => {
  if (!value.complete) return undefined;
  const { counters, callWindow, counterReads, readings } = value;
  if (counters === null || callWindow === null || counterReads.before === null || counterReads.after === null ||
    readings.before === null || readings.after === null || value.failures.length > 0)
    return "Complete root counter evidence requires settled fault-free readings";
  if (callWindow.startMonotonicMs !== counterReads.before.endMonotonicMs ||
    callWindow.endMonotonicMs !== counterReads.after.startMonotonicMs ||
    counters.window.startMonotonicMs !== counterReads.before.startMonotonicMs ||
    counters.window.endMonotonicMs !== counterReads.after.endMonotonicMs)
    return "Root call and counter read windows disagree";
  if (counters.process.user !== readings.after.process.user - readings.before.process.user ||
    counters.process.system !== readings.after.process.system - readings.before.process.system)
    return "Root process delta disagrees with absolute readings";
  if (readings.before.thread === null || readings.after.thread === null)
    return readings.before.thread === readings.after.thread && counters.thread === null ? undefined : "Thread availability changed";
  return counters.thread !== null && counters.thread.user === readings.after.thread.user - readings.before.thread.user &&
    counters.thread.system === readings.after.thread.system - readings.before.thread.system
    ? undefined : "Root thread delta disagrees with absolute readings";
}));
export type RootCounterEvidence = typeof RootCounterEvidenceSchema.Type;
const PairedCounter = Schema.Struct({ nativeUserMicroseconds: Schema.Finite, nativeSystemMicroseconds: Schema.Finite,
  flarexUserMicroseconds: Schema.Finite, flarexSystemMicroseconds: Schema.Finite,
  addedUserMicroseconds: Schema.Finite, addedSystemMicroseconds: Schema.Finite, addedTotalMicroseconds: Schema.Finite });
export const RootCounterPairSchema = Schema.Struct({ index: Schema.Natural, nativeRequestId: Schema.String, flarexRequestId: Schema.String,
  process: PairedCounter, thread: Schema.NullOr(PairedCounter) });
export type RootCounterPair = typeof RootCounterPairSchema.Type;
export const decodeRootCounterEvidence = Schema.decodeUnknownResult(RootCounterEvidenceSchema, { onExcessProperty: "error" });
const decodeReading = Schema.decodeUnknownResult(ResourceReadingSchema, { onExcessProperty: "error" });
const decodeDelta = Schema.decodeUnknownResult(Delta, { onExcessProperty: "error" });
type Stage = RootCounterEvidence["failures"][number];
type ReadWindow = NonNullable<RootCounterEvidence["counterReads"]["before"]>;
/** Node adapter seam for deterministic two-reader fault and settlement witnesses. */
export type RootCounterRuntime = Readonly<{ now: () => number; read: () => unknown }>;
const live: RootCounterRuntime = { now: () => performance.now(), read: readNodeResourceCounters };
export class RootCounterDiagnosticError extends Data.TaggedError("RootCounterDiagnosticError")<{
  readonly reason: "threadAvailabilityChanged" | "overlappingReadWindows";
}> {}

/** Only counter/time acquisition surrounds the existing Promise boundary. No new
 * business runner, cancellation owner, retry or cleanup lifetime is introduced. */
export function createRootCounterCollector(runtime: RootCounterRuntime = live) {
  const faults: { stage: Stage; cause: unknown }[] = [];
  let before: unknown, after: unknown;
  let beforeWindow: ReadWindow | null = null, afterWindow: ReadWindow | null = null;
  let started = false, settled = false;
  let retainedEvidence: RootCounterEvidence | undefined;
  // Two reads, four clocks and two decoding failures fit the finite bound.
  const fault = (stage: Stage, cause: unknown) => { if (faults.length < 8) faults.push({ stage, cause }); };
  const now = (): number | null => {
    try { const value = runtime.now();
      if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid root counter clock");
      return value;
    } catch (cause) { fault("clock", cause); return null; }
  };
  const read = (stage: "beforeRead" | "afterRead") => {
    const start = now();
    let value: unknown;
    try { value = runtime.read(); } catch (cause) { fault(stage, cause); }
    const end = now();
    const window = start !== null && end !== null && end >= start
      ? { startMonotonicMs: start, endMonotonicMs: end } : null;
    if (start !== null && end !== null && end < start) fault("clock", new RangeError("Root counter clock reversed"));
    return { value, window };
  };
  const begin = () => {
    if (started) throw new Error("Root counter collector cannot be reused");
    started = true;
    const reading = read("beforeRead"); before = reading.value; beforeWindow = reading.window;
  };
  const end = () => {
    const reading = read("afterRead"); after = reading.value; afterWindow = reading.window; settled = true;
  };
  const evidence = (): RootCounterEvidence => {
    if (!settled) throw new Error("Root counter evidence requested before settlement");
    if (retainedEvidence !== undefined) return retainedEvidence;
    const decodedReading = (value: unknown) => decodeReading(value).pipe(Result.match({
      onFailure: cause => { fault("validation", cause); return null; }, onSuccess: value => value,
    }));
    const first = decodedReading(before), last = decodedReading(after);
    let counters: RootCounterEvidence["counters"] = null;
    const callWindow = beforeWindow !== null && afterWindow !== null &&
      afterWindow.startMonotonicMs >= beforeWindow.endMonotonicMs
      ? { startMonotonicMs: beforeWindow.endMonotonicMs, endMonotonicMs: afterWindow.startMonotonicMs } : null;
    if (beforeWindow !== null && afterWindow !== null && callWindow === null)
      fault("validation", new RootCounterDiagnosticError({ reason: "overlappingReadWindows" }));
    if (first !== null && last !== null) {
      const delta = (start: typeof first.process, finish: typeof first.process) =>
        ({ user: finish.user - start.user, system: finish.system - start.system });
      const verdict = decodeDelta({ process: delta(first.process, last.process),
        thread: first.thread === null || last.thread === null ? null : delta(first.thread, last.thread),
        window: beforeWindow === null || afterWindow === null ? null :
          { startMonotonicMs: beforeWindow.startMonotonicMs, endMonotonicMs: afterWindow.endMonotonicMs } }).pipe(Result.match({
          onFailure: cause => { fault("validation", cause); return null; }, onSuccess: value => value,
        }));
      if ((first.thread === null) !== (last.thread === null))
        fault("validation", new RootCounterDiagnosticError({ reason: "threadAvailabilityChanged" }));
      else if (callWindow !== null) counters = verdict;
    }
    retainedEvidence = { complete: counters !== null && faults.length === 0,
      host: { pid: process.pid, threadId, node: process.versions.node, platform: process.platform,
        exclusivity: "controlled-isolate-only", externalContention: "unavailable" },
      resolution: { unit: "microseconds", processMicroseconds: null, threadMicroseconds: null, wallPrecisionMs: null },
      callWindow, counterReads: { before: beforeWindow, after: afterWindow },
      readings: { before: first === null ? null : { process: first.process, thread: first.thread },
        after: last === null ? null : { process: last.process, thread: last.thread } },
      counters, failures: faults.map(entry => entry.stage) };
    return retainedEvidence;
  };
  return {
    async capture<A>(invoke: () => Promise<A>): Promise<A> {
      begin();
      try { return await invoke(); } finally { end(); }
    },
    /** Back-to-back synchronous reads expose acquisition cost outside real calls. */
    calibrate(): RootCounterEvidence { begin(); end(); return evidence(); },
    evidence, failures: () => [...faults],
  };
}

export function calibrateRootCounters(runtime: RootCounterRuntime = live): readonly RootCounterEvidence[] {
  return Array.from({ length: 8 }, () => createRootCounterCollector(runtime).calibrate());
}
