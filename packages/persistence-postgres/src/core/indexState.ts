/**
 * Database index metadata translated from Convex common/bootstrap_model/index
 * at db914cf06e2b06ee985646611b9e12ed7a770318.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { DocumentObject } from "flarex-protocol/document-value";
import { SchemaManifestAppIdentifierSchema, SchemaManifestAppIndexDescriptorSchema, SchemaManifestAppIndexFieldPathSchema } from "flarex-protocol/schema-manifest";
import { CorePersistenceError, CoreTimestampSchema, type CoreIndexRef, type CoreIndexWriteMode } from "./contracts";
import type { CoreSystemDocument } from "./transaction";

const MetadataIdentifier = SchemaManifestAppIdentifierSchema;
const TabletHex = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{32}$/.test(value)
  ? undefined : "Expected a canonical internal table identity"));

/** Source IndexedFields includes the creation-time suffix, but not its implicit ID tie. */
export const CoreIndexFieldsSchema = Schema.Array(SchemaManifestAppIndexFieldPathSchema).check(
  Schema.isMaxLength(16),
  Schema.makeFilter(fields => fields.some(field => field === "_id") ? "The ID field is implicit in database indexes"
    : new Set(fields).size !== fields.length ? "Expected unique index fields" : undefined),
);

/** Source schema JSON declarations exclude intrinsic descriptors and empty fields. */
export const CoreIndexDeclarationSchema = Schema.Struct({
  indexDescriptor: SchemaManifestAppIndexDescriptorSchema,
  fields: CoreIndexFieldsSchema.check(Schema.isMinLength(1)),
});
export type CoreIndexDeclaration = typeof CoreIndexDeclarationSchema.Type;

export const CoreDatabaseIndexStateSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("Backfilling"), backfillState: Schema.Struct({
    indexCreatedLowerBound: CoreTimestampSchema, retentionStarted: Schema.Boolean, staged: Schema.Boolean,
  }) }),
  // Backfilled2 is the pinned source's persisted variant, not a parallel engine version.
  Schema.Struct({ type: Schema.Literal("Backfilled2"), staged: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("Enabled") }),
]);
export type CoreDatabaseIndexState = typeof CoreDatabaseIndexStateSchema.Type;

export const CoreIndexMetadataSchema = Schema.Struct({
  table_id: TabletHex,
  descriptor: MetadataIdentifier,
  config: Schema.Struct({ type: Schema.Literal("database"), fields: CoreIndexFieldsSchema,
    onDiskState: CoreDatabaseIndexStateSchema,
    persistenceIndexId: Schema.optionalKey(Schema.BigInt.check(Schema.makeFilter(value => value >= -0x8000_0000_0000_0000n && value <= 0x7fff_ffff_ffff_ffffn
      ? undefined : "Expected a source int64 persistence index identity"))),
  }),
});
export type CoreIndexMetadata = typeof CoreIndexMetadataSchema.Type;
const decodeStoredCoreIndexMetadata = Schema.decodeUnknownResult(CoreIndexMetadataSchema);
/** Source i64 -> NonZeroU32 conversion intentionally treats invalid optional IDs as absent. */
export const decodeCoreIndexMetadata = (input: unknown) =>
  Result.map(decodeStoredCoreIndexMetadata(input), (metadata): CoreIndexMetadata => {
    const id = metadata.config.persistenceIndexId;
    return id === undefined || id > 0n && id <= 0xffff_ffffn ? metadata : { ...metadata, config: {
      type: metadata.config.type, fields: metadata.config.fields, onDiskState: metadata.config.onDiskState } };
  });

export interface CoreIndexRecord {
  readonly ref: CoreIndexRef;
  readonly tableId: Uint8Array;
  readonly name: string;
  readonly fields: readonly string[];
  readonly state: CoreDatabaseIndexState;
  readonly ts: bigint | null;
}

export function isCoreIndexEnabled(index: Pick<CoreIndexRecord, "state">): boolean {
  return index.state.type === "Enabled";
}
export function isCoreIndexStaged(index: Pick<CoreIndexRecord, "state">): boolean {
  return index.state.type === "Backfilling" ? index.state.backfillState.staged
    : index.state.type === "Backfilled2" && index.state.staged;
}
export function coreIndexWriteMode(index: Pick<CoreIndexRecord, "state">): CoreIndexWriteMode {
  return index.state.type === "Backfilling" && !index.state.backfillState.retentionStarted ? "scanning" : "scanComplete";
}
export function withCoreIndexStaged(index: CoreIndexRecord, staged: boolean): CoreIndexRecord {
  const state: CoreDatabaseIndexState = index.state.type === "Backfilling"
    ? { ...index.state, backfillState: { ...index.state.backfillState, staged } }
    : index.state.type === "Backfilled2" ? { ...index.state, staged } : index.state;
  return captureCoreIndexRecord({ ...index, state });
}

export function captureCoreIndexRecord(index: CoreIndexRecord): CoreIndexRecord {
  const state: CoreDatabaseIndexState = index.state.type === "Backfilling"
    ? Object.freeze({ ...index.state, backfillState: Object.freeze({ ...index.state.backfillState }) })
    : Object.freeze({ ...index.state });
  return Object.freeze({ ...index, ref: Object.freeze({ ...index.ref, id: index.ref.id.slice() }),
    tableId: index.tableId.slice(), fields: Object.freeze([...index.fields]), state });
}

export function coreIndexMetadataValue(index: CoreIndexRecord): DocumentObject {
  return { table_id: encodeBytesToLowercaseHex(index.tableId), descriptor: index.name,
    config: { type: "database", fields: [...index.fields], onDiskState: index.state,
      ...(index.ref.persistenceIndexId === undefined ? {} : { persistenceIndexId: index.ref.persistenceIndexId }),
    },
  };
}

/** The logical row identity supplies IndexId; table numbers never address an index. */
export function parseCoreIndexRecord(document: CoreSystemDocument, ts: bigint | null): Result.Result<CoreIndexRecord, CorePersistenceError> {
  return Result.gen(function* () {
    const id = yield* Result.mapError(decodeDocumentId(document.id), cause => new CorePersistenceError({ reason: "corruptData", cause }));
    const metadata = yield* Result.mapError(decodeCoreIndexMetadata(document.value), cause =>
      new CorePersistenceError({ reason: "corruptData", cause }));
    const tableId = Uint8Array.from(metadata.table_id.match(/../g) ?? [], value => Number.parseInt(value, 16));
    return captureCoreIndexRecord({ ref: { id: id.internalId,
      ...(metadata.config.persistenceIndexId === undefined ? {} : { persistenceIndexId: metadata.config.persistenceIndexId }) },
      tableId, name: metadata.descriptor, fields: metadata.config.fields, state: metadata.config.onDiskState, ts });
  });
}
