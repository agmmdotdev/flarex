import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { CorePersistenceError, type CoreInterval, type CorePersistenceIndexEntry } from "../../src/core/contracts";
import { CoreIntervalSet, CorePendingWrites, CoreReadSetBuilder, CoreWriteLog, indexKeysFromWrites, indexTransitionsFromWrites,
  type CoreConflict, type CoreIndexKeys, type CoreReadSet } from "../../src/core/writeLog";

/**
 * Random histories run against the real owners and against a naive model that keeps
 * unordered maps of hex-spelled keys and rescans them. Hex text orders as the bytes do.
 */
interface Retention { readonly minRetentionNanoseconds: bigint; readonly maxRetentionNanoseconds: bigint; readonly softMaxBytes: number }
interface Snapshot {
  readonly timestamp: bigint;
  readonly minimumTimestamp: bigint;
  conflict(reads: CoreReadSet, after: bigint): Result.Result<CoreConflict | undefined, CorePersistenceError>;
  nativeKeyTransition(indexId: Uint8Array, key: Uint8Array, after: bigint): Result.Result<CoreConflict | undefined, CorePersistenceError>;
}
interface Log {
  snapshot(): Snapshot;
  append(timestamp: bigint, changes: readonly CoreIndexKeys[], retainedBytes?: number, transitions?: readonly CoreIndexKeys[]): void;
  enforceRetention(currentTimestamp: bigint): void;
}
interface Pending {
  readonly size: number;
  push(timestamp: bigint, changes: readonly CoreIndexKeys[]): void;
  conflict(reads: CoreReadSet): CoreConflict | undefined;
  range(indexId: Uint8Array, interval: CoreInterval, maxResults: number): readonly CoreConflict[];
  pop(timestamp: bigint): void;
}
interface Builder { readonly intervalCount: number; add(indexId: Uint8Array, interval: CoreInterval): void; snapshot(): CoreReadSet }
interface Subject {
  readonly log: (timestamp: bigint, retention: Retention) => Log;
  readonly pending: () => Pending;
  readonly builder: () => Builder;
  readonly union: (intervals: readonly CoreInterval[]) => readonly CoreInterval[];
  readonly keys: (writes: readonly CorePersistenceIndexEntry[]) => readonly CoreIndexKeys[];
  readonly transitions: (writes: readonly CorePersistenceIndexEntry[]) => readonly CoreIndexKeys[];
}

const real: Subject = {
  log: (timestamp, retention) => new CoreWriteLog(timestamp, retention),
  pending: () => new CorePendingWrites(),
  builder: () => new CoreReadSetBuilder(),
  union: intervals => {
    const set = new CoreIntervalSet();
    for (const interval of intervals) set.addOwned({ start: interval.start, end: interval.end });
    return [...set.values()];
  },
  keys: indexKeysFromWrites,
  transitions: indexTransitionsFromWrites,
};

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const unhex = (text: string) => Uint8Array.from(Buffer.from(text, "hex"));
interface TextInterval { readonly start: string | null; readonly end: string | null }
const textInterval = (interval: CoreInterval): TextInterval => ({
  start: interval.start === null ? null : hex(interval.start), end: interval.end === null ? null : hex(interval.end),
});
const covers = (interval: TextInterval, key: string) =>
  (interval.start === null || key >= interval.start) && (interval.end === null || key < interval.end);

function modelUnion(intervals: readonly TextInterval[]): TextInterval[] {
  const ordered = intervals.filter(interval => interval.start === null || interval.end === null || interval.start < interval.end)
    .toSorted((a, b) => a.start === b.start ? 0 : a.start === null ? -1 : b.start === null ? 1 : a.start < b.start ? -1 : 1);
  const merged: TextInterval[] = [];
  for (const interval of ordered) {
    const last = merged.at(-1);
    if (last === undefined || (last.end !== null && interval.start !== null && interval.start > last.end)) merged.push(interval);
    else merged[merged.length - 1] = { start: last.start,
      end: last.end === null || interval.end === null ? null : last.end >= interval.end ? last.end : interval.end };
  }
  return merged;
}
const bytesInterval = (interval: TextInterval): CoreInterval => ({
  start: interval.start === null ? null : unhex(interval.start), end: interval.end === null ? null : unhex(interval.end),
});

