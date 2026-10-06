import { Session } from "node:inspector/promises";
import type { Profiler } from "node:inspector";

export const CPU_SAMPLING_INTERVAL_MICROSECONDS = 100;

/** Raw inspector deltas include startup, idle and GC. Frame counts are sampling
 * observations, not exclusive CPU durations; never subtract SQL waits from them. */
export function summarizeBenchmarkCpuProfile(profile: Profiler.Profile) {
  const counts = new Map<number, number>();
  for (const node of profile.samples ?? []) counts.set(node, (counts.get(node) ?? 0) + 1);
  const deltas = profile.timeDeltas;
  const sortedDeltas = deltas === undefined ? [] : [...deltas].sort((left, right) => left - right);
  return {
    startTime: profile.startTime, endTime: profile.endTime,
    profileSpanMicroseconds: profile.endTime - profile.startTime,
    requestedSamplingIntervalMicroseconds: CPU_SAMPLING_INTERVAL_MICROSECONDS,
    nodeCount: profile.nodes.length, sampleCount: profile.samples?.length ?? null,
    timeDeltaCount: deltas?.length ?? null,
    actualTimeDeltasMicroseconds: sortedDeltas.length === 0 ? null : {
      first: deltas?.[0], min: sortedDeltas[0], max: sortedDeltas.at(-1),
      median: sortedDeltas[Math.ceil(sortedDeltas.length / 2) - 1],
      sum: sortedDeltas.reduce((sum, value) => sum + value, 0),
    },
    sampledSelfFrames: profile.nodes.filter(node => counts.has(node.id)).map(node => ({
      nodeId: node.id, callFrame: node.callFrame, samples: counts.get(node.id) ?? 0,
    })).sort((left, right) => right.samples - left.samples),
  };
}

export type BenchmarkCpuProfileEvidence = ReturnType<typeof summarizeBenchmarkCpuProfile> &
  Readonly<{ file: string; sha256Hex: string }>;

/** Benchmark-only ownership of a genuine V8 sampling session. Pending inspector
 * operations are drained before disconnect, including interrupted hook callers. */
export class BenchmarkCpuProfiler {
  #session: Session | undefined;
  #pending: Promise<unknown> | undefined;
  #started = false;
  #failure: Error | undefined;

  start(): Promise<void> {
    if (this.#session !== undefined || this.#pending !== undefined)
      throw this.#recordFailure("start", new Error("CPU profile is already open"));
    const session = new Session();
    this.#session = session;
    const pending = this.#start(session).catch(cause => {
      this.#disconnect(session);
      throw this.#recordFailure("start", cause);
    }).finally(() => { this.#pending = undefined; });
    this.#pending = pending;
    return pending;
  }

  async #start(session: Session): Promise<void> {
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: CPU_SAMPLING_INTERVAL_MICROSECONDS });
    await session.post("Profiler.start");
    this.#started = true;
  }

  stop(): Promise<Profiler.Profile> {
    const session = this.#session;
    if (session === undefined || !this.#started || this.#pending !== undefined)
      throw this.#recordFailure("stop", new Error("CPU profile is not running"));
    const pending = session.post("Profiler.stop").then(({ profile }) => profile)
      .catch(cause => { throw this.#recordFailure("stop", cause); })
      .finally(() => {
        this.#pending = undefined;
        this.#disconnect(session);
      });
    this.#pending = pending;
    return pending;
  }

  async dispose(): Promise<void> {
    if (this.#pending !== undefined) await Promise.allSettled([this.#pending]);
    const session = this.#session;
    if (session === undefined) return;
    try {
      if (this.#started) await session.post("Profiler.stop");
    } catch (cause) {
      throw this.#recordFailure("dispose", cause);
    } finally { this.#disconnect(session); }
  }

  assertMeasurement(): void { if (this.#failure !== undefined) throw this.#failure; }

  #disconnect(session: Session): void {
    if (this.#session === session) this.#session = undefined;
    this.#started = false;
    session.disconnect();
  }

  #recordFailure(stage: "start" | "stop" | "dispose", cause: unknown): Error {
    const error = new Error(`Benchmark CPU profiler ${stage} failed`, { cause });
    this.#failure ??= error;
    return error;
  }
}
