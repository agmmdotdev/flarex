import { BTreeEx as BTree } from "sorted-btree/extended/index.js";

/** Cuts surround an exact ordered key; before(k)..after(k) is the singleton k. */
export type SnapshotIndexCut<Key> =
  | Readonly<{ kind: "beforeAll" }>
  | Readonly<{ kind: "before"; key: Key }>
  | Readonly<{ kind: "after"; key: Key }>
  | Readonly<{ kind: "afterAll" }>;

export interface SnapshotIndexInterval<Key> {
  readonly start: SnapshotIndexCut<Key>;
  readonly end: SnapshotIndexCut<Key>;
}

export interface SnapshotIndexCacheEntry<Key, Value> {
  readonly key: Key;
  /** Stable identity of one validated body/evidence at this cache's snapshot. */
  readonly documentId: string;
  readonly value: Value;
  readonly bodyBytes: number;
}

export interface SnapshotIndexCacheWrite<IndexId, Key, Value> {
  readonly documentId: string;
  readonly newDocument: Readonly<{ value: Value; bodyBytes: number }> | null;
  /** Complete old/new deltas for every relevant tracked index, once per index. */
  readonly indexes: readonly Readonly<{
    indexId: IndexId;
    oldKey: Key | null;
    newKey: Key | null;
  }>[];
}

export type SnapshotIndexCacheComponent<Key, Value> =
  | Readonly<{ kind: "document"; key: Key; documentId: string; value: Value }>
  | Readonly<{ kind: "miss"; interval: SnapshotIndexInterval<Key> }>;

export interface SnapshotIndexCacheLimits {
  readonly bodyBytes: number;
  readonly indexEntries: number;
  readonly intervals: number;
}

export interface SnapshotIndexCacheStats {
  readonly bodyBytes: number;
  readonly bodies: number;
  readonly indexEntries: number;
  readonly intervals: number;
}

export interface SnapshotIndexCache<IndexId, Key, Value> {
  /**
   * Caller proves completedInterval against its immutable snapshot and supplies
   * every body needed for that coverage. A page's interval ends at its actual
   * consumed position. False retains safe points but never adds full coverage.
   */
  readonly populate: (
    indexId: IndexId,
    entries: readonly SnapshotIndexCacheEntry<Key, Value>[],
    completedInterval: SnapshotIndexInterval<Key>,
  ) => boolean;
  /** Materialized, captured output; no ordered iterator escapes the call. */
  readonly get: (
    indexId: IndexId,
    interval: SnapshotIndexInterval<Key>,
    order: "asc" | "desc",
  ) => readonly SnapshotIndexCacheComponent<Key, Value>[];
  /**
   * Apply one complete row write during exclusive checkout; active operations
   * must not share this instance. Preserves coverage, removes old keys and
   * replaces shared bodies even when the new keys are unchanged. False clears
   * the entire cache on capacity refusal; stop refreshing. Trusted-input defects
   * throw and require the caller to discard this checkout.
   */
  readonly applyWrite: (write: SnapshotIndexCacheWrite<IndexId, Key, Value>) => boolean;
  readonly removeIndex: (indexId: IndexId) => void;
  readonly stats: () => SnapshotIndexCacheStats;
}

export interface SnapshotIndexCacheConfiguration<Key, Value> {
  /** Trusted total order, including the document-ID tie-breaker where required. */
  readonly compareKeys: (left: Key, right: Key) => number;
  /** Capture detached keys/values, or return an already immutable owned value. */
  readonly captureKey: (key: Key) => Key;
  readonly captureValue: (value: Value) => Value;
  /** Trusted operation budgets; no cache-global defaults or authority implied. */
  readonly limits: SnapshotIndexCacheLimits;
}

const MAX_CACHED_RANGES_PER_INTERVAL = 3;

/**
 * Private exclusively owned storage translated from the pinned Convex
 * DatabaseIndexSnapshotCache and IntervalSet mechanisms. It performs no reads,
 * validation, authority checks, logical accounting or snapshot advancement.
 */
export function createSnapshotIndexCache<IndexId extends string | number, Key, Value>(
  configuration: SnapshotIndexCacheConfiguration<Key, Value>,
): SnapshotIndexCache<IndexId, Key, Value> {
  return new SnapshotIndexCacheStorage<IndexId, Key, Value>(configuration);
}

interface CachedBody<Value> {
  readonly value: Value;
  readonly bytes: number;
  references: number;
}

interface IndexDocuments<Key> {
  readonly documents: BTree<Key, string>;
  readonly intervals: BTree<SnapshotIndexCut<Key>, SnapshotIndexCut<Key>>;
}

interface CoverageAddition<Key> {
  readonly interval: SnapshotIndexInterval<Key>;
  readonly removed: readonly SnapshotIndexCut<Key>[];
}

