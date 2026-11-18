/**
 * Mechanisms translated from Convex crates/database/src/write_log.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Result } from "effect";
import { bytesEqual, compareBytesLexicographically, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CorePersistenceError, type CoreInterval, type CorePersistenceIndexEntry, type CoreTimestamp } from "./contracts";

/** Pinned source: db914cf06 database/src/write_log.rs, WriteLogSnapshot/PendingKeysInIndex. */
export interface CoreIndexRead {
  readonly indexId: Uint8Array;
  readonly intervals: readonly CoreInterval[];
}

export type CoreReadSet = readonly CoreIndexRead[];
export interface CoreIndexKeys { readonly indexId: Uint8Array; readonly keys: readonly Uint8Array[] }
export interface CoreConflict { readonly indexId: Uint8Array; readonly key: Uint8Array; readonly timestamp: CoreTimestamp }

export function keyInInterval(key: Uint8Array, interval: CoreInterval): boolean {
  return (interval.start === null || compareBytesLexicographically(key, interval.start) >= 0)
    && (interval.end === null || compareBytesLexicographically(key, interval.end) < 0);
}

export function copyInterval(interval: CoreInterval): CoreInterval {
  const { start, end } = interval;
  return Object.freeze({ start: start === null ? null : copyBytes(start), end: end === null ? null : copyBytes(end) });
}

export function pointInterval(key: Uint8Array): CoreInterval {
  const end = new Uint8Array(key.length + 1);
  end.set(key);
  return Object.freeze({ start: key.slice(), end });
}

/**
 * Lowercase-hex spelling of an index identifier. Registry references and retained batches present the same
 * array many times, so its spelling is kept beside a private copy and reused only while the bytes still match.
 */
const spelledIdentifiers = new WeakMap<Uint8Array, Readonly<{ id: Uint8Array; name: string }>>();
function indexName(indexId: Uint8Array): string {
  const known = spelledIdentifiers.get(indexId);
  if (known !== undefined && bytesEqual(known.id, indexId)) return known.name;
  const name = encodeBytesToLowercaseHex(indexId);
  spelledIdentifiers.set(indexId, { id: copyBytes(indexId), name });
  return name;
}

/** An owned copy of an identifier whose spelling is already known, so later batches need not respell it. */
function copySpelledIdentifier(indexId: Uint8Array, name: string): Uint8Array {
  const owned = copyBytes(indexId);
  spelledIdentifiers.set(owned, { id: copyBytes(indexId), name });
  return owned;
}

type OrderedIntervals = BTree<Uint8Array | null, CoreInterval>;
interface ReadIndex { readonly id: Uint8Array; readonly intervals: OrderedIntervals }

function intervalIsEmpty(interval: CoreInterval): boolean {
  return interval.start !== null && interval.end !== null && compareBytesLexicographically(interval.start, interval.end) >= 0;
}

/**
 * Unions one non-empty interval into a normalized set. An `owned` interval's bounds are kept and never written;
 * otherwise only the bounds the set retains are copied. Each neighbour is found by one descent.
 */
function mergeInterval(intervals: OrderedIntervals, interval: CoreInterval, owned: boolean): void {
  let start = interval.start;
  let end = interval.end;
  let merged = false;
  // Normalized members are disjoint and non-adjacent, so only the equal-or-lower one can reach `start`.
  const previous = intervals.getPairOrNextLower(start)?.[1];
  if (previous !== undefined && (previous.end === null || start === null
    || compareBytesLexicographically(previous.end, start) >= 0)) {
    // A member that already covers the interval leaves the set as it is.
    if (previous.end === null || (end !== null && compareBytesLexicographically(previous.end, end) >= 0)) return;
    start = previous.start;
    merged = true;
  }
  for (;;) {
    const next = intervals.nextHigherPair(start);
    if (next === undefined) break;
    const [key, value] = next;
    if (end !== null && key !== null && compareBytesLexicographically(key, end) > 0) break;
    end = maximumEnd(end, value.end);
    intervals.delete(key);
    merged = true;
  }
  if (owned) {
    intervals.set(start, merged ? { start, end } : interval);
    return;
  }
  // Bounds taken from members are already the set's own; the caller's are not.
  if (start !== null && start === interval.start) start = copyBytes(start);
  if (end !== null && end === interval.end) end = copyBytes(end);
  intervals.set(start, { start, end });
}

