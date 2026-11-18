import { compareUtf16Strings } from "@flarex/utils/strings";
import { Option, Result } from "effect";
import type { AppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  OrderedIndexBoundHexV1,
  OrderedIndexKeyBytesHexV1,
  OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import type {
  CommitSeq,
  ScopeEpoch,
  ScopeId,
  StorageGeneration,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { AppRowReadResultV1, AppRowRevisionV1, LiveAppRowRevisionV1 } from "../storage/documents/appRows";
import { lowerAppOrderedIndexPhysicalKeyV1 } from "../storage/indexes/appDeveloperIndexKeys";
import type { LocatedAppIndexDefinitionV1 } from "../storage/indexes/locatedAppIndexDefinition";
import {
  createSnapshotIndexCache,
  type SnapshotIndexCache,
  type SnapshotIndexCacheLimits,
  type SnapshotIndexCacheWrite,
  type SnapshotIndexInterval,
} from "../storage/indexes/snapshotIndexCache";
import type { ApplicationQueryBudget } from "./applicationQuerySnapshot";

export type QueryCacheKey =
  | Readonly<{ kind: "row"; rowId: AppDocumentIdentityV1["rowId"] }>
  | Readonly<{ kind: "prefix"; encodedKey: OrderedIndexBoundHexV1 }>
  | Readonly<{ kind: "index"; encodedKey: OrderedIndexKeyBytesHexV1; rowId: OrderedIndexRowIdHexV1 }>;

/** An owned immutable handle. Only consumed results detach the actual body. */
export class CachedQueryRow {
  readonly #row: LiveAppRowRevisionV1;
  constructor(row: LiveAppRowRevisionV1) {
    this.#row = structuredClone(row);
    Object.freeze(this);
  }
  copy(): LiveAppRowRevisionV1 { return structuredClone(this.#row); }
}

/** Data-only lowering metadata: this snapshot does not issue located authority. */
export type QueryCacheDefinition = Readonly<Pick<LocatedAppIndexDefinitionV1,
  "indexDefinitionId" | "access" | "physicalSpec" | "physicalSpecCodecVersion" |
  "physicalSpecBytesHex" | "physicalSpecSha256Hex"
>>;

export interface ApplicationQueryDataCache {
  readonly cache: SnapshotIndexCache<string, QueryCacheKey, CachedQueryRow>;
  readonly cacheDefinitions: ReadonlyMap<CatalogTableId, readonly QueryCacheDefinition[]>;
  readonly tableIds: readonly CatalogTableId[];
  readonly limits: SnapshotIndexCacheLimits;
}

/** Trusted source identity, never a grant or a live eligibility verdict. */
export interface ApplicationQueryCacheStamp {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly commitSeq: CommitSeq;
}

export interface ApplicationQueryCacheCandidate {
  readonly stamp: ApplicationQueryCacheStamp;
  readonly data: ApplicationQueryDataCache;
}

export interface ApplicationQueryCacheRequest {
  readonly stamp: ApplicationQueryCacheStamp;
  readonly budget: ApplicationQueryBudget;
  readonly definitions: readonly LocatedAppIndexDefinitionV1[];
  readonly tableIds: readonly CatalogTableId[];
}

export interface ApplicationQueryCacheHandoff {
  /** Call only inside successful admission; returned data is exclusively owned. */
  readonly take: (request: ApplicationQueryCacheRequest) => Option.Option<ApplicationQueryCacheCandidate>;
  /** Consumes data only after sealed, drained, entirely successful completion. */
  readonly put: (candidate: ApplicationQueryCacheCandidate) => void;
  readonly dispose: () => void;
}

export function compareQueryCacheKeys(left: QueryCacheKey, right: QueryCacheKey): number {
  if (left.kind === "row") return right.kind === "row" ? compareUtf16Strings(left.rowId, right.rowId) : -1;
  if (right.kind === "row") return 1;
  const keyOrder = compareUtf16Strings(left.encodedKey, right.encodedKey);
  if (keyOrder !== 0) return keyOrder;
  if (left.kind === "prefix") return right.kind === "prefix" ? 0 : -1;
  return right.kind === "prefix" ? 1 : compareUtf16Strings(left.rowId, right.rowId);
}

export function queryCacheLimits(budget: ApplicationQueryBudget): SnapshotIndexCacheLimits {
  const metadataLimit = budget.maximumDocuments + budget.maximumPointReads + budget.maximumIndexReads;
  return Object.freeze({ bodyBytes: budget.maximumSemanticBytes, indexEntries: metadataLimit, intervals: metadataLimit });
}

export function createQuerySnapshotCache(budget: ApplicationQueryBudget) {
  return createSnapshotIndexCache<string, QueryCacheKey, CachedQueryRow>({
    compareKeys: compareQueryCacheKeys,
    captureKey: key => Object.freeze({ ...key }),
    captureValue: value => value,
    limits: queryCacheLimits(budget),
  });
}

export function groupQueryCacheDefinitions(definitions: readonly LocatedAppIndexDefinitionV1[]):
ReadonlyMap<CatalogTableId, readonly QueryCacheDefinition[]> {
  const grouped = new Map<CatalogTableId, QueryCacheDefinition[]>();
  for (const definition of definitions) {
    if (definition.access.kind !== "developer") continue;
    // Physical specs are detached/deep-frozen by their authoritative protocol
    // decoder. Capture the remaining envelope without copying its located brand.
    const captured: QueryCacheDefinition = Object.freeze({
      indexDefinitionId: definition.indexDefinitionId,
      access: Object.freeze({ ...definition.access }),
      physicalSpec: definition.physicalSpec,
      physicalSpecCodecVersion: definition.physicalSpecCodecVersion,
      physicalSpecBytesHex: definition.physicalSpecBytesHex,
      physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
    });
    const existing = grouped.get(definition.access.tableId);
    if (existing === undefined) grouped.set(definition.access.tableId, [captured]);
    else existing.push(captured);
  }
  return new Map(Array.from(grouped, ([tableId, indexes]) => [tableId, Object.freeze(indexes)]));
}

export function createApplicationQueryDataCache(
  budget: ApplicationQueryBudget,
  definitions: readonly LocatedAppIndexDefinitionV1[],
  tableIds: readonly CatalogTableId[],
): ApplicationQueryDataCache {
  return Object.freeze({
    cache: createQuerySnapshotCache(budget),
    cacheDefinitions: groupQueryCacheDefinitions(definitions),
    tableIds: Object.freeze([...tableIds]),
    limits: queryCacheLimits(budget),
  });
}

export function cachePointInterval(key: QueryCacheKey): SnapshotIndexInterval<QueryCacheKey> {
  return { start: { kind: "before", key }, end: { kind: "after", key } };
}

export function cacheRowIdentity(tableId: CatalogTableId, rowId: AppDocumentIdentityV1["rowId"]): string {
  return `${tableId}/${rowId}`;
}

export function populateQueryRow(data: ApplicationQueryDataCache, row: LiveAppRowRevisionV1): void {
  const value = new CachedQueryRow(row);
  const documentId = cacheRowIdentity(row.tableId, row.rowId);
  const point: QueryCacheKey = { kind: "row", rowId: row.rowId };
  const entry = { key: point, documentId, value, bodyBytes: row.document.semanticSizeBytes };
  if (!data.cache.populate(`row/${row.tableId}`, [entry], cachePointInterval(point))) return;
  for (const definition of data.cacheDefinitions.get(row.tableId) ?? []) {
    // Optional derived observations never make an invalid actual index read
    // succeed: its owner still checks definition, storage and key integrity.
    Result.match(lowerAppOrderedIndexPhysicalKeyV1(definition.physicalSpec, row.document, row.creationTime), {
      onFailure: () => undefined,
      onSuccess: encodedKey => {
        if (encodedKey === null) return;
        const key: QueryCacheKey = { kind: "index", encodedKey, rowId: row.rowId };
        data.cache.populate(`index/${definition.indexDefinitionId}`, [{ ...entry, key }], cachePointInterval(key));
      },
    });
  }
}

/** Apply one authenticated row transition while no operation shares this cache. */
export function applyQueryCacheRowWrite(
  data: ApplicationQueryDataCache,
  previous: AppRowReadResultV1,
  next: AppRowRevisionV1,
): boolean {
  if (previous.kind !== "missing" && (previous.tableId !== next.tableId || previous.rowId !== next.rowId ||
    previous.scopeId !== next.scopeId)) throw new Error("Cache refresh changed row identity.");
  const point: QueryCacheKey = { kind: "row", rowId: next.rowId };
  const indexes: SnapshotIndexCacheWrite<string, QueryCacheKey, CachedQueryRow>["indexes"][number][] = [{
    indexId: `row/${next.tableId}`,
    oldKey: previous.kind === "live" ? point : null,
    newKey: next.kind === "live" ? point : null,
  }];
  for (const definition of data.cacheDefinitions.get(next.tableId) ?? []) {
    const indexId = `index/${definition.indexDefinitionId}`;
    const lowered = Result.gen(function* () {
      const oldKey = previous.kind === "live"
        ? yield* lowerAppOrderedIndexPhysicalKeyV1(definition.physicalSpec, previous.document, previous.creationTime)
        : null;
      const newKey = next.kind === "live"
        ? yield* lowerAppOrderedIndexPhysicalKeyV1(definition.physicalSpec, next.document, next.creationTime)
        : null;
      return { oldKey, newKey };
    });
    Result.match(lowered, {
      // A failed optional derivation proves no reusable coverage for this index.
      // Prune it rather than hiding a typed error from an actual index/SQL read.
      onFailure: () => data.cache.removeIndex(indexId),
      onSuccess: ({ oldKey, newKey }) => indexes.push({
        indexId,
        oldKey: oldKey === null ? null : { kind: "index", encodedKey: oldKey, rowId: next.rowId },
        newKey: newKey === null ? null : { kind: "index", encodedKey: newKey, rowId: next.rowId },
      }),
    });
  }
  return data.cache.applyWrite({
    documentId: cacheRowIdentity(next.tableId, next.rowId),
    newDocument: next.kind === "live"
      ? { value: new CachedQueryRow(next), bodyBytes: next.document.semanticSizeBytes }
      : null,
    indexes,
  });
}

/** One data slot, with synchronous ownership transfer; the host owns its scope. */
export function createApplicationQueryCacheHandoff(): ApplicationQueryCacheHandoff {
  let identity: ApplicationQueryCacheStamp | undefined;
  let highestReturned: CommitSeq | undefined;
  let idle: ApplicationQueryCacheCandidate | undefined;
  let disposed = false;
  return Object.freeze({
    take(request: ApplicationQueryCacheRequest): Option.Option<ApplicationQueryCacheCandidate> {
      if (disposed) return Option.none();
      const requested = Object.freeze({ ...request.stamp });
      if (identity === undefined || !sameIdentity(identity, requested)) {
        identity = requested;
        highestReturned = undefined;
        idle = undefined;
        return Option.none();
      }
      const candidate = idle;
      if (candidate === undefined || candidate.stamp.commitSeq > requested.commitSeq) return Option.none();
      idle = undefined;
      if (!sameLimits(candidate.data.limits, queryCacheLimits(request.budget))) return Option.none();
      return Option.some(Object.freeze({
        stamp: candidate.stamp,
        data: rebindQueryCacheDefinitions(candidate.data, request.definitions, request.tableIds),
      }));
    },
    put(candidate: ApplicationQueryCacheCandidate): void {
      if (disposed || identity === undefined || !sameIdentity(identity, candidate.stamp) ||
        highestReturned !== undefined && candidate.stamp.commitSeq < highestReturned) return;
      highestReturned = candidate.stamp.commitSeq;
      idle = Object.freeze({ stamp: Object.freeze({ ...candidate.stamp }), data: candidate.data });
    },
    dispose(): void {
      disposed = true;
      idle = undefined;
      identity = undefined;
      highestReturned = undefined;
    },
  });
}

function sameIdentity(left: ApplicationQueryCacheStamp, right: ApplicationQueryCacheStamp): boolean {
  return left.deploymentId === right.deploymentId && left.scopeId === right.scopeId &&
    left.storageGeneration === right.storageGeneration && left.storageGenerationFence === right.storageGenerationFence &&
    left.epoch === right.epoch;
}

function sameLimits(left: SnapshotIndexCacheLimits, right: SnapshotIndexCacheLimits): boolean {
  return left.bodyBytes === right.bodyBytes && left.indexEntries === right.indexEntries && left.intervals === right.intervals;
}

function sameDefinition(left: QueryCacheDefinition, right: QueryCacheDefinition): boolean {
  return left.indexDefinitionId === right.indexDefinitionId &&
    left.access.kind === "developer" && right.access.kind === "developer" &&
    left.access.tableId === right.access.tableId && left.access.logicalIndexId === right.access.logicalIndexId &&
    left.physicalSpecCodecVersion === right.physicalSpecCodecVersion &&
    left.physicalSpecBytesHex === right.physicalSpecBytesHex && left.physicalSpecSha256Hex === right.physicalSpecSha256Hex;
}

function rebindQueryCacheDefinitions(
  data: ApplicationQueryDataCache,
  definitions: readonly LocatedAppIndexDefinitionV1[],
  tableIds: readonly CatalogTableId[],
): ApplicationQueryDataCache {
  const current = groupQueryCacheDefinitions(definitions);
  const tables = new Set(tableIds);
  for (const tableId of data.tableIds) {
    if (!tables.has(tableId)) data.cache.removeIndex(`row/${tableId}`);
  }
  for (const [tableId, oldDefinitions] of data.cacheDefinitions) {
    const nextDefinitions = tables.has(tableId) ? current.get(tableId) ?? [] : [];
    for (const old of oldDefinitions) {
      if (!nextDefinitions.some(next => sameDefinition(old, next))) data.cache.removeIndex(`index/${old.indexDefinitionId}`);
    }
  }
  return Object.freeze({
    cache: data.cache,
    cacheDefinitions: current,
    tableIds: Object.freeze([...tableIds]),
    limits: data.limits,
  });
}
