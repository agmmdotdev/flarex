import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogIndexDefinitionId, decodeCatalogIndexId, decodeCatalogTableId } from "flarex-protocol/catalog";
import { canonicalizeAppIndexPhysicalSpecV1 } from "flarex-protocol/index-definition";
import { lowerAppDeveloperOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { CatalogSchemaVersionIdSchema, decodeSchemaManifestAppDeveloperOrderedIndexSpecV1 } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema, ScopeEpochSchema, ScopeEpochUuidV1Schema, ScopeIdSchema, ScopeUuidV1Schema,
  StorageGenerationFenceSchema, StorageGenerationSchema,
} from "flarex-protocol/storage-authority";
import {
  applyQueryCacheRowWrite,
  cachePointInterval,
  createApplicationQueryCacheHandoff,
  createApplicationQueryDataCache,
  type ApplicationQueryCacheCandidate,
  type ApplicationQueryCacheRequest,
  type ApplicationQueryCacheStamp,
  type ApplicationQueryDataCache,
  type QueryCacheKey,
  populateQueryRow,
} from "../../../src/application/applicationQueryDataCache";
import type { ApplicationQueryBudget } from "../../../src/application/applicationQuerySnapshot";
import type { LiveAppRowRevisionV1, TombstoneAppRowRevisionV1 } from "../../../src/storage/documents/appRows";
import { lowerAppOrderedIndexPhysicalKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";
import { markLocatedAppIndexDefinition, type LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/locatedAppIndexDefinition";
import type { SnapshotIndexInterval } from "../../../src/storage/indexes/snapshotIndexCache";

const scopeUuid = "d2310000-0000-0000-0000-000000000001";
const epochUuid = "d2310000-0000-0000-0000-000000000002";
const scopeId = ScopeIdSchema.make(`scope_${scopeUuid}`);
const epoch = ScopeEpochSchema.make(`epoch_${epochUuid}`);
const tableId = decodeCatalogTableId(1);
const secondTable = decodeCatalogTableId(2);
const decodeStorageGeneration = Schema.decodeUnknownSync(StorageGenerationSchema);
const budget: ApplicationQueryBudget = {
  maximumPointReads: 20, maximumIndexReads: 20, maximumDocuments: 100, maximumSemanticBytes: 100_000,
};
const all: SnapshotIndexInterval<QueryCacheKey> = { start: { kind: "beforeAll" }, end: { kind: "afterAll" } };

function stamp(commitSeq: number, changes: Partial<ApplicationQueryCacheStamp> = {}): ApplicationQueryCacheStamp {
  return {
    deploymentId: "deployment_data_cache", scopeId, epoch,
    storageGeneration: decodeStorageGeneration("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    commitSeq: CommitSeqSchema.make(BigInt(commitSeq)), ...changes,
  };
}

function request(commitSeq: number, changes: Partial<ApplicationQueryCacheRequest> = {}): ApplicationQueryCacheRequest {
  return { stamp: stamp(commitSeq), budget, definitions: [], tableIds: [tableId], ...changes };
}

function data(input: ApplicationQueryCacheRequest): ApplicationQueryDataCache {
  return createApplicationQueryDataCache(input.budget, input.definitions, input.tableIds);
}

function candidate(input: ApplicationQueryCacheRequest, cached = data(input)): ApplicationQueryCacheCandidate {
  return { stamp: input.stamp, data: cached };
}

async function definition(id: number, field: string): Promise<LocatedAppIndexDefinitionV1> {
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(lowerAppDeveloperOrderedIndexPhysicalSpecV1(
    decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({ kind: "developerOrdered", specVersion: 1, fields: [field] }),
  ));
  return markLocatedAppIndexDefinition(scopeId, {
    deploymentId: "deployment_data_cache", indexDefinitionId: decodeCatalogIndexDefinitionId(id),
    access: { kind: "developer", tableId, logicalIndexId: decodeCatalogIndexId(id) },
    physicalSpec: canonical.physicalSpec, physicalSpecCodecVersion: canonical.codecVersion,
    physicalSpecBytesHex: canonical.canonicalBytesHex, physicalSpecSha256Hex: canonical.sha256Hex,
    createdAt: new Date(0),
  });
}

async function row(name = "Ada", commit = 1, detail = "initial", rowTable = tableId): Promise<LiveAppRowRevisionV1> {
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  return {
    kind: "live", scopeId, scopeUuid: ScopeUuidV1Schema.make(scopeUuid), tableId: rowTable, rowId,
    writeEpochUuid: ScopeEpochUuidV1Schema.make(epochUuid), commitSeq: CommitSeqSchema.make(BigInt(commit)),
    prevCommitSeq: commit === 1 ? null : CommitSeqSchema.make(BigInt(commit - 1)),
    schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_cache_data"), creationTime,
    document: await canonicalizeAppDocumentV1({ tableId: rowTable, rowId, creationTime, fields: { name, detail, email: "ada@example.test" } }),
  };
}

function deleted(previous: LiveAppRowRevisionV1): TombstoneAppRowRevisionV1 {
  const { document: _document, kind: _kind, ...identity } = previous;
  return { ...identity, kind: "tombstone", commitSeq: CommitSeqSchema.make(previous.commitSeq + 1n), prevCommitSeq: previous.commitSeq };
}

function cachedPoint(cached: ApplicationQueryDataCache, source: LiveAppRowRevisionV1) {
  const first = cached.cache.get(`row/${source.tableId}`, cachePointInterval({ kind: "row", rowId: source.rowId }), "asc")[0];
  return first?.kind === "document" ? first.value.copy() : undefined;
}

function cachedIndex(cached: ApplicationQueryDataCache, id: number) {
  return cached.cache.get(`index/${id}`, all, "asc");
}

describe("Application query data cache and completed-operation handoff", () => {
  it("owns row ingress and detached copies without charging a body per index", async () => {
    const index = await definition(1, "name");
    const cached = data(request(1, { definitions: [index] }));
    const original = await row();
    populateQueryRow(cached, original);
    const captured = cachedPoint(cached, original);
    original.document.canonicalBytes.fill(0);
    captured?.document.canonicalBytes.fill(255);
    expect(cachedPoint(cached, original)?.document.canonicalBytes).not.toEqual(original.document.canonicalBytes);
    expect(cachedPoint(cached, original)?.document.canonicalBytes).not.toEqual(captured?.document.canonicalBytes);
    expect(cached.cache.stats()).toMatchObject({ bodies: 1, indexEntries: 2, bodyBytes: original.document.semanticSizeBytes });
  });

  it("refreshes body and revision when all indexed keys remain equal", async () => {
    const index = await definition(1, "name");
    const cached = data(request(1, { definitions: [index] }));
    const before = await row();
    const after = await row("Ada", 2, "changed without moving the index key");
    populateQueryRow(cached, before);
    const oldResult = cachedPoint(cached, before);
    expect(applyQueryCacheRowWrite(cached, before, after)).toBe(true);
    expect(cachedPoint(cached, after)).toMatchObject({ commitSeq: 2n, document: { value: { detail: "changed without moving the index key" } } });
    const indexed = cachedIndex(cached, 1).find(component => component.kind === "document");
    expect(indexed?.kind === "document" ? indexed.value.copy() : undefined).toMatchObject({ commitSeq: 2n });
    expect(oldResult).toMatchObject({ commitSeq: 1n, document: { value: { detail: "initial" } } });
    expect(cached.cache.stats()).toMatchObject({ bodies: 1, bodyBytes: after.document.semanticSizeBytes, indexEntries: 2 });
  });

  it("updates a zero-body complete range after insertion", async () => {
    const index = await definition(1, "name");
    const cached = data(request(1, { definitions: [index] }));
    expect(cached.cache.populate("index/1", [], all)).toBe(true);
    expect(cached.cache.stats()).toMatchObject({ bodies: 0, intervals: 1 });
    const inserted = await row("Bea", 2);
    expect(applyQueryCacheRowWrite(cached, { kind: "missing" }, inserted)).toBe(true);
    expect(cachedIndex(cached, 1).map(component => component.kind)).toEqual(["document"]);
    expect(cached.cache.stats()).toMatchObject({ bodies: 1, indexEntries: 1, intervals: 1 });
  });

  it("removes an old key without inventing coverage at the new key", async () => {
    const index = await definition(1, "name");
    const cached = data(request(1, { definitions: [index] }));
    const before = await row();
    const after = await row("Zora", 2);
    populateQueryRow(cached, before);
    expect(applyQueryCacheRowWrite(cached, before, after)).toBe(true);
    expect(cachedPoint(cached, after)).toMatchObject({ document: { value: { name: "Zora" } } });
    const key = Result.getOrThrow(lowerAppOrderedIndexPhysicalKeyV1(index.physicalSpec, after.document, after.creationTime));
    if (key === null) throw new Error("Expected the unconditional developer key");
    expect(cached.cache.get("index/1", cachePointInterval({ kind: "index", encodedKey: key, rowId: after.rowId }), "asc"))
      .toMatchObject([{ kind: "miss" }]);
    expect(cachedIndex(cached, 1).some(component => component.kind === "document")).toBe(false);
  });

  it("prunes only optional unproved index coverage when deriving an oversized key", async () => {
    const name = await definition(1, "name");
    const email = await definition(2, "email");
    const cached = data(request(1, { definitions: [name, email] }));
    const before = await row();
    const after = await row("x".repeat(3_000), 2);
    populateQueryRow(cached, before);
    expect(Result.isFailure(lowerAppOrderedIndexPhysicalKeyV1(name.physicalSpec, after.document, after.creationTime))).toBe(true);
    expect(applyQueryCacheRowWrite(cached, before, after)).toBe(true);
    expect(cachedPoint(cached, after)?.commitSeq).toBe(2n);
    expect(cachedIndex(cached, 1)).toMatchObject([{ kind: "miss" }]);
    expect(cachedIndex(cached, 2).some(component => component.kind === "document")).toBe(true);
  });

  it("retains complete empty coverage after a deletion and supports reinsertion", async () => {
    const index = await definition(1, "name");
    const cached = data(request(1, { definitions: [index] }));
    const before = await row();
    populateQueryRow(cached, before);
    expect(cached.cache.populate("index/1", [], all)).toBe(true);
    const tombstone = deleted(before);
    expect(applyQueryCacheRowWrite(cached, before, tombstone)).toBe(true);
    expect(cachedIndex(cached, 1)).toEqual([]);
    expect(cached.cache.stats()).toMatchObject({ bodies: 0, indexEntries: 0 });
    expect(applyQueryCacheRowWrite(cached, tombstone, await row("Bea", 3))).toBe(true);
    expect(cachedIndex(cached, 1).map(component => component.kind)).toEqual(["document"]);
  });

  it("clears reusable state when a replacement body exceeds the admitted capacity", async () => {
    const before = await row();
    const tight = { ...budget, maximumSemanticBytes: before.document.semanticSizeBytes };
    const cached = data(request(1, { budget: tight }));
    populateQueryRow(cached, before);
    expect(cached.cache.stats().bodies).toBe(1);
    expect(applyQueryCacheRowWrite(cached, before, await row("Ada", 2, "larger".repeat(100)))).toBe(false);
    expect(cached.cache.stats()).toEqual({ bodies: 0, bodyBytes: 0, indexEntries: 0, intervals: 0 });
  });

  it("keeps impossible row-identity changes as defects rather than cold reuse", async () => {
    const cached = data(request(1));
    const before = await row();
    const wrongTable = await row("Bea", 2, "different identity", secondTable);
    expect(() => applyQueryCacheRowWrite(cached, before, wrongTable)).toThrow("Cache refresh changed row identity");
  });

  it("keeps concurrent checkouts independent and prevents an older late return", () => {
    const handoff = createApplicationQueryCacheHandoff();
    expect(Option.isNone(handoff.take(request(1)))).toBe(true);
    const first = candidate(request(1));
    handoff.put(first);
    const second = Option.getOrThrow(handoff.take(request(2)));
    expect(second.data.cache).toBe(first.data.cache);
    expect(Option.isNone(handoff.take(request(3)))).toBe(true);
    const newer = candidate(request(3));
    handoff.put(newer);
    const latest = Option.getOrThrow(handoff.take(request(4)));
    expect(latest.data.cache).toBe(newer.data.cache);
    handoff.put({ stamp: stamp(2), data: second.data });
    expect(Option.isNone(handoff.take(request(4)))).toBe(true);
    handoff.put({ stamp: stamp(4), data: latest.data });
    expect(Option.getOrThrow(handoff.take(request(4))).stamp.commitSeq).toBe(4n);
  });

  it("leaves a future candidate untouched before limit or definition pruning", async () => {
    const index = await definition(1, "name");
    const input = request(3, { definitions: [index] });
    const cached = data(input);
    populateQueryRow(cached, await row());
    const handoff = createApplicationQueryCacheHandoff();
    handoff.take(input);
    handoff.put(candidate(input, cached));
    expect(Option.isNone(handoff.take(request(2, { budget: { ...budget, maximumSemanticBytes: 1 }, tableIds: [] })))).toBe(true);
    const same = Option.getOrThrow(handoff.take(input));
    expect(same.stamp.commitSeq).toBe(3n);
    expect(same.data.cache.stats()).toMatchObject({ bodies: 1, indexEntries: 2 });
  });

  it("drops incompatible receiving limits without widening them", () => {
    const handoff = createApplicationQueryCacheHandoff();
    handoff.take(request(1));
    handoff.put(candidate(request(1)));
    expect(Option.isNone(handoff.take(request(2, { budget: { ...budget, maximumSemanticBytes: 1 } })))).toBe(true);
    expect(Option.isNone(handoff.take(request(2)))).toBe(true);
  });

  it.each<Partial<ApplicationQueryCacheStamp>>([
    { storageGenerationFence: StorageGenerationFenceSchema.make(2n) },
    { storageGeneration: decodeStorageGeneration("legacy_v1") },
    { epoch: ScopeEpochSchema.make("epoch_changed") },
    { scopeId: ScopeIdSchema.make("scope_changed") },
    { deploymentId: "deployment_changed" },
  ])("rejects a late return after authority identity changes", changes => {
    const handoff = createApplicationQueryCacheHandoff();
    const old = request(1);
    handoff.take(old);
    handoff.put(candidate(old));
    const changed = request(2, { stamp: stamp(2, changes) });
    expect(Option.isNone(handoff.take(changed))).toBe(true);
    handoff.put(candidate(old));
    expect(Option.isNone(handoff.take(changed))).toBe(true);
    handoff.put(candidate(changed));
    expect(Option.getOrThrow(handoff.take(changed)).stamp).toEqual(changed.stamp);
  });

  it("prunes changed index identities while retaining unrelated indexes and points", async () => {
    const old = await definition(1, "name");
    const stable = await definition(2, "email");
    const changed = await definition(1, "detail");
    const before = request(1, { definitions: [old, stable] });
    const cached = data(before);
    const original = await row();
    populateQueryRow(cached, original);
    const handoff = createApplicationQueryCacheHandoff();
    handoff.take(before);
    handoff.put(candidate(before, cached));
    const taken = Option.getOrThrow(handoff.take(request(2, { definitions: [changed, stable] })));
    expect(cachedIndex(taken.data, 1)).toMatchObject([{ kind: "miss" }]);
    expect(cachedIndex(taken.data, 2).some(component => component.kind === "document")).toBe(true);
    expect(cachedPoint(taken.data, original)?.commitSeq).toBe(1n);
    expect(taken.data.cache.stats()).toMatchObject({ bodies: 1, indexEntries: 2 });
  });

  it("removes tables no longer in the selected data view", async () => {
    const before = request(1, { tableIds: [tableId, secondTable] });
    const cached = data(before);
    const first = await row();
    const second = await row("Bea", 1, "other table", secondTable);
    populateQueryRow(cached, first);
    populateQueryRow(cached, second);
    const handoff = createApplicationQueryCacheHandoff();
    handoff.take(before);
    handoff.put(candidate(before, cached));
    const taken = Option.getOrThrow(handoff.take(request(2)));
    expect(cachedPoint(taken.data, first)?.commitSeq).toBe(1n);
    expect(cachedPoint(taken.data, second)).toBeUndefined();
    expect(taken.data.cache.stats()).toMatchObject({ bodies: 1, indexEntries: 1 });
  });

  it("captures mutable envelopes and releases retention permanently on disposal", async () => {
    const index = await definition(1, "name");
    const definitions = [index];
    const tables = [tableId];
    const input = request(1, { definitions, tableIds: tables });
    const cached = data(input);
    definitions.length = 0;
    tables.length = 0;
    Object.assign(index.access, { logicalIndexId: decodeCatalogIndexId(99) });
    expect(cached.tableIds).toEqual([tableId]);
    expect(cached.cacheDefinitions.get(tableId)?.[0]?.access).toMatchObject({ logicalIndexId: 1 });
    const handoff = createApplicationQueryCacheHandoff();
    handoff.take(request(1));
    const originalStamp = stamp(1);
    handoff.put({ stamp: originalStamp, data: cached });
    Object.assign(originalStamp, { commitSeq: CommitSeqSchema.make(99n) });
    expect(Option.getOrThrow(handoff.take(request(1))).stamp.commitSeq).toBe(1n);
    handoff.dispose();
    handoff.put(candidate(request(2)));
    expect(Option.isNone(handoff.take(request(2)))).toBe(true);
  });
});
