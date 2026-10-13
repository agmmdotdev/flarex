import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { Result, Schema } from "effect";
import { readNodeResourceCounters } from "./collectors/nodeResources";

export const CycleOptionsSchema = Schema.Struct({
  readerPath: Schema.String.check(Schema.isMinLength(1)),
  detail: Schema.Literals(["engine", "generators"]),
  order: Schema.Literals(["abba", "baab"]),
});
const Count = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const decodeThreadIdentity = Schema.decodeUnknownSync(Count);
const Decimal = Schema.String.check(Schema.isPattern(/^\d+$/));
const Bucket = Schema.Struct({ site: Schema.String.check(Schema.isMaxLength(400)), cycles: Count, calls: Count });
export const CycleEvidenceSchema = Schema.Struct({
  complete: Schema.Boolean, observed: Schema.Boolean, detail: CycleOptionsSchema.fields.detail,
  threadId: Count, first: Schema.NullOr(Decimal), last: Schema.NullOr(Decimal), totalCycles: Schema.NullOr(Count),
  buckets: Schema.Array(Bucket).check(Schema.isMaxLength(10_000)),
  failures: Schema.Array(Schema.String).check(Schema.isMaxLength(8)),
}).check(Schema.makeFilter(value => {
  if (!value.complete) return undefined;
  return value.first !== null && value.last !== null && value.totalCycles !== null && value.failures.length === 0 &&
    BigInt(value.last) - BigInt(value.first) === BigInt(value.totalCycles) &&
    value.buckets.reduce((sum, bucket) => sum + bucket.cycles, 0) === value.totalCycles
    ? undefined : "Complete cycle partition must reconcile exactly with its own root readings";
}));
export type CycleEvidence = typeof CycleEvidenceSchema.Type;
const decodeEvidence = Schema.decodeUnknownResult(CycleEvidenceSchema);
export interface CycleReader { readonly read: () => bigint; readonly threadId: () => number }
type Site = { readonly site: string };
type Source = Readonly<{ file: string; originalHash: string; transformedHash: string; sites: readonly string[] }>;
const sources = new Map<string, Source>();
export function assertCycleTransformSelection(detail?: "engine" | "generators"): void {
  if (sources.size > 0 && detail !== "generators") throw new Error("Generator transforms require the generator cycle selection");
  if (sources.size === 0 && detail === "generators") throw new Error("Generator cycle transform was not installed");
}
/** Called only by the opt-in diagnostic Vite transform, never by shipped code. */
export function registerCycleSource(source: Source): void {
  const existing = sources.get(source.file);
  if (existing !== undefined && existing.transformedHash !== source.transformedHash)
    throw new Error("Cycle probe source changed within one process");
  if (sources.size >= 2_000 && existing === undefined) throw new Error("Cycle source bound exceeded");
  sources.set(source.file, source);
}

let active: ReturnType<typeof createCyclePartition> | undefined;
export async function captureCyclePartition<A>(partition: ReturnType<typeof createCyclePartition>, invoke: () => Promise<A>): Promise<A> {
  if (active !== undefined) throw new Error("Overlapping cycle diagnostic");
  active = partition;
  try { partition.begin(); return await invoke(); }
  finally { partition.end(); active = undefined; }
}
/** Generator factory and iterator methods forward the original receiver,
 * arguments, return and throw. Only synchronous advances enter the partition. */
export function observeGenerator<T extends (...args: never[]) => unknown>(site: string, body: T): T {
  return new Proxy(body, { apply(target, receiver, args: unknown[]) {
    const iterator: unknown = Reflect.apply(target, receiver, args);
    if (active?.generators !== true || typeof iterator !== "object" || iterator === null) return iterator;
    return new Proxy(iterator, { get(target, key, receiver) {
      const method: unknown = Reflect.get(target, key, receiver);
      if ((key !== "next" && key !== "throw" && key !== "return") || typeof method !== "function") return method;
      return (...inputs: unknown[]): unknown => {
        const partition = active;
        const token = partition?.enter(site);
        try { return Reflect.apply(method, target, inputs); }
        finally { if (token !== undefined) partition?.leave(token); }
      };
    } });
  } });
}

