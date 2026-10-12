import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { decodeCatalogTableId, CatalogIndexDefinitionIdSchema, CatalogUniqueConstraintDefinitionIdSchema, CatalogUniqueConstraintIdSchema } from "flarex-protocol/catalog";
import { MetadataSequenceSchema, logicalMetadataDependencyIdentity } from "flarex-protocol/commit-protocol";
import { decodeSchemaManifestAppSchemaV1, decodeSchemaManifestAppDeveloperOrderedIndexSpecV1 } from "flarex-protocol/schema-manifest";
import { lowerAppDeveloperOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1, decodeAppPhysicalIndexAccessIdentityV1 } from "flarex-protocol/index-definition";
import { canonicalizeAppUniqueConstraintPhysicalSpecV1, decodeAppUniqueConstraintPhysicalSpecV1,
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1 } from "flarex-protocol/app-unique-constraint-definition";
import { CommitSeqSchema, ScopeIdSchema, ScopeEpochSchema, FlarexDbV1StorageGenerationSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { SessionJournalAttempt } from "../../src/execution/journal/api";
import { captureFiniteMetadataDependency, disposeFiniteMetadataProjection, finiteMetadataAccessKey, finiteMetadataTableKey, finiteMetadataDefinitionKey,
  prepareFiniteMetadataProjection, matchesFiniteMetadataDependencyObservation, finiteMetadataDependencyIdentity,
  mergeFiniteMetadataProjections, getFiniteMetadataProjectionSource } from "../../src/execution/finiteMetadataDependencies";
import { attachLogicalDocumentRootEvaluator, consumeLogicalDocumentRootMetadataDependency, makeLogicalDocumentRootEvaluator,
  recordLogicalDocumentRootMetadataDependency } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { runEffect } from "../support/effectTestRuntime";
import { makeBoundedRequestLifetime } from "../../src/execution/preparation/boundedRequestLifetime";
import { makeLogicalDocumentWorkingSet, prepareLogicalWriteMechanics } from "../../src/storage/documents/logicalDocuments/workingSet";
import { useCapturedPrivateJsonData } from "../../src/values/privateJsonData";

const tableId = decodeCatalogTableId(1);
const manifest = decodeSchemaManifestAppSchemaV1({ kind: "appSchema", manifestVersion: 1,
  tableDefinitions: { kind: "tableDefinitions", sectionVersion: 1, tables: [{ tableId: 1, namespace: "app", logicalName: "items",
    definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object", value: {
      name: { fieldType: { type: "string" }, optional: false },
    } } } }] }, indexBindings: { kind: "indexBindings", sectionVersion: 1, indexes: [] } });
const prepare = () => prepareFiniteMetadataProjection({ indexes: [], unique: [], applicationSchema: { manifest } });