class SnapshotIndexCacheStorage<IndexId extends string | number, Key, Value>
implements SnapshotIndexCache<IndexId, Key, Value> {
  readonly #indexes = new Map<IndexId, IndexDocuments<Key>>();
  readonly #bodies = new Map<string, CachedBody<Value>>();
  readonly #configuration: SnapshotIndexCacheConfiguration<Key, Value>;
  #bodyBytes = 0;
  #indexEntries = 0;
  #intervals = 0;

  constructor(configuration: SnapshotIndexCacheConfiguration<Key, Value>) {
    this.#configuration = Object.freeze({ ...configuration, limits: Object.freeze({ ...configuration.limits }) });
  }

  readonly populate = (
    indexId: IndexId,
    entries: readonly SnapshotIndexCacheEntry<Key, Value>[],
    completedInterval: SnapshotIndexInterval<Key>,
  ): boolean => {
    for (const entry of entries) {
      if (!this.#populateDocument(indexId, entry)) return false;
    }
    const interval = this.#captureInterval(completedInterval);
    if (this.#compareCuts(interval.start, interval.end) >= 0) return true;
    const documents = this.#indexes.get(indexId);
    const addition = this.#prepareCoverage(documents, interval);
    if (!this.#canAddCoverage(addition)) return false;
    this.#addCoverage(this.#index(indexId), addition);
    return true;
  };

  readonly get = (
    indexId: IndexId,
    interval: SnapshotIndexInterval<Key>,
    order: "asc" | "desc",
  ): readonly SnapshotIndexCacheComponent<Key, Value>[] => {
    if (this.#compareCuts(interval.start, interval.end) >= 0) return Object.freeze([]);
    const documents = this.#indexes.get(indexId);
    if (documents === undefined) {
      return Object.freeze([Object.freeze({ kind: "miss" as const, interval: this.#captureInterval(interval) })]);
    }
    const results: SnapshotIndexCacheComponent<Key, Value>[] = [];
    let cachedRanges = 0;
    for (const component of this.#components(documents, interval)) {
      // Match the pinned implementation: pick the first three ascending covered
      // ranges, then reverse the fully materialized result for descending order.
      if (cachedRanges >= MAX_CACHED_RANGES_PER_INTERVAL) {
        results.push(Object.freeze({ kind: "miss", interval: this.#captureInterval({
          start: component.interval.start, end: interval.end,
        }) }));
        break;
      }
      if (!component.covered) {
        results.push(Object.freeze({ kind: "miss", interval: this.#captureInterval(component.interval) }));
        continue;
      }
      cachedRanges++;
      this.#appendDocuments(results, documents, component.interval);
    }
    if (order === "desc") results.reverse();
    return Object.freeze(results);
  };

  readonly stats = (): SnapshotIndexCacheStats => Object.freeze({
    bodyBytes: this.#bodyBytes,
    bodies: this.#bodies.size,
    indexEntries: this.#indexEntries,
    intervals: this.#intervals,
  });

  readonly applyWrite = (write: SnapshotIndexCacheWrite<IndexId, Key, Value>): boolean => {
    const seen = new Set<IndexId>();
    const updates = write.indexes.map(update => {
      if (seen.has(update.indexId)) throw new Error("Snapshot cache write repeats an index.");
      seen.add(update.indexId);
      if (write.newDocument === null && update.newKey !== null)
        throw new Error("Snapshot cache deletion has a new key.");
      return { indexId: update.indexId,
        oldKey: update.oldKey === null ? null : this.#configuration.captureKey(update.oldKey),
        newKey: update.newKey === null ? null : this.#configuration.captureKey(update.newKey) };
    });
    // Like the pinned apply_write, remove old positions even for equal keys.
    // Grouping the row's indexes releases and replaces its shared body once.
    for (const update of updates) {
      const index = this.#indexes.get(update.indexId);
      if (index !== undefined && update.oldKey !== null)
        this.#removeDocument(index, update.oldKey, write.documentId);
    }
    const previousBody = this.#bodies.get(write.documentId);
    if (write.newDocument === null) {
      if (previousBody !== undefined) throw new Error("Snapshot cache deletion retains an index reference.");
      return true;
    }
    const additions: Readonly<{ index: IndexDocuments<Key>; key: Key; existing: boolean }>[] = [];
    for (const update of updates) {
      const index = this.#indexes.get(update.indexId);
      if (index === undefined || update.newKey === null || !this.#coversKey(index, update.newKey)) continue;
      const identity = index.documents.get(update.newKey);
      if (identity !== undefined && identity !== write.documentId) throw new Error("Snapshot cache key identity changed.");
      additions.push({ index, key: update.newKey, existing: identity !== undefined });
    }
    if (previousBody === undefined && additions.length === 0) return true;
    const bodyBytes = this.#bodyBytes - (previousBody?.bytes ?? 0) + write.newDocument.bodyBytes;
    const indexEntries = this.#indexEntries + additions.filter(addition => !addition.existing).length;
    if (bodyBytes > this.#configuration.limits.bodyBytes || indexEntries > this.#configuration.limits.indexEntries) {
      this.#clear();
      return false;
    }
    const body: CachedBody<Value> = { value: this.#configuration.captureValue(write.newDocument.value),
      bytes: write.newDocument.bodyBytes, references: previousBody?.references ?? 0 };
    this.#bodies.set(write.documentId, body);
    this.#bodyBytes = bodyBytes;
    for (const addition of additions) {
      if (addition.existing) continue;
      addition.index.documents.set(addition.key, write.documentId);
      body.references++;
    }
    this.#indexEntries = indexEntries;
    return true;
  };

  readonly removeIndex = (indexId: IndexId): void => {
    const index = this.#indexes.get(indexId);
    if (index === undefined) return;
    this.#indexes.delete(indexId);
    for (const documentId of index.documents.values()) this.#releaseBody(documentId);
    this.#indexEntries -= index.documents.size;
    this.#intervals -= index.intervals.size;
  };

  #populateDocument(indexId: IndexId, entry: SnapshotIndexCacheEntry<Key, Value>): boolean {
    const documents = this.#indexes.get(indexId);
    const previousIdentity = documents?.documents.get(entry.key);
    if (previousIdentity !== undefined) {
      // Population is within one immutable snapshot. Timestamp advancement
      // uses applyWrite; callers validate body/revision evidence.
      if (previousIdentity !== entry.documentId) throw new Error("Snapshot cache key identity changed.");
      return true;
    }
    const body = this.#bodies.get(entry.documentId);
    if (body !== undefined && body.bytes !== entry.bodyBytes) throw new Error("Snapshot cache body size changed.");
    const addedBytes = body === undefined ? entry.bodyBytes : 0;
    if (this.#indexEntries >= this.#configuration.limits.indexEntries ||
        addedBytes > this.#configuration.limits.bodyBytes - this.#bodyBytes) return false;
    const key = this.#configuration.captureKey(entry.key);
    const point: SnapshotIndexInterval<Key> = {
      start: Object.freeze({ kind: "before", key }),
      end: Object.freeze({ kind: "after", key }),
    };
    const addition = this.#prepareCoverage(documents, point);
    if (!this.#canAddCoverage(addition)) return false;
    const capturedBody = body ?? { value: this.#configuration.captureValue(entry.value), bytes: entry.bodyBytes, references: 0 };
    const index = this.#index(indexId);
    if (body === undefined) {
      this.#bodies.set(entry.documentId, capturedBody);
      this.#bodyBytes += addedBytes;
    }
    index.documents.set(key, entry.documentId);
    capturedBody.references++;
    this.#indexEntries++;
    this.#addCoverage(index, addition);
    return true;
  }

  #coversKey(index: IndexDocuments<Key>, key: Key): boolean {
    const cut: SnapshotIndexCut<Key> = { kind: "before", key };
    const preceding = index.intervals.getPairOrNextLower(cut);
    return preceding !== undefined && this.#compareCuts(cut, preceding[1]) < 0;
  }

  #removeDocument(index: IndexDocuments<Key>, key: Key, documentId: string): void {
    const identity = index.documents.get(key);
    if (identity === undefined) return;
    if (identity !== documentId) throw new Error("Snapshot cache old key identity changed.");
    index.documents.delete(key);
    this.#indexEntries--;
    this.#releaseBody(documentId);
  }

  #releaseBody(documentId: string): void {
    const body = this.#bodies.get(documentId);
    if (body === undefined || body.references <= 0) throw new Error("Snapshot cache body reference missing.");
    body.references--;
    if (body.references > 0) return;
    this.#bodies.delete(documentId);
    this.#bodyBytes -= body.bytes;
  }

  #clear(): void {
    this.#indexes.clear();
    this.#bodies.clear();
    this.#bodyBytes = 0;
    this.#indexEntries = 0;
    this.#intervals = 0;
  }

  #index(indexId: IndexId): IndexDocuments<Key> {
    const existing = this.#indexes.get(indexId);
    if (existing !== undefined) return existing;
    const created = {
      documents: new BTree<Key, string>(undefined, this.#configuration.compareKeys),
      intervals: new BTree<SnapshotIndexCut<Key>, SnapshotIndexCut<Key>>(undefined, this.#compareCuts),
    };
    this.#indexes.set(indexId, created);
    return created;
  }

  #prepareCoverage(documents: IndexDocuments<Key> | undefined, interval: SnapshotIndexInterval<Key>): CoverageAddition<Key> {
    let start = interval.start;
    let end = interval.end;
    const removed: SnapshotIndexCut<Key>[] = [];
    if (documents !== undefined) {
      const preceding = documents.intervals.nextLowerPair(start);
      if (preceding !== undefined && this.#compareCuts(preceding[1], start) >= 0) {
        start = preceding[0];
        if (this.#compareCuts(preceding[1], end) > 0) end = preceding[1];
        removed.push(preceding[0]);
      }
      for (const [otherStart, otherEnd] of documents.intervals.entries(interval.start)) {
        if (this.#compareCuts(otherStart, end) > 0) break;
        if (this.#compareCuts(otherEnd, end) > 0) end = otherEnd;
        removed.push(otherStart);
      }
    }
    return { interval: { start, end }, removed };
  }

  #canAddCoverage(addition: CoverageAddition<Key>): boolean {
    return this.#intervals - addition.removed.length + 1 <= this.#configuration.limits.intervals;
  }

  #addCoverage(documents: IndexDocuments<Key>, addition: CoverageAddition<Key>): void {
    // Documents have already populated. No iterator is live during mutation.
    for (const start of addition.removed) documents.intervals.delete(start);
    documents.intervals.set(addition.interval.start, addition.interval.end);
    this.#intervals += 1 - addition.removed.length;
  }

  *#components(documents: IndexDocuments<Key>, target: SnapshotIndexInterval<Key>): Generator<
    Readonly<{ covered: boolean; interval: SnapshotIndexInterval<Key> }>
  > {
    let cursor = target.start;
    const preceding = documents.intervals.getPairOrNextLower(cursor);
    if (preceding !== undefined && this.#compareCuts(preceding[1], cursor) > 0) {
      const end = this.#compareCuts(preceding[1], target.end) < 0 ? preceding[1] : target.end;
      yield { covered: true, interval: { start: cursor, end } };
      cursor = end;
    }
    for (const [start, storedEnd] of documents.intervals.entries(cursor)) {
      if (this.#compareCuts(start, target.end) >= 0) break;
      if (this.#compareCuts(cursor, start) < 0) yield { covered: false, interval: { start: cursor, end: start } };
      const end = this.#compareCuts(storedEnd, target.end) < 0 ? storedEnd : target.end;
      yield { covered: true, interval: { start, end } };
      cursor = end;
    }
    if (this.#compareCuts(cursor, target.end) < 0) yield { covered: false, interval: { start: cursor, end: target.end } };
  }

  #appendDocuments(
    output: SnapshotIndexCacheComponent<Key, Value>[],
    documents: IndexDocuments<Key>,
    interval: SnapshotIndexInterval<Key>,
  ): void {
    const firstKey = interval.start.kind === "before" || interval.start.kind === "after" ? interval.start.key : undefined;
    for (const [key, documentId] of documents.documents.entries(firstKey)) {
      const position: SnapshotIndexCut<Key> = { kind: "before", key };
      if (this.#compareCuts(position, interval.start) < 0) continue;
      if (this.#compareCuts(position, interval.end) >= 0) break;
      const body = this.#bodies.get(documentId);
      if (body === undefined) throw new Error("Snapshot cache body missing.");
      output.push(Object.freeze({ kind: "document", key: this.#configuration.captureKey(key), documentId,
        value: this.#configuration.captureValue(body.value) }));
    }
  }

  #captureInterval(interval: SnapshotIndexInterval<Key>): SnapshotIndexInterval<Key> {
    return Object.freeze({ start: this.#captureCut(interval.start), end: this.#captureCut(interval.end) });
  }

  #captureCut(cut: SnapshotIndexCut<Key>): SnapshotIndexCut<Key> {
    switch (cut.kind) {
      case "beforeAll": case "afterAll": return Object.freeze({ kind: cut.kind });
      case "before": case "after": return Object.freeze({ kind: cut.kind, key: this.#configuration.captureKey(cut.key) });
    }
  }

  readonly #compareCuts = (left: SnapshotIndexCut<Key>, right: SnapshotIndexCut<Key>): number => {
    if (left.kind === "beforeAll") return right.kind === "beforeAll" ? 0 : -1;
    if (left.kind === "afterAll") return right.kind === "afterAll" ? 0 : 1;
    if (right.kind === "beforeAll") return 1;
    if (right.kind === "afterAll") return -1;
    const compared = this.#configuration.compareKeys(left.key, right.key);
    return compared !== 0 ? compared : left.kind === right.kind ? 0 : left.kind === "before" ? -1 : 1;
  };
}