class ModelBuilder implements Builder {
  private readonly added = new Map<string, TextInterval[]>();
  get intervalCount(): number { return [...this.added.values()].reduce((count, intervals) => count + modelUnion(intervals).length, 0); }
  add(indexId: Uint8Array, interval: CoreInterval): void {
    const text = textInterval(interval);
    if (modelUnion([text]).length === 0) return;
    const name = hex(indexId);
    this.added.set(name, [...this.added.get(name) ?? [], text]);
  }
  snapshot(): CoreReadSet {
    return [...this.added].map(([name, intervals]) => ({ indexId: unhex(name), intervals: modelUnion(intervals).map(bytesInterval) }));
  }
}

type ModelKeys<A> = Map<string, Map<string, A>>;
/** The smallest written key inside any read interval, for the first read that has one. */
function modelConflict<A>(keys: ModelKeys<A>, reads: CoreReadSet, visible: (value: A) => bigint | undefined): CoreConflict | undefined {
  for (const read of reads) {
    const intervals = read.intervals.map(textInterval);
    const found = [...keys.get(hex(read.indexId)) ?? []].toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .flatMap(([key, value]) => {
        const timestamp = visible(value);
        return timestamp !== undefined && intervals.some(interval => covers(interval, key)) ? [{ key, timestamp }] : [];
      })[0];
    if (found !== undefined) return { indexId: read.indexId.slice(), key: unhex(found.key), timestamp: found.timestamp };
  }
  return undefined;
}
const keyBytes = (changes: readonly CoreIndexKeys[]) => changes.reduce((total, change) =>
  total + change.indexId.length + change.keys.reduce((bytes, key) => bytes + key.length + 8, 0), 0);
const failed = (reason: "outOfRetention" | "invalidTarget") => Result.fail(new CorePersistenceError({ reason }));

class ModelLog implements Log {
  private readonly changes: ModelKeys<bigint> = new Map();
  private readonly transitions: ModelKeys<bigint> = new Map();
  private batches: { timestamp: bigint; bytes: number }[] = [];
  private minimum: bigint;
  private latest: bigint;
  private size = 0;
  private current: Snapshot | undefined;
  constructor(timestamp: bigint, private readonly retention: Retention) { this.minimum = timestamp; this.latest = timestamp; }

  snapshot(): Snapshot {
    const copy = (keys: ModelKeys<bigint>): ModelKeys<bigint> => new Map([...keys].map(([name, written]) => [name, new Map(written)]));
    const [changes, transitions, timestamp, minimumTimestamp] = [copy(this.changes), copy(this.transitions), this.latest, this.minimum];
    return this.current ??= {
      timestamp, minimumTimestamp,
      conflict: (reads, after) => after < minimumTimestamp ? failed("outOfRetention")
        : Result.succeed(modelConflict(changes, reads, written => written > after ? written : undefined)),
      nativeKeyTransition: (indexId, key, after) => {
        if (after < minimumTimestamp) return failed("outOfRetention");
        if (after > timestamp) return failed("invalidTarget");
        const written = transitions.get(hex(indexId))?.get(hex(key));
        return Result.succeed(written !== undefined && written > after ? { indexId: indexId.slice(), key: key.slice(), timestamp: written } : undefined);
      },
    };
  }

  append(timestamp: bigint, changes: readonly CoreIndexKeys[], retainedBytes?: number, transitions: readonly CoreIndexKeys[] = []): void {
    if (timestamp <= this.latest) throw new Error("Write log publication must be increasing");
    this.current = undefined;
    for (const [keys, written] of [[this.changes, changes], [this.transitions, transitions]] as const) for (const change of written) {
      const name = hex(change.indexId);
      const index = keys.get(name) ?? new Map<string, bigint>();
      keys.set(name, index);
      for (const key of change.keys) index.set(hex(key), timestamp);
    }
    const bytes = (retainedBytes ?? keyBytes(changes)) + keyBytes(transitions);
    this.batches.push({ timestamp, bytes });
    this.size += bytes;
    this.latest = timestamp;
    this.enforceRetention(timestamp);
  }

  enforceRetention(currentTimestamp: bigint): void {
    for (let oldest = this.batches[0]; oldest !== undefined; oldest = this.batches[0]) {
      const duration = this.size >= this.retention.softMaxBytes ? this.retention.minRetentionNanoseconds : this.retention.maxRetentionNanoseconds;
      if (oldest.timestamp >= (currentTimestamp > duration ? currentTimestamp - duration : 0n)) return;
      this.current = undefined;
      this.batches = this.batches.slice(1);
      this.minimum = oldest.timestamp;
      this.size -= oldest.bytes;
      for (const keys of [this.changes, this.transitions]) for (const index of keys.values())
        for (const [key, written] of index) if (written === oldest.timestamp) index.delete(key);
    }
  }
}