it.each(["table", "access"] as const)("stops at the first %s consumption refusal before selecting revoked later facts", stage => runEffect(Effect.scoped(Effect.gen(function* () {
  const projection = yield* prepare();
  const input = { where: { name: "first", absent: "later" }, offset: 0, limit: 1 };
  const errors: Error[] = [];
  let armed = false, storageCalls = 0;
  const failure = (reason: string, cause?: unknown) => {
    const error = new Error(reason, { cause });
    if (armed) { errors.push(error); disposeFiniteMetadataProjection(projection); }
    return error;
  };
  const mechanics = yield* prepareLogicalWriteMechanics({ tables: [{ tableId, logicalName: "items" }], indexes: [], unique: [],
    metadataProjection: projection }, failure);
  const captured = Result.getOrThrow(useCapturedPrivateJsonData(input, 262_144, failure));
  const metadataCharge = (kind: "table" | "sourcePolicy") => {
    const key = finiteMetadataTableKey(projection, tableId, kind);
    if (key === null) throw new Error("Missing genuine table metadata");
    return 256 + 2 * (key.ownerKey.length + key.contractKey.length);
  };
  // SAFETY: this local root fixture never invokes the journal issuer. Only the
  // genuine root and request lifetime compare this opaque attempt identity.
  const attempt = Object.freeze({}) as SessionJournalAttempt;
  const scopeId = ScopeIdSchema.make("scope_60000000-0000-0000-0000-000000000001");
  const snapshotCommitSeq = CommitSeqSchema.make(1n), metadataWatermark = MetadataSequenceSchema.make(1n);
  const pins = { attempt, scopeId, snapshotCommitSeq, metadataWatermark, attemptFence: "1" };
  const root = makeLogicalDocumentRootEvaluator(pins, { identities: 16,
    workingBytes: captured.bytes + (stage === "access" ? metadataCharge("table") + metadataCharge("sourcePolicy") : 0) });
  try {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 16, commandBytes: 262_144, commandMs: 60_000 }, attempt, {}, "metadata-refusal-order", "write"), resource => resource.close);
    const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock: { scopeId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), storageGenerationFence: StorageGenerationFenceSchema.make(1n),
      lastCommitSeq: snapshotCommitSeq, lastMetadataSequence: metadataWatermark, oldestAvailableCommitSeq: snapshotCommitSeq,
      epoch: ScopeEpochSchema.make("metadata-order"), updatedAt: new Date(0) }, lifetime,
      rootEvaluator: root, rootAttempt: attempt, rootAttemptFence: pins.attemptFence, snapshotCommitSeq,
      tables: mechanics.tables, searchDefinitions: mechanics.searchDefinitions,
      ...(mechanics.relationalCapabilities === undefined ? {} : { relationalCapabilities: mechanics.relationalCapabilities }),
      writeMechanics: mechanics, requireAdmission: Effect.void,
      readTransaction: () => { storageCalls++; return Effect.fail(new Error("Unexpected storage entry")); },
      validateDocument: () => Effect.void, error: failure, uniqueConflict: () => failure("uniqueConflict"),
      limits: { pageRows: 8, identities: 16, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(1), mechanics.unique, mechanics.indexes);
    const id = yield* lifetime.begin(lifetime.context);
    armed = true;
    const result = yield* Effect.result(working.documents.find(lifetime.context, id, "items", input));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("invalidAuthority");
    expect(result).toMatchObject({ _tag: "Failure", failure: errors[0] });
    if (Result.isFailure(result)) expect(result.failure).toBe(errors[0]);
    expect(storageCalls).toBe(0);
    expect(root.snapshot().metadataDependencies).toHaveLength(stage === "access" ? 2 : 0);
  } finally { armed = false; root.close(); disposeFiniteMetadataProjection(projection); }
}))));