/** One index's ordered, normalized interval union, with the read set's merge. */
export class CoreIntervalSet {
  private readonly intervals: OrderedIntervals = new BTree<Uint8Array | null, CoreInterval>(undefined, compareStarts);

  /** Takes ownership of `interval`: the caller must never write its bounds again. */
  addOwned(interval: CoreInterval): void {
    if (!intervalIsEmpty(interval)) mergeInterval(this.intervals, interval, true);
  }

  /** Ascending, disjoint and non-adjacent. The set still owns every bound. */
  values(): IterableIterator<CoreInterval> { return this.intervals.values(); }
}

/** Ordered, normalized interval union. Empty intervals never become broad dependencies. */
export class CoreReadSetBuilder {
  private readonly byIndex = new Map<string, ReadIndex>();
  private count = 0;

  get intervalCount(): number { return this.count; }

  add(indexId: Uint8Array, interval: CoreInterval): void {
    if (intervalIsEmpty(interval)) return;
    const name = indexName(indexId);
    let entry = this.byIndex.get(name);
    if (entry === undefined) {
      entry = { id: indexId.slice(), intervals: new BTree<Uint8Array | null, CoreInterval>(undefined, compareStarts) };
      this.byIndex.set(name, entry);
    }
    const before = entry.intervals.size;
    mergeInterval(entry.intervals, interval, false);
    this.count += entry.intervals.size - before;
  }

  snapshot(): CoreReadSet {
    return Object.freeze([...this.byIndex.values()].map(entry => Object.freeze({
      indexId: entry.id.slice(), intervals: Object.freeze([...entry.intervals.values()].map(copyInterval)),
    })));
  }
}

function compareStarts(a: Uint8Array | null, b: Uint8Array | null): number {
  return a === null ? b === null ? 0 : -1 : b === null ? 1 : compareBytesLexicographically(a, b);
}

function compareTimestamps(a: CoreTimestamp, b: CoreTimestamp): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function maximumEnd(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null || b === null ? null : compareBytesLexicographically(a, b) >= 0 ? a : b;
}

type Keys = BTree<Uint8Array, CoreTimestamp>;
interface IndexedKeys { readonly id: Uint8Array; readonly tree: Keys }
interface PendingIndexedKeys {
  readonly id: Uint8Array;
  readonly tree: BTree<Uint8Array, readonly CoreTimestamp[]>;
}

function overlap<A>(tree: BTree<Uint8Array, A>, intervals: readonly CoreInterval[], after: CoreTimestamp,
  timestamp: (value: A) => CoreTimestamp): readonly [Uint8Array, CoreTimestamp] | undefined {
  // Both sides are sorted. Probe the smaller side, as PendingKeysInIndex does.
  if (tree.size <= intervals.length) {
    for (const [key, value] of tree.entries()) {
      const ts = timestamp(value);
      if (ts > after && containsInterval(intervals, key)) return [key, ts];
    }
    return undefined;
  }
  for (const interval of intervals) {
    if (interval.start !== null) {
      // Most intervals hold no written key: one descent settles them without an iterator.
      const first = tree.getPairOrNextHigher(interval.start);
      if (first === undefined || (interval.end !== null && compareBytesLexicographically(first[0], interval.end) >= 0)) continue;
      const ts = timestamp(first[1]);
      if (ts > after) return [first[0], ts];
    }
    for (const [key, value] of tree.entries(interval.start ?? undefined)) {
      const ts = timestamp(value);
      if (interval.end !== null && compareBytesLexicographically(key, interval.end) >= 0) break;
      if (ts > after) return [key, ts];
    }
  }
  return undefined;
}