/** Counter acquisition faults invalidate observation without replacing the
 * original business outcome. A request's synchronous stack never spans awaits. */
export function createCyclePartition(reader: CycleReader, detail: "engine" | "generators", observed: boolean) {
  const buckets = new Map<string, { cycles: number; calls: number }>();
  const stack: Site[] = [];
  const faults: unknown[] = [];
  const fault = (cause: unknown) => { if (faults.length < 8) faults.push(cause); };
  let first: bigint | null = null, last: bigint | null = null, identity = 0, started = false, settled = false, edges = 0;
  const read = (): bigint | null => {
    try {
      const value = reader.read();
      if (typeof value !== "bigint" || value < 0n || (last !== null && value < last)) throw new Error("Invalid cycle counter");
      return value;
    } catch (cause) { fault(cause); return null; }
  };
  const bucket = (site: string) => {
    let value = buckets.get(site);
    if (value === undefined) {
      if (buckets.size >= 10_000 || site.length > 400) throw new Error("Cycle site bound exceeded");
      value = { cycles: 0, calls: 0 }; buckets.set(site, value);
    }
    return value;
  };
  const edge = () => {
    if (faults.length > 0) return;
    try {
      if (++edges > 500_000) throw new Error("Cycle edge bound exceeded");
      const next = read();
      if (next === null || last === null) return;
      const delta = Number(next - last);
      if (!Number.isSafeInteger(delta)) throw new Error("Cycle delta exceeds safe accounting range");
      const current = bucket(stack.at(-1)?.site ?? "outside-observed-execution");
      if (!Number.isSafeInteger(current.cycles + delta)) throw new Error("Cycle bucket exceeds safe accounting range");
      current.cycles += delta; last = next;
    } catch (cause) { fault(cause); }
  };
  return {
    generators: observed && detail === "generators",
    enter(site: string): Site | undefined {
      if (!started || settled || !observed || faults.length > 0) return undefined;
      edge();
      try {
        if (stack.length >= 512) throw new Error("Cycle nesting bound exceeded");
        const token = { site }; bucket(site).calls++; stack.push(token); return token;
      } catch (cause) { fault(cause); return undefined; }
    },
    leave(token: Site): void {
      edge();
      if (stack.pop() !== token) fault(new Error("Non-nested synchronous cycle boundary"));
    },
    begin(): void {
      if (started) throw new Error("Cycle partition cannot be reused");
      started = true;
      try {
        const value = reader.threadId();
        if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid cycle thread identity");
        identity = value;
      } catch (cause) { fault(cause); }
      first = read(); last = first;
    },
    end(): void {
      edge(); settled = true;
      if (stack.length > 0) fault(new Error("Synchronous cycle scope escaped request"));
      try { if (reader.threadId() !== identity) fault(new Error("Cycle thread changed")); } catch (cause) { fault(cause); }
    },
    evidence(): CycleEvidence {
      if (!settled) throw new Error("Cycle evidence requested before settlement");
      const measured = first === null || last === null ? null : Number(last - first);
      const total = measured !== null && Number.isSafeInteger(measured) ? measured : null;
      const evidence = { complete: faults.length === 0 && total !== null, observed, detail, threadId: identity,
        first: first === null ? null : String(first), last: last === null ? null : String(last), totalCycles: total,
        buckets: [...buckets].map(([site, value]) => ({ site, ...value })), failures: faults.map(() => "cycleObservation") };
      return Result.getOrThrow(decodeEvidence(evidence));
    },
    failures: () => [...faults],
    requireObservedSite(site: string): void {
      if (observed && ![...buckets].some(([name, value]) => name.startsWith(site) && value.calls > 0))
        fault(new Error("Required execution boundary was not observed"));
    },
  };
}

const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Reuses the existing Windows Node-API reader and original installed Effect
 * runner. Both are diagnostic resources; no Effect implementation is copied. */