it("reuses present table, definition and access facts without retaining negative selectors or coercing foreign selectors", () => runEffect(Effect.gen(function* () {
  const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
    kind: "developerOrdered", specVersion: 1, fields: ["name"] }));
  const canonicalIndex = yield* Effect.promise(() => canonicalizeAppIndexPhysicalSpecV1(physicalSpec));
  const uniqueSpec = decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
    orderedFields: ["name"], sparse: true, localePolicy: { kind: "none" },
    keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 });
  const canonicalUnique = yield* Effect.promise(() => canonicalizeAppUniqueConstraintPhysicalSpecV1(uniqueSpec));
  const firstTable = manifest.tableDefinitions.tables[0];
  if (firstTable === undefined) throw new Error("Missing manifest table");
  const otherTableId = decodeCatalogTableId(2);
  const twoTables = decodeSchemaManifestAppSchemaV1({ ...manifest, tableDefinitions: { ...manifest.tableDefinitions,
    tables: [firstTable, { ...firstTable, tableId: otherTableId, logicalName: "other" }] } });
  const projection = yield* prepareFiniteMetadataProjection({ applicationSchema: { manifest: twoTables },
    indexes: [{ indexDefinitionId: CatalogIndexDefinitionIdSchema.make(1),
      access: decodeAppPhysicalIndexAccessIdentityV1({ kind: "developer", tableId, logicalIndexId: 1 }),
      physicalSpec, physicalSpecSha256Hex: canonicalIndex.sha256Hex }],
    unique: [{ tableId, uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema.make(1),
      logicalUniqueConstraintId: CatalogUniqueConstraintIdSchema.make(1), physicalSpec: uniqueSpec,
      physicalSpecSha256Hex: canonicalUnique.sha256Hex }] });
  const merged = Result.getOrThrow(mergeFiniteMetadataProjections([projection]));
  const source = getFiniteMetadataProjectionSource(projection, "application");
  if (source === null) throw new Error("Missing source projection");
  try {
    const selections = [() => finiteMetadataTableKey(projection, tableId, "writeClosure"),
      () => finiteMetadataDefinitionKey(projection, tableId, "index", 1),
      () => finiteMetadataDefinitionKey(projection, tableId, "unique", 1),
      () => finiteMetadataAccessKey(projection, tableId, "ordered", "name"),
      () => finiteMetadataAccessKey(projection, tableId, "unique", "name")];
    for (const select of selections) {
      const key = select();
      if (key === null) throw new Error("Missing selector");
      expect(select()).toBe(key);
      expect(Object.isFrozen(key)).toBe(true);
      expect(finiteMetadataDependencyIdentity(key)).toBe(logicalMetadataDependencyIdentity(key));
      const dependency = Result.getOrThrow(captureFiniteMetadataDependency(projection, key, MetadataSequenceSchema.make(1n)));
      expect(dependency.observed.kind).toBe("present");
      expect(finiteMetadataDependencyIdentity(dependency)).toBe(logicalMetadataDependencyIdentity(dependency));
    }
    // Definition keys describe owner contracts; selecting through another
    // authentic table must not invent a table-association restriction.
    expect(finiteMetadataDefinitionKey(projection, otherTableId, "index", 1))
      .toBe(finiteMetadataDefinitionKey(projection, tableId, "index", 1));
    expect(finiteMetadataTableKey(projection, otherTableId, "table"))
      .not.toBe(finiteMetadataTableKey(projection, tableId, "table"));
    const original = finiteMetadataTableKey(projection, tableId, "table");
    expect(finiteMetadataTableKey(merged, tableId, "table")).toEqual(original);
    expect(finiteMetadataTableKey(merged, tableId, "table")).not.toBe(original);
    expect(finiteMetadataTableKey(source, tableId, "table")).not.toBe(original);
    const absent = () => finiteMetadataAccessKey(projection, tableId, "ordered", "absent");
    expect(absent()).not.toBe(absent());
    let coerced = 0;
    const foreignFamily = { toString() { coerced++; return "ordered"; } };
    expect(() => Reflect.apply(finiteMetadataAccessKey, undefined, [projection, tableId, foreignFamily, "name"]))
      .toThrow("Owned metadata semantics are not JSON");
    expect(coerced).toBe(0);
    if (original === null) throw new Error("Missing table key");
    const foreign = { ...original };
    foreign.contractKey = "changed";
    expect(finiteMetadataDependencyIdentity(foreign)).toBe(logicalMetadataDependencyIdentity(foreign));
    disposeFiniteMetadataProjection(projection);
    for (const select of selections) expect(select()).toBeNull();
  } finally { disposeFiniteMetadataProjection(projection); disposeFiniteMetadataProjection(merged); disposeFiniteMetadataProjection(source); }
})));