function containsInterval(intervals: readonly CoreInterval[], key: Uint8Array): boolean {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const interval = intervals[middle];
    if (interval === undefined) return false;
    if (interval.start === null || compareBytesLexicographically(interval.start, key) <= 0) low = middle + 1;
    else high = middle;
  }
  const candidate = intervals[low - 1];
  return candidate !== undefined && keyInInterval(key, candidate);
}

export function indexKeysFromWrites(writes: readonly CorePersistenceIndexEntry[]): readonly CoreIndexKeys[] {
  const indexes = new Map<string, { id: Uint8Array; keys: Uint8Array[] }>();
  for (const write of writes) {
    const name = indexName(write.index.id);
    let entry = indexes.get(name);
    if (entry === undefined) {
      entry = { id: copySpelledIdentifier(write.index.id, name), keys: [] };
      indexes.set(name, entry);
    }
    entry.keys.push(write.key);
  }
  return Object.freeze([...indexes.values()].map(entry => {
    // Ascending distinct keys, each an owned copy.
    const keys: Uint8Array[] = [];
    let last: Uint8Array | undefined;
    for (const key of entry.keys.toSorted(compareBytesLexicographically)) {
      if (last === undefined || compareBytesLexicographically(last, key) !== 0) keys.push(key.slice());
      last = key;
    }
    return Object.freeze({ indexId: entry.id, keys: Object.freeze(keys) });
  }));
}

/** A derived live entry retains prev exactly when its original/final full keys coincide; tombstones remove keys. */
export function indexTransitionsFromWrites(writes: readonly CorePersistenceIndexEntry[]): readonly CoreIndexKeys[] {
  return indexKeysFromWrites(writes.filter(write => write.value === null || write.prev === null));
}

function cloneIndexedKeys(indexes: ReadonlyMap<string, IndexedKeys>): ReadonlyMap<string, IndexedKeys> {
  const cloned = new Map<string, IndexedKeys>();
  for (const [name, entry] of indexes) cloned.set(name, { id: entry.id, tree: entry.tree.clone() });
  return cloned;
}

/** COW B+tree clones share immutable index batches without copying document bodies. */
export class CoreWriteLogSnapshot {
  readonly #indexes: ReadonlyMap<string, IndexedKeys>;
  readonly #transitions: ReadonlyMap<string, IndexedKeys>;

  constructor(
    readonly timestamp: CoreTimestamp,
    readonly minimumTimestamp: CoreTimestamp,
    indexes: ReadonlyMap<string, IndexedKeys>,
    transitions: ReadonlyMap<string, IndexedKeys>,
  ) {
    this.#indexes = indexes;
    this.#transitions = transitions;
    Object.freeze(this);
  }

  /** Native first-capture coherence, distinct from Source's every-write conflicts. */
  nativeKeyTransition(indexId: Uint8Array, key: Uint8Array, after: CoreTimestamp): Result.Result<CoreConflict | undefined, CorePersistenceError> {
    if (after < this.minimumTimestamp) return Result.fail(new CorePersistenceError({ reason: "outOfRetention" }));
    if (after > this.timestamp) return Result.fail(new CorePersistenceError({ reason: "invalidTarget" }));
    const entry = this.#transitions.get(indexName(indexId));
    const timestamp = entry?.tree.get(key);
    return Result.succeed(entry !== undefined && timestamp !== undefined && timestamp > after
      ? { indexId: copyBytes(entry.id), key: copyBytes(key), timestamp } : undefined);
  }

  conflict(reads: CoreReadSet, after: CoreTimestamp): Result.Result<CoreConflict | undefined, CorePersistenceError> {
    if (after < this.minimumTimestamp) return Result.fail(new CorePersistenceError({ reason: "outOfRetention" }));
    for (const read of reads) {
      const entry = this.#indexes.get(encodeBytesToLowercaseHex(read.indexId));
      if (entry === undefined) continue;
      const found = overlap(entry.tree, read.intervals, after, value => value);
      if (found !== undefined) return Result.succeed({ indexId: copyBytes(entry.id), key: copyBytes(found[0]), timestamp: found[1] });
    }
    return Result.succeed(undefined);
  }
}

