/**
 * Mechanisms translated from Convex crates/database/src/write_log.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import BTree from "sorted-btree";
import { Result } from "effect";
import { compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
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
  return Object.freeze({ start: interval.start?.slice() ?? null, end: interval.end?.slice() ?? null });
}

export function pointInterval(key: Uint8Array): CoreInterval {
  const end = new Uint8Array(key.length + 1);
  end.set(key);
  return Object.freeze({ start: key.slice(), end });
}

/** Ordered, normalized interval union. Empty intervals never become broad dependencies. */
export class CoreReadSetBuilder {
  private readonly byIndex = new Map<string, { id: Uint8Array; intervals: BTree<Uint8Array | null, CoreInterval> }>();
  private count = 0;

  get intervalCount(): number { return this.count; }

  add(indexId: Uint8Array, interval: CoreInterval): void {
    if (interval.start !== null && interval.end !== null
      && compareBytesLexicographically(interval.start, interval.end) >= 0) return;
    const name = encodeBytesToLowercaseHex(indexId);
    let entry = this.byIndex.get(name);
    if (entry === undefined) {
      entry = { id: indexId.slice(), intervals: new BTree<Uint8Array | null, CoreInterval>(undefined, compareStarts) };
      this.byIndex.set(name, entry);
    }
    const before = entry.intervals.size;
    let merged = copyInterval(interval);
    const equal = entry.intervals.get(merged.start);
    const previous = equal ?? entry.intervals.nextLowerPair(merged.start)?.[1];
    const removals: Array<Uint8Array | null> = [];
    if (previous !== undefined && (previous.end === null || merged.start === null
      || compareBytesLexicographically(previous.end, merged.start) >= 0)) {
      merged = { start: previous.start, end: maximumEnd(previous.end, merged.end) };
      removals.push(previous.start);
    }
    for (const [key, next] of entry.intervals.entries(merged.start)) {
      if (merged.end !== null && next.start !== null && compareBytesLexicographically(next.start, merged.end) > 0) break;
      merged = { start: merged.start, end: maximumEnd(merged.end, next.end) };
      removals.push(key);
    }
    for (const key of removals) entry.intervals.delete(key);
    entry.intervals.set(merged.start, merged);
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

function maximumEnd(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null || b === null ? null : compareBytesLexicographically(a, b) >= 0 ? a : b;
}

type Keys = BTree<Uint8Array, CoreTimestamp>;
interface IndexedKeys { readonly id: Uint8Array; readonly tree: Keys }

function overlap(tree: Keys, intervals: readonly CoreInterval[], after: CoreTimestamp): readonly [Uint8Array, CoreTimestamp] | undefined {
  // Both sides are sorted. Probe the smaller side, as PendingKeysInIndex does.
  if (tree.size <= intervals.length) {
    for (const [key, ts] of tree.entries()) {
      if (ts > after && containsInterval(intervals, key)) return [key, ts];
    }
    return undefined;
  }
  for (const interval of intervals) {
    for (const [key, ts] of tree.entries(interval.start ?? undefined)) {
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
  const indexes = new Map<string, { id: Uint8Array; keys: BTree<Uint8Array, true> }>();
  for (const write of writes) {
    const name = encodeBytesToLowercaseHex(write.index.id);
    let entry = indexes.get(name);
    if (entry === undefined) {
      entry = { id: write.index.id.slice(), keys: new BTree<Uint8Array, true>(undefined, compareBytesLexicographically) };
      indexes.set(name, entry);
    }
    entry.keys.set(write.key.slice(), true);
  }
  return Object.freeze([...indexes.values()].map(entry => Object.freeze({
    indexId: entry.id, keys: Object.freeze([...entry.keys.keys()]),
  })));
}

/** COW B+tree clones share immutable index batches without copying document bodies. */
export class CoreWriteLogSnapshot {
  constructor(
    readonly timestamp: CoreTimestamp,
    readonly minimumTimestamp: CoreTimestamp,
    private readonly indexes: ReadonlyMap<string, IndexedKeys>,
  ) {}

  conflict(reads: CoreReadSet, after: CoreTimestamp): Result.Result<CoreConflict | undefined, CorePersistenceError> {
    if (after < this.minimumTimestamp) return Result.fail(new CorePersistenceError({ reason: "outOfRetention" }));
    for (const read of reads) {
      const entry = this.indexes.get(encodeBytesToLowercaseHex(read.indexId));
      if (entry === undefined) continue;
      const found = overlap(entry.tree, read.intervals, after);
      if (found !== undefined) return Result.succeed({ indexId: entry.id.slice(), key: found[0].slice(), timestamp: found[1] });
    }
    return Result.succeed(undefined);
  }
}

export class CoreWriteLog {
  private readonly indexes = new Map<string, IndexedKeys>();
  private readonly batches = new BTree<CoreTimestamp, Readonly<{ changes: readonly CoreIndexKeys[]; bytes: number }>>();
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
    return new CoreWriteLogSnapshot(this.latest, this.minimum, new Map(
      [...this.indexes].map(([name, entry]) => [name, { id: entry.id, tree: entry.tree.clone() }]),
    ));
  }

  append(timestamp: CoreTimestamp, changes: readonly CoreIndexKeys[], retainedBytes?: number): void {
    if (timestamp <= this.latest) throw new Error("Write log publication must be increasing");
    for (const change of changes) {
      const name = encodeBytesToLowercaseHex(change.indexId);
      let entry = this.indexes.get(name);
      if (entry === undefined) {
        entry = { id: change.indexId.slice(), tree: new BTree<Uint8Array, CoreTimestamp>(undefined, compareBytesLexicographically) };
        this.indexes.set(name, entry);
      }
      for (const key of change.keys) entry.tree.set(key.slice(), timestamp);
    }
    const bytes = retainedBytes ?? changes.reduce((total, change) => total + change.indexId.length
      + change.keys.reduce((keyBytes, key) => keyBytes + key.length + 8, 0), 0);
    this.batches.set(timestamp, { changes, bytes });
    this.size += bytes;
    this.latest = timestamp;
    this.enforceRetention(timestamp);
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
      const expired = this.batches.get(oldest);
      this.batches.delete(oldest);
      this.minimum = oldest;
      this.size -= expired?.bytes ?? 0;
      for (const change of expired?.changes ?? []) {
        const name = encodeBytesToLowercaseHex(change.indexId);
        const entry = this.indexes.get(name);
        if (entry === undefined) continue;
        for (const key of change.keys) if (entry.tree.get(key) === oldest) entry.tree.delete(key);
        if (entry.tree.size === 0) this.indexes.delete(name);
      }
    }
  }
}

/** Accepted unpublished commits, indexed by full affected key with FIFO removal. */
export class CorePendingWrites {
  private readonly commits = new BTree<CoreTimestamp, readonly CoreIndexKeys[]>();
  private readonly indexes = new Map<string, IndexedKeys>();

  get size(): number { return this.commits.size; }

  push(timestamp: CoreTimestamp, changes: readonly CoreIndexKeys[]): void {
    const last = this.commits.maxKey();
    if (last !== undefined && last >= timestamp) throw new Error("Pending commits must be increasing");
    for (const change of changes) {
      const name = encodeBytesToLowercaseHex(change.indexId);
      let entry = this.indexes.get(name);
      if (entry === undefined) {
        entry = { id: change.indexId.slice(), tree: new BTree<Uint8Array, CoreTimestamp>(undefined, compareBytesLexicographically) };
        this.indexes.set(name, entry);
      }
      for (const key of change.keys) {
        if (entry.tree.has(key)) throw new Error("Conflicting accepted writes reached pending-key insertion");
        entry.tree.set(key.slice(), timestamp);
      }
    }
    this.commits.set(timestamp, changes);
  }

  conflict(reads: CoreReadSet): CoreConflict | undefined {
    for (const read of reads) {
      const entry = this.indexes.get(encodeBytesToLowercaseHex(read.indexId));
      if (entry === undefined) continue;
      const found = overlap(entry.tree, read.intervals, -1n);
      if (found !== undefined) return { indexId: entry.id.slice(), key: found[0].slice(), timestamp: found[1] };
    }
    return undefined;
  }

  /** Exact indexed references into accepted writes; payload authority remains with their write batch. */
  range(indexId: Uint8Array, interval: CoreInterval, maxResults: number): readonly CoreConflict[] {
    const entry = this.indexes.get(encodeBytesToLowercaseHex(indexId));
    if (entry === undefined) return [];
    const found: CoreConflict[] = [];
    for (const [key, timestamp] of entry.tree.entries(interval.start ?? undefined)) {
      if (interval.end !== null && compareBytesLexicographically(key, interval.end) >= 0) break;
      if (keyInInterval(key, interval)) found.push({ indexId: entry.id.slice(), key: key.slice(), timestamp });
      if (found.length >= maxResults) break;
    }
    return found;
  }

  pop(timestamp: CoreTimestamp): void {
    if (this.commits.minKey() !== timestamp) throw new Error("Pending removal must follow publication order");
    const changes = this.commits.get(timestamp);
    this.commits.delete(timestamp);
    for (const change of changes ?? []) {
      const name = encodeBytesToLowercaseHex(change.indexId);
      const entry = this.indexes.get(name);
      if (entry === undefined) throw new Error("Pending index keys missing during removal");
      for (const key of change.keys) {
        if (entry.tree.get(key) !== timestamp) throw new Error("Pending key belongs to another commit");
        entry.tree.delete(key);
      }
      if (entry.tree.size === 0) this.indexes.delete(name);
    }
  }
}