it.each(["table", "sourcePolicy"] as const)("retains exact projection-issued %s keys, validates foreign keys, and binds each watermark", kind => runEffect(Effect.gen(function* () {
  const projection = yield* prepare(), foreign = yield* prepare();
  try {
    const key = finiteMetadataTableKey(projection, tableId, kind);
    if (key === null) throw new Error("Missing table key");
    expect(finiteMetadataTableKey(projection, tableId, kind)).toBe(key);
    expect(Object.isFrozen(key)).toBe(true);
    const firstWatermark = MetadataSequenceSchema.make(1n), nextWatermark = MetadataSequenceSchema.make(2n);
    const first = Result.getOrThrow(captureFiniteMetadataDependency(projection, key, firstWatermark));
    const next = Result.getOrThrow(captureFiniteMetadataDependency(projection, key, nextWatermark));
    expect(next.observed).toBe(first.observed);
    expect(next.capturedWatermark).toBe(nextWatermark);
    expect(matchesFiniteMetadataDependencyObservation(projection, key, nextWatermark, first)).toBe(false);
    const extendedDependency = { ...first, unexpected: true };
    expect(matchesFiniteMetadataDependencyObservation(projection, key, firstWatermark, extendedDependency)).toBe(false);
    expect(matchesFiniteMetadataDependencyObservation(projection, key, firstWatermark,
      { ...first, observed: { kind: "present", semanticSha256Hex: "invalid" } })).toBe(false);
    expect(matchesFiniteMetadataDependencyObservation(projection, key, firstWatermark,
      { ...first, capturedWatermark: nextWatermark })).toBe(false);
    expect(matchesFiniteMetadataDependencyObservation(projection, key, firstWatermark, Object.freeze({ ...first }))).toBe(true);
    const copy = Result.getOrThrow(captureFiniteMetadataDependency(projection, Object.freeze({ ...key }), firstWatermark));
    expect(copy).toEqual(first);
    expect(copy.observed).not.toBe(first.observed);
    const extendedKey = { ...key, unexpected: true };
    const invalidKey = captureFiniteMetadataDependency(projection, extendedKey, firstWatermark);
    expect(Result.isFailure(invalidKey)).toBe(true);
    if (Result.isFailure(invalidKey)) expect(invalidKey.failure.reason).toBe("invalidInput");
    const foreignCapture = Result.getOrThrow(captureFiniteMetadataDependency(foreign, key, firstWatermark));
    expect(foreignCapture.observed).not.toBe(first.observed);
    const missingKey = finiteMetadataAccessKey(projection, tableId, "nativeIndex", "unindexed");
    if (missingKey === null) throw new Error("Missing access key");
    expect(Result.getOrThrow(captureFiniteMetadataDependency(projection, missingKey, firstWatermark)).observed).toEqual({ kind: "missing" });
    disposeFiniteMetadataProjection(projection);
    const closedProjection = captureFiniteMetadataDependency(projection, key, firstWatermark);
    expect(Result.isFailure(closedProjection)).toBe(true);
    if (Result.isFailure(closedProjection)) expect(closedProjection.failure.reason).toBe("invalidProjection");
    expect(matchesFiniteMetadataDependencyObservation(projection, key, firstWatermark, first)).toBe(false);
  } finally { disposeFiniteMetadataProjection(projection); disposeFiniteMetadataProjection(foreign); }
})));

it.each(["index", "unique"] as const)("keeps missing %s selectors fully decoded and unretained", kind => runEffect(Effect.gen(function* () {
  const projection = yield* prepare();
  const foreign = yield* prepare();
  try {
    const key = finiteMetadataDefinitionKey(projection, tableId, kind, 1);
    if (key === null) throw new Error("Missing definition key");
    expect(finiteMetadataDefinitionKey(projection, tableId, kind, 1)).not.toBe(key);
    expect(Object.isFrozen(key)).toBe(true);
    const watermark = MetadataSequenceSchema.make(1n);
    const dependency = Result.getOrThrow(captureFiniteMetadataDependency(projection, key, watermark));
    expect(dependency.observed).toEqual({ kind: "missing" });
    expect(matchesFiniteMetadataDependencyObservation(projection, key, watermark, dependency)).toBe(true);
    const extendedKey = { ...key, unexpected: true }, extendedDependency = { ...dependency, unexpected: true };
    expect(matchesFiniteMetadataDependencyObservation(projection, extendedKey, watermark, dependency)).toBe(false);
    expect(matchesFiniteMetadataDependencyObservation(projection, key, watermark, extendedDependency)).toBe(false);
    expect(finiteMetadataDefinitionKey({ ...projection }, tableId, kind, 1)).toBeNull();
    expect(finiteMetadataDefinitionKey(projection, decodeCatalogTableId(2), kind, 1)).toBeNull();
    expect(finiteMetadataTableKey(foreign, tableId, "sourcePolicy")).not.toBe(finiteMetadataTableKey(projection, tableId, "sourcePolicy"));
    disposeFiniteMetadataProjection(projection);
    expect(finiteMetadataDefinitionKey(projection, tableId, kind, 1)).toBeNull();
    expect(matchesFiniteMetadataDependencyObservation(projection, key, watermark, dependency)).toBe(false);
  } finally { disposeFiniteMetadataProjection(projection); disposeFiniteMetadataProjection(foreign); }
})));