export async function acquireCycleAttribution(options: typeof CycleOptionsSchema.Type) {
  if (process.platform !== "win32") throw new Error("The available cycle reader requires Windows");
  const require = createRequire(import.meta.url);
  const readerPath = resolve(options.readerPath);
  const native: unknown = require(readerPath);
  const functions = Schema.decodeUnknownSync(Schema.Struct({ readCycles: Schema.Unknown, threadId: Schema.Unknown }))(native);
  const readCycles = functions.readCycles, threadId = functions.threadId;
  if (typeof readCycles !== "function" || typeof threadId !== "function") throw new Error("Invalid native cycle reader");
  const reader: CycleReader = {
    read: () => { const value: unknown = readCycles(); if (typeof value !== "bigint" || value < 0n) throw new Error("Invalid native cycle reading"); return value; },
    threadId: () => { const value: unknown = threadId(); return decodeThreadIdentity(value); },
  };
  const enginePath = resolve(dirname(require.resolve("effect")), "internal/effect.js");
  const engine: unknown = await import(/* @vite-ignore */pathToFileURL(enginePath).href);
  const { FiberImpl } = Schema.decodeUnknownSync(Schema.Struct({ FiberImpl: Schema.Unknown }))(engine);
  if (typeof FiberImpl !== "function") throw new Error("Installed Effect runner is unavailable");
  const prototype: unknown = FiberImpl.prototype;
  if (typeof prototype !== "object" || prototype === null) throw new Error("Installed Effect runner has no prototype");
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "runLoop");
  const original: unknown = descriptor?.value;
  if (descriptor === undefined || typeof original !== "function" || descriptor.configurable !== true)
    throw new Error("Installed Effect runner cannot be observed");
  const readerHash = hash(await readFile(readerPath)), engineHash = hash(await readFile(enginePath));
  // Empirical increments describe this calibration only, not guaranteed precision.
  const cycleDeltas: number[] = [], threadDeltas: number[] = [];
  let previousCycle = reader.read(), previousThread = readNodeResourceCounters().thread;
  const calibrationStart = performance.now();
  for (let index = 0; index < 50_000 && performance.now() - calibrationStart < 64; index++) {
    const next = reader.read(), thread = readNodeResourceCounters().thread;
    cycleDeltas.push(Number(next - previousCycle)); previousCycle = next;
    if (thread !== null && previousThread !== null) threadDeltas.push(thread.user + thread.system - previousThread.user - previousThread.system);
    previousThread = thread;
  }
  const positiveMinimum = (values: readonly number[]) => values.filter(value => value > 0).reduce<number | null>((min, value) => min === null ? value : Math.min(min, value), null);
  const calibration = { reads: cycleDeltas.length, elapsedMs: performance.now() - calibrationStart,
    minimumPositiveCycles: positiveMinimum(cycleDeltas), minimumPositiveThreadMicroseconds: positiveMinimum(threadDeltas),
    zeroThreadDeltas: threadDeltas.filter(value => value === 0).length };
  const wrapper = function(this: unknown, ...args: unknown[]): unknown {
    const partition = active, token = partition?.enter("effect-engine-excluding-observed-bodies");
    try { return Reflect.apply(original, this, args); }
    finally { if (token !== undefined) partition?.leave(token); }
  };
  let closed = false, capturing = false;
  return {
    metadata: () => ({ ...options, readerPath: undefined, readerHash, engineHash, calibration, sources: [...sources.values()] }),
    create(observed: boolean) {
      const partition = createCyclePartition(reader, options.detail, observed);
      return {
        ...partition,
        async capture<A>(invoke: () => Promise<A>): Promise<A> {
          if (closed || capturing || active !== undefined) throw new Error("Overlapping cycle diagnostic");
          assertCycleTransformSelection(options.detail);
          capturing = true;
          try {
            Object.defineProperty(prototype, "runLoop", { ...descriptor, value: wrapper });
            return await captureCyclePartition(partition, invoke);
          }
          finally {
            capturing = false;
            Object.defineProperty(prototype, "runLoop", descriptor);
            partition.requireObservedSite("effect-engine-excluding-observed-bodies");
            if (options.detail === "generators") partition.requireObservedSite("packages/");
          }
        },
      };
    },
    close: async () => { if (capturing) throw new Error("Cycle capture has not settled"); closed = true; },
  };
}
