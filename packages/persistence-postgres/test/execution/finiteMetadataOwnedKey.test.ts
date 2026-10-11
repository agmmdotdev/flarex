import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { MetadataSequenceSchema, logicalMetadataDependencyIdentity } from "flarex-protocol/commit-protocol";
import { decodeSchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { SessionJournalAttempt } from "../../src/execution/journal/api";
import { captureFiniteMetadataDependency, disposeFiniteMetadataProjection, finiteMetadataAccessKey, finiteMetadataTableKey,
  prepareFiniteMetadataProjection, matchesFiniteMetadataDependencyObservation } from "../../src/execution/finiteMetadataDependencies";
import { attachLogicalDocumentRootEvaluator, consumeLogicalDocumentRootMetadataDependency, makeLogicalDocumentRootEvaluator,
  recordLogicalDocumentRootMetadataDependency } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { runEffect } from "../support/effectTestRuntime";

const tableId = decodeCatalogTableId(1);
const manifest = decodeSchemaManifestAppSchemaV1({ kind: "appSchema", manifestVersion: 1,
  tableDefinitions: { kind: "tableDefinitions", sectionVersion: 1, tables: [{ tableId: 1, namespace: "app", logicalName: "items",
    definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object", value: {
      name: { fieldType: { type: "string" }, optional: false },
    } } } }] }, indexBindings: { kind: "indexBindings", sectionVersion: 1, indexes: [] } });
const prepare = () => prepareFiniteMetadataProjection({ indexes: [], unique: [], applicationSchema: { manifest } });

it("retains only exact projection-issued keys, validates foreign keys, and binds each watermark", () => runEffect(Effect.gen(function* () {
  const projection = yield* prepare(), foreign = yield* prepare();
  try {
    const key = finiteMetadataTableKey(projection, tableId, "table");
    if (key === null) throw new Error("Missing table key");
    expect(finiteMetadataTableKey(projection, tableId, "table")).toBe(key);
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

it("charges an issued metadata dependency once and rejects copied malformed evidence at the fixed root", () => runEffect(Effect.gen(function* () {
  const projection = yield* prepare();
  const key = finiteMetadataTableKey(projection, tableId, "table");
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
    expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key))).toBe(true);
    const issued = state.metadataConsumptions.get(projection)?.get(logicalMetadataDependencyIdentity(key));
    expect(issued).toBeDefined();
    expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key))).toBe(true);
    expect(state.workingBytes).toBe(charge);
    expect([...state.metadataConsumptions.get(projection)?.values() ?? []]).toContain(issued);
    expect(recordLogicalDocumentRootMetadataDependency(state, { ...dependency, capturedWatermark: MetadataSequenceSchema.make(2n) })).toBe(false);
    const missingKey = finiteMetadataAccessKey(projection, tableId, "nativeIndex", "unindexed");
    if (missingKey === null) throw new Error("Missing access key");
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