export class CoreWriteLog {
  #currentSnapshot: CoreWriteLogSnapshot | undefined;
  private readonly indexes = new Map<string, IndexedKeys>();
  private readonly transitions = new Map<string, IndexedKeys>();
  private readonly batches = new BTree<CoreTimestamp, Readonly<{
    changes: readonly CoreIndexKeys[]; transitions: readonly CoreIndexKeys[]; bytes: number;
  }>>(undefined, compareTimestamps);
  private minimum: CoreTimestamp;
  private latest: CoreTimestamp;
  private size = 0;

  constructor(timestamp: CoreTimestamp, private readonly retention: Readonly<{
    minRetentionNanoseconds: bigint; maxRetentionNanoseconds: bigint; softMaxBytes: number;
  }> = { minRetentionNanoseconds: 30_000_000_000n, maxRetentionNanoseconds: 300_000_000_000n,
    softMaxBytes: 50 * 1024 * 1024 }) {
    this.minimum = timestamp;
    this.latest = timestamp;
  }

  snapshot(): CoreWriteLogSnapshot {
    return this.#currentSnapshot ??= new CoreWriteLogSnapshot(this.latest, this.minimum,
      cloneIndexedKeys(this.indexes), cloneIndexedKeys(this.transitions));
  }

  append(timestamp: CoreTimestamp, changes: readonly CoreIndexKeys[], retainedBytes?: number,
    transitions: readonly CoreIndexKeys[] = []): void {
    if (timestamp <= this.latest) throw new Error("Write log publication must be increasing");
    this.#currentSnapshot = undefined;
    this.appendKeys(this.indexes, timestamp, changes);
    this.appendKeys(this.transitions, timestamp, transitions);
    const bytes = (retainedBytes ?? this.keyBytes(changes)) + this.keyBytes(transitions);
    this.batches.set(timestamp, { changes, transitions, bytes });
    this.size += bytes;
    this.latest = timestamp;
    this.enforceRetention(timestamp);
  }

  private appendKeys(indexes: Map<string, IndexedKeys>, timestamp: CoreTimestamp, changes: readonly CoreIndexKeys[]): void {
    for (const change of changes) {
      const name = indexName(change.indexId);
      let entry = indexes.get(name);
      if (entry === undefined) {
        entry = { id: change.indexId.slice(), tree: new BTree<Uint8Array, CoreTimestamp>(undefined, compareBytesLexicographically) };
        indexes.set(name, entry);
      }
      for (const key of change.keys) entry.tree.set(key.slice(), timestamp);
    }
  }

  private keyBytes(changes: readonly CoreIndexKeys[]): number {
    return changes.reduce((total, change) => total + change.indexId.length
      + change.keys.reduce((keyBytes, key) => keyBytes + key.length + 8, 0), 0);
  }

  /** Same time/soft-size decision as WriteLogManager::enforce_retention_policy. */
  enforceRetention(currentTimestamp: bigint): void {
    while (true) {
      const oldest = this.batches.minKey();
      if (oldest === undefined) break;
      const duration = this.size >= this.retention.softMaxBytes
        ? this.retention.minRetentionNanoseconds : this.retention.maxRetentionNanoseconds;
      const limit = currentTimestamp > duration ? currentTimestamp - duration : 0n;
      if (oldest >= limit) break;
      this.#currentSnapshot = undefined;
      const expired = this.batches.get(oldest);
      this.batches.delete(oldest);
      this.minimum = oldest;
      this.size -= expired?.bytes ?? 0;
      this.removeKeys(this.indexes, oldest, expired?.changes ?? []);
      this.removeKeys(this.transitions, oldest, expired?.transitions ?? []);
    }
  }

  private removeKeys(indexes: Map<string, IndexedKeys>, timestamp: CoreTimestamp, changes: readonly CoreIndexKeys[]): void {
    for (const change of changes) {
      const name = indexName(change.indexId);
      const entry = indexes.get(name);
      if (entry === undefined) continue;
      for (const key of change.keys) if (entry.tree.get(key) === timestamp) entry.tree.delete(key);
      if (entry.tree.size === 0) indexes.delete(name);
    }
  }
}