class ModelPending implements Pending {
  private commits: { timestamp: bigint; changes: readonly CoreIndexKeys[] }[] = [];
  private readonly keys: ModelKeys<bigint[]> = new Map();
  get size(): number { return this.commits.length; }

  push(timestamp: bigint, changes: readonly CoreIndexKeys[]): void {
    const last = this.commits.at(-1);
    if (last !== undefined && last.timestamp >= timestamp) throw new Error("Pending commits must be increasing");
    for (const change of changes) {
      const name = hex(change.indexId);
      const index = this.keys.get(name) ?? new Map<string, bigint[]>();
      this.keys.set(name, index);
      for (const key of change.keys) index.set(hex(key), [...index.get(hex(key)) ?? [], timestamp]);
    }
    this.commits.push({ timestamp, changes });
  }

  conflict(reads: CoreReadSet): CoreConflict | undefined { return modelConflict(this.keys, reads, writers => writers.at(-1)); }

  range(indexId: Uint8Array, interval: CoreInterval, maxResults: number): readonly CoreConflict[] {
    const text = textInterval(interval);
    return [...this.keys.get(hex(indexId)) ?? []].filter(([key, writers]) => writers.length > 0 && covers(text, key))
      .toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, maxResults)
      .map(([key, writers]) => ({ indexId: indexId.slice(), key: unhex(key), timestamp: writers.at(-1) ?? -1n }));
  }

  pop(timestamp: bigint): void {
    const first = this.commits[0];
    if (first?.timestamp !== timestamp) throw new Error("Pending removal must follow publication order");
    this.commits = this.commits.slice(1);
    for (const change of first.changes) for (const key of change.keys) {
      const index = this.keys.get(hex(change.indexId));
      index?.set(hex(key), (index.get(hex(key)) ?? []).slice(1));
    }
  }
}

const modelKeys = (writes: readonly CorePersistenceIndexEntry[]): readonly CoreIndexKeys[] => {
  const indexes = new Map<string, Set<string>>();
  for (const write of writes) indexes.set(hex(write.index.id), (indexes.get(hex(write.index.id)) ?? new Set<string>()).add(hex(write.key)));
  return [...indexes].map(([name, keys]) => ({ indexId: unhex(name), keys: [...keys].toSorted().map(unhex) }));
};
const model: Subject = {
  log: (timestamp, retention) => new ModelLog(timestamp, retention),
  pending: () => new ModelPending(),
  builder: () => new ModelBuilder(),
  union: intervals => modelUnion(intervals.map(textInterval)).map(bytesInterval),
  keys: modelKeys,
  transitions: writes => modelKeys(writes.filter(write => write.value === null || write.prev === null)),
};

/** Deterministic xorshift32, so a failing history is named by its seed. */
function generator(seed: number): (bound: number) => number {
  let state = seed;
  return bound => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % bound;
  };
}

const spell = (value: unknown): unknown => value instanceof Uint8Array ? hex(value) : typeof value === "bigint" ? `${value}n`
  : Array.isArray(value) ? value.map(spell)
    : typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).map(([name, field]) => [name, spell(field)])) : value;
const outcome = (result: Result.Result<CoreConflict | undefined, CorePersistenceError>): unknown =>
  Result.match(result, { onSuccess: spell, onFailure: error => `refused: ${error.reason}` });
const attempt = (run: () => void): string => {
  try { run(); return "done"; } catch (error) { return error instanceof Error ? error.message : "threw"; }
};

