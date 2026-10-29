import { Effect, Option, Result } from "effect";
import { expect } from "vitest";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId,
  type CatalogSchemaVersionId, type SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { ensureSchemaVersionArtifactInTransactionEffect, prepareSchemaVersionArtifactEffect } from "../../../src/storage/catalog/schemaVersionArtifacts";
import { ensureAppDeveloperIndexDefinitionBindingV1InTransaction, getAppSchemaVersionIndexBindingEffect,
  locateAppIndexDefinitionByIdEffect, prepareOrderedIndexDefinitionBinding } from "../../../src/storage/indexes/appIndexDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/locatedAppIndexDefinition";
import { lowerAppDeveloperIndexKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";
import { attachLogicalDocumentRootEvaluator, lookupLogicalDocumentRootPendingKey, makeLogicalDocumentRootEvaluator,
  readLogicalDocumentRootPendingIndex, registerLogicalDocumentRootIndexes,
  type LogicalDocumentRootPins, type LogicalDocumentRootPointFailure } from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type { ApplicationDocumentObservation } from "../../../src/storage/materialization/model";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type Failure = LogicalDocumentRootPointFailure | Result.Result.Failure<ReturnType<typeof lowerAppDeveloperIndexKeyV1>>;

/** Real catalog binding + pending-owner proof. A distinct unactivated fixture
 * artifact uses the trusted native physical-projection writer. This neither
 * adds public Application partial-index admission nor establishes readiness or
 * native-host support. Fixture disposal owns the temporary catalog records. */
export const pendingPredicateIndexScenario = Effect.fn("PendingIndex.predicateScenario")(
  function* (native: Fixture, input: Readonly<{
    manifest: SchemaManifestAppSchemaV1;
    selectedSchemaVersionId: CatalogSchemaVersionId;
    definition: LocatedAppIndexDefinitionV1;
    pins: LogicalDocumentRootPins;
    observation: ApplicationDocumentObservation;
    creationTime: AppCreationTimeV1;
  }>) {
    const { definition: selected, observation, creationTime, pins } = input;
    if (selected.access.kind !== "developer") throw new Error("Missing genuine developer index parent");
    const logicalIndexId = selected.access.logicalIndexId;
    const beforeBinding = yield* getAppSchemaVersionIndexBindingEffect(native.control.drizzle, native.deploymentId,
      input.selectedSchemaVersionId, logicalIndexId);
    if (beforeBinding === null || beforeBinding.indexDefinitionId !== selected.indexDefinitionId)
      throw new Error("Missing actual selected schema binding");
    const schemaVersionId = decodeCatalogSchemaVersionId("pending_predicate_owner");
    const artifact = yield* prepareSchemaVersionArtifactEffect({ deploymentId: native.deploymentId, schemaVersionId,
      version: decodeCatalogSchemaVersion(99), manifest: input.manifest });
    const physicalSpec = decodeAppOrderedIndexPhysicalSpecV1({ ...selected.physicalSpec,
      predicate: { kind: "fieldIsNotNull", field: "padding" } });
    const ordered = yield* prepareOrderedIndexDefinitionBinding({ deploymentId: native.deploymentId, schemaVersionId,
      tableId: observation.tableId, logicalIndexId, physicalSpec });
    const install = Effect.fn("PendingIndex.installPredicateFixture")(function* (tx: FlarexMetadataTransaction) {
      yield* ensureSchemaVersionArtifactInTransactionEffect(tx, artifact);
      return yield* ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, ordered);
    });
    const installed = yield* runEffectTransaction<Effect.Success<ReturnType<typeof install>>,
      Effect.Error<ReturnType<typeof install>>, unknown, FlarexMetadataTransaction>(
      callback => native.control.drizzle.transaction(callback), "Install isolated predicate owner fixture", install, cause => cause);
    const definition = yield* locateAppIndexDefinitionByIdEffect(native.control.drizzle, pins.scopeId, installed.definition.indexDefinitionId);
    if (definition === null) throw new Error("Missing genuinely located predicate definition");
    expect(definition.indexDefinitionId).not.toBe(selected.indexDefinitionId);
    expect(definition.physicalSpec.predicate).toEqual({ kind: "fieldIsNotNull", field: "padding" });

    const root = yield* Effect.acquireRelease(Effect.sync(() => makeLogicalDocumentRootEvaluator(pins,
      { identities: 8, workingBytes: 1_048_576 })), owner => Effect.sync(owner.close));
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing predicate owner root");
    Result.getOrThrow(root.observePoint("users", observation, { kind: "missing" }));
    Result.getOrThrow(registerLogicalDocumentRootIndexes(state, [definition], { error: failure => failure }));
    const write = Effect.fn("PendingIndex.writePredicateBody")(function* (operation: "insert" | "replace", padding?: string) {
      const document = yield* canonicalizeFlarexValueV1Effect({ _id: observation.documentId, _creationTime: creationTime,
        name: "Predicate row", ...(padding === undefined ? {} : { padding }) }, "appDocument");
      Result.getOrThrow(root.writePoint("users", observation, { kind: "live", creationTime, document }, operation));
      const current = state.rows.get(observation.documentId)?.current;
      if (current == null) throw new Error("Predicate write lost its live current body");
      return current;
    });
    const read = () => readLogicalDocumentRootPendingIndex<Failure>(state, definition, {
      order: "application", error: failure => failure, charge: () => Result.succeed(undefined),
      lower: row => {
        if (row.current === null) throw new Error("Predicate scenario must keep a live row");
        return lowerAppDeveloperIndexKeyV1(definition, row.current, row.creationTime);
      },
    });
    const includedBody = yield* write("insert", "included");
    const initialKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, includedBody, creationTime));
    expect(initialKey).not.toBeNull();
    const included = Result.getOrThrow(read());
    expect(included.positions).toHaveLength(1);
    expect(included.positions[0]?.encodedKey).toBe(initialKey);
    expect(included.writtenCount).toBe(1);
    expect(included.hasWritten(observation.rowId)).toBe(true);

    // Full replacement removes the optional field while the canonical row stays
    // live. The real predicate lowerer, rather than a callback stub, excludes it.
    const excludedBody = yield* write("replace");
    expect(Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, excludedBody, creationTime))).toBeNull();
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, excludedBody, creationTime))).toEqual(Option.none());
    const excluded = Result.getOrThrow(read());
    expect(excluded.positions).toEqual([]);
    expect(excluded.writtenCount).toBe(1);
    expect(excluded.hasWritten(observation.rowId)).toBe(true);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, excludedBody, creationTime))).toEqual(Option.some(null));
    expect(root.snapshot().changes).toMatchObject([{ kind: "live", documentId: observation.documentId }]);
    expect(root.snapshot().attempts.map(attempt => attempt.operation)).toEqual(["insert", "replace"]);
    expect(root.snapshot().noFinalRows).toEqual([]);

    const restoredBody = yield* write("replace", "restored");
    expect(Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, restoredBody, creationTime))).toBe(initialKey);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, restoredBody, creationTime))).toEqual(Option.none());
    const restored = Result.getOrThrow(read());
    expect(restored.positions).toMatchObject([{ documentId: observation.documentId, encodedKey: initialKey,
      document: { value: { name: "Predicate row", padding: "restored" } } }]);
    expect(restored.writtenCount).toBe(1);
    expect(restored.hasWritten(observation.rowId)).toBe(true);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, restoredBody, creationTime))).toEqual(Option.some(initialKey));
    expect(root.snapshot().changes).toHaveLength(1);
    expect(root.snapshot().attempts.map(attempt => attempt.operation)).toEqual(["insert", "replace", "replace"]);
    expect(root.snapshot().noFinalRows).toEqual([]);

    // The isolated physical variant must not replace the selected binding.
    expect(yield* getAppSchemaVersionIndexBindingEffect(native.control.drizzle, native.deploymentId,
      input.selectedSchemaVersionId, logicalIndexId)).toEqual(beforeBinding);
    expect(selected.physicalSpec.predicate).toBeUndefined();
  },
);