/** Accepted unpublished commits, indexed by full affected key with FIFO removal. */
export class CorePendingWrites {
  private readonly commits = new BTree<CoreTimestamp, readonly CoreIndexKeys[]>(undefined, compareTimestamps);
  private readonly indexes = new Map<string, PendingIndexedKeys>();

  get size(): number { return this.commits.size; }

  push(timestamp: CoreTimestamp, changes: readonly CoreIndexKeys[]): void {
    const last = this.commits.maxKey();
    if (last !== undefined && last >= timestamp) throw new Error("Pending commits must be increasing");
    for (const change of changes) {
      const name = indexName(change.indexId);
      let entry = this.indexes.get(name);
      if (entry === undefined) {
        entry = { id: change.indexId.slice(), tree: new BTree<Uint8Array, readonly CoreTimestamp[]>(undefined, compareBytesLexicographically) };
        this.indexes.set(name, entry);
      }
      for (const key of change.keys) {
        // Native exact-owner validation can admit removal/reacquisition before
        // publication. Source readers still conflict with any pending writer.
        const owned = key.slice();
        if (!entry.tree.set(owned, [timestamp], false)) entry.tree.set(owned, [...entry.tree.get(key) ?? [], timestamp]);
      }
    }
    this.commits.set(timestamp, changes);
  }

  conflict(reads: CoreReadSet): CoreConflict | undefined {
    for (const read of reads) {
      const entry = this.indexes.get(encodeBytesToLowercaseHex(read.indexId));
      if (entry === undefined) continue;
      const found = overlap(entry.tree, read.intervals, -1n, lastPendingWriter);
      if (found !== undefined) return { indexId: entry.id.slice(), key: found[0].slice(), timestamp: found[1] };
    }
    return undefined;
  }

  /** Exact indexed references into accepted writes; payload authority remains with their write batch. */
  range(indexId: Uint8Array, interval: CoreInterval, maxResults: number): readonly CoreConflict[] {
    const entry = this.indexes.get(encodeBytesToLowercaseHex(indexId));
    if (entry === undefined) return [];
    const found: CoreConflict[] = [];
    for (const [key, writers] of entry.tree.entries(interval.start ?? undefined)) {
      if (interval.end !== null && compareBytesLexicographically(key, interval.end) >= 0) break;
      if (keyInInterval(key, interval)) found.push({ indexId: entry.id.slice(), key: key.slice(), timestamp: lastPendingWriter(writers) });
      if (found.length >= maxResults) break;
    }
    return found;
  }

  pop(timestamp: CoreTimestamp): void {
    if (this.commits.minKey() !== timestamp) throw new Error("Pending removal must follow publication order");
    const changes = this.commits.get(timestamp);
    this.commits.delete(timestamp);
    for (const change of changes ?? []) {
      const name = indexName(change.indexId);
      const entry = this.indexes.get(name);
      if (entry === undefined) throw new Error("Pending index keys missing during removal");
      for (const key of change.keys) {
        const writers = entry.tree.get(key);
        if (writers?.[0] !== timestamp) throw new Error("Pending key belongs to another commit");
        if (writers.length === 1) entry.tree.delete(key);
        else entry.tree.set(key, writers.slice(1));
      }
      if (entry.tree.size === 0) this.indexes.delete(name);
    }
  }
}

function lastPendingWriter(writers: readonly CoreTimestamp[]): CoreTimestamp {
  const timestamp = writers[writers.length - 1];
  if (timestamp === undefined) throw new Error("Pending key has no writer");
  return timestamp;
}