/** Short keys over three byte values, so equal, adjacent, prefixed and empty keys are all common. */
function history(subject: Subject, seed: number): unknown[] {
  const next = generator(seed);
  const key = () => Uint8Array.from({ length: next(4) }, () => next(3));
  const identifiers = [Uint8Array.of(1), Uint8Array.of(1, 0), Uint8Array.of(2)];
  // The same identifier arrives both as one retained array and as fresh equal bytes.
  const identifier = () => { const id = identifiers[next(3)] ?? Uint8Array.of(9); return next(2) === 0 ? id : id.slice(); };
  const interval = (): CoreInterval => {
    const shape = next(8);
    const start = key();
    return shape === 0 ? { start: null, end: key() } : shape === 1 ? { start, end: null } : shape === 2 ? { start: null, end: null }
      : shape < 5 ? { start, end: Uint8Array.of(...start, 0) } : { start, end: key() };
  };
  const writes = (): CorePersistenceIndexEntry[] => Array.from({ length: next(7) }, () => ({
    mode: "scanComplete" as const, ts: 0n, index: { id: identifier() }, key: key(),
    value: next(3) === 0 ? null : { tableId: Uint8Array.of(4), documentId: Uint8Array.of(5) },
    prev: next(2) === 0 ? null : { ts: 0n, documentId: Uint8Array.of(5) },
  }));
  const reads = (): CoreReadSet => {
    const builder = subject.builder();
    for (let count = next(5); count > 0; count -= 1) builder.add(identifier(), interval());
    return builder.snapshot();
  };
  const transcript: unknown[] = [];
  const log = subject.log(BigInt(next(3)), { minRetentionNanoseconds: BigInt(next(4)), maxRetentionNanoseconds: BigInt(2 + next(12)),
    softMaxBytes: next(120) });
  const pending = subject.pending();
  const builder = subject.builder();
  const added: CoreInterval[] = [];
  const held = [log.snapshot()];
  const queued: bigint[] = [];
  let clock = 3n;
  for (let step = 0; step < 120; step += 1) {
    const action = next(12);
    if (action < 3) {
      const id = identifiers[0] ?? Uint8Array.of(9);
      const read = interval();
      added.push({ start: read.start?.slice() ?? null, end: read.end?.slice() ?? null });
      builder.add(id, read);
      // A caller's later writes to its own bounds must not reach the recorded dependency.
      read.start?.fill(7);
      read.end?.fill(7);
      builder.add(identifier(), interval());
      transcript.push(["read", builder.intervalCount, spell(builder.snapshot()), spell(subject.union(added))]);
    } else if (action < 6) {
      const written = writes();
      const timestamp = next(9) === 0 ? clock - 1n : (clock += BigInt(1 + next(3)));
      const before = log.snapshot();
      transcript.push(["append", attempt(() => log.append(timestamp, subject.keys(written), next(2) === 0 ? undefined : next(60),
        subject.transitions(written))), log.snapshot() === before]);
      held.push(log.snapshot());
    } else if (action === 6) {
      const before = log.snapshot();
      log.enforceRetention(clock + BigInt(next(10)));
      transcript.push(["retain", log.snapshot() === before, `${log.snapshot().minimumTimestamp}n`]);
    } else if (action < 9) {
      const snapshot = held[next(held.length)] ?? log.snapshot();
      const after = BigInt(next(Number(clock) + 2));
      transcript.push(["conflict", `${snapshot.timestamp}n`, `${snapshot.minimumTimestamp}n`, outcome(snapshot.conflict(reads(), after)),
        outcome(snapshot.nativeKeyTransition(identifier(), key(), after))]);
    } else if (action === 9) {
      const timestamp = next(9) === 0 ? clock : (clock += 1n);
      const result = attempt(() => pending.push(timestamp, subject.keys(writes())));
      if (result === "done") queued.push(timestamp);
      transcript.push(["push", result, pending.size]);
    } else if (action === 10) {
      const timestamp = next(6) === 0 ? clock + 1n : queued[0] ?? 0n;
      const result = attempt(() => pending.pop(timestamp));
      if (result === "done") queued.shift();
      transcript.push(["pop", result, pending.size]);
    } else transcript.push(["pending", spell(pending.conflict(reads())), spell(pending.range(identifier(), interval(), 1 + next(4)))]);
  }
  return transcript;
}

describe("indexed conflict history against a naive model", () => {
  it("answers every random history exactly as rescanning unordered keys does", () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const actual = JSON.stringify(history(real, seed));
      if (actual !== JSON.stringify(history(model, seed))) expect.fail(`history ${seed} differs from the model`);
    }
  }, 60_000);

  it("records one dependency however often the same interval is read again", () => {
    const builder = new CoreReadSetBuilder();
    const id = Uint8Array.of(1);
    for (let count = 0; count < 3; count += 1) builder.add(id, { start: Uint8Array.of(2), end: Uint8Array.of(2, 0) });
    builder.add(id, { start: Uint8Array.of(2), end: Uint8Array.of(2) });
    expect(builder.intervalCount).toBe(1);
    // An identifier array whose bytes change names another index.
    id.fill(3);
    builder.add(id, { start: null, end: null });
    expect(builder.snapshot()).toEqual([{ indexId: Uint8Array.of(1), intervals: [{ start: Uint8Array.of(2), end: Uint8Array.of(2, 0) }] },
      { indexId: Uint8Array.of(3), intervals: [{ start: null, end: null }] }]);
  });
});