it.each(["table", "sourcePolicy"] as const)("charges an issued %s dependency once and rejects copied malformed evidence at the fixed root", kind => runEffect(Effect.gen(function* () {
  const projection = yield* prepare();
  const key = finiteMetadataTableKey(projection, tableId, kind);
  if (key === null) throw new Error("Missing table key");
  const watermark = MetadataSequenceSchema.make(1n);
  const dependency = Result.getOrThrow(captureFiniteMetadataDependency(projection, key, watermark));
  const charge = 256 + 2 * (dependency.ownerKey.length + dependency.contractKey.length);
  // SAFETY: this local root fixture never invokes the journal issuer; the root
  // independently binds and compares this opaque attempt by exact identity.
  const attempt = Object.freeze({}) as SessionJournalAttempt;
  const pins = { attempt, attemptFence: "1", scopeId: ScopeIdSchema.make("scope_60000000-0000-0000-0000-000000000001"),
    snapshotCommitSeq: CommitSeqSchema.make(1n), metadataWatermark: watermark };
  const root = makeLogicalDocumentRootEvaluator(pins, { identities: 16, workingBytes: charge });
  try {
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing genuine root");
    expect(recordLogicalDocumentRootMetadataDependency(state, { ...dependency, observed: { kind: "present", semanticSha256Hex: "invalid" } })).toBe(false);
    const extendedDependency = { ...dependency, unexpected: true };
    expect(recordLogicalDocumentRootMetadataDependency(state, extendedDependency)).toBe(false);
    expect(state.workingBytes).toBe(0);
    const missingKey = finiteMetadataAccessKey(projection, tableId, "nativeIndex", "unindexed");
    if (missingKey === null) throw new Error("Missing access key");
    const spareRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 16, workingBytes: charge + 1024 });
    try {
      const spareState = attachLogicalDocumentRootEvaluator(spareRoot, pins);
      if (spareState === null) throw new Error("Missing spare root");
      const missingRequired = consumeLogicalDocumentRootMetadataDependency(spareState, projection, missingKey, true);
      expect(Result.isFailure(missingRequired)).toBe(true);
      if (Result.isFailure(missingRequired)) expect(missingRequired.failure).toBe("observationMismatch");
      expect(spareState.workingBytes).toBe(0);
      expect(spareState.metadataDependencies.size).toBe(0);
      expect(spareState.metadataConsumptions.size).toBe(0);
      expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(spareState, projection, missingKey))).toBe(true);
      const missingCharge = 256 + 2 * (missingKey.ownerKey.length + missingKey.contractKey.length);
      expect(spareState.workingBytes).toBe(missingCharge);
      expect(spareState.metadataDependencies.size).toBe(1);
      expect(Result.isFailure(consumeLogicalDocumentRootMetadataDependency(spareState, projection, missingKey, true))).toBe(true);
      expect(spareState.workingBytes).toBe(missingCharge);
    } finally { spareRoot.close(); }
    expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key))).toBe(true);
    const issued = state.metadataConsumptions.get(projection)?.get(logicalMetadataDependencyIdentity(key));
    expect(issued).toBeDefined();
    expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key))).toBe(true);
    expect(state.workingBytes).toBe(charge);
    expect([...state.metadataConsumptions.get(projection)?.values() ?? []]).toContain(issued);
    expect(recordLogicalDocumentRootMetadataDependency(state, { ...dependency, capturedWatermark: MetadataSequenceSchema.make(2n) })).toBe(false);
    const limitRefusal = consumeLogicalDocumentRootMetadataDependency(state, projection, missingKey);
    expect(Result.isFailure(limitRefusal)).toBe(true);
    if (Result.isFailure(limitRefusal)) expect(limitRefusal.failure).toBe("observationMismatch");
    expect(state.metadataDependencies.size).toBe(1);
    disposeFiniteMetadataProjection(projection);
    const disposedProjection = consumeLogicalDocumentRootMetadataDependency(state, projection, key);
    expect(Result.isFailure(disposedProjection)).toBe(true);
    if (Result.isFailure(disposedProjection)) expect(disposedProjection.failure)
      .toMatchObject({ _tag: "FiniteMetadataError", reason: "invalidProjection" });
    root.close();
    const closedRoot = consumeLogicalDocumentRootMetadataDependency(state, projection, key);
    expect(Result.isFailure(closedRoot)).toBe(true);
    if (Result.isFailure(closedRoot)) expect(closedRoot.failure).toBe("closed");
  } finally { root.close(); disposeFiniteMetadataProjection(projection); }
})));
