/** Native membership records use ordinary Source documents and scalar indexes.
 * The source array is the only authority for forward order. */
import { Result, Schema } from "effect";
import { DeveloperDocumentIdSchema, decodeDocumentId } from "flarex-protocol/document-id";
import type { DocumentObject } from "flarex-protocol/document-value";
import { CoreTransactionError, type CoreError, type CoreTableDefinition } from "./api";
import { CorePersistenceError } from "./contracts";
import type { CoreNativeReference } from "./nativePolicy";

export type CoreNativeManyReference = Extract<CoreNativeReference, { readonly projection: unknown }>;

export function isCoreNativeManyReference(reference: CoreNativeReference): reference is CoreNativeManyReference {
  return "projection" in reference;
}

const decodeManyIds = Schema.decodeUnknownResult(Schema.Array(DeveloperDocumentIdSchema).check(
  Schema.isMaxLength(32), Schema.makeFilter(ids => new Set(ids).size === ids.length ? undefined : "Native members must be distinct")));
const decodeMembership = Schema.decodeUnknownResult(Schema.Struct({
  _id: DeveloperDocumentIdSchema, _creationTime: Schema.Number,
  sourceId: DeveloperDocumentIdSchema, targetId: DeveloperDocumentIdSchema,
}).annotate({ parseOptions: { onExcessProperty: "error" } }));

/** Structural/canonical ID admission precedes any target-liveness preparation. */
export function coreNativeManyTargets(reference: CoreNativeManyReference, target: CoreTableDefinition,
  document: DocumentObject): Result.Result<readonly string[], CoreError> {
  return Result.gen(function* () {
    const ids = yield* Result.mapError(decodeManyIds(document[reference.field]),
      cause => new CoreTransactionError({ reason: "documentValidation", cause }));
    for (const id of ids) {
      const decoded = yield* Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "documentValidation", cause }));
      if (decoded.tableNumber !== target.number)
        return yield* Result.fail(new CoreTransactionError({ reason: "documentValidation" }));
    }
    return Object.freeze(ids);
  });
}

/** Table/role/index authentication is the selection owner's responsibility.
 * Returned records additionally prove their complete body and endpoint IDs. */
export function readCoreNativeMembership(tables: Readonly<{
  source: CoreTableDefinition; target: CoreTableDefinition; membership: CoreTableDefinition;
}>, document: DocumentObject): Result.Result<Readonly<{ id: string; sourceId: string; targetId: string }>, CoreError> {
  return Result.gen(function* () {
    const value = yield* Result.mapError(decodeMembership(document), cause => new CorePersistenceError({ reason: "corruptData", cause }));
    for (const [id, table] of [[value._id, tables.membership], [value.sourceId, tables.source], [value.targetId, tables.target]] as const) {
      const decoded = yield* Result.mapError(decodeDocumentId(id), cause => new CorePersistenceError({ reason: "corruptData", cause }));
      if (decoded.tableNumber !== table.number)
        return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
    }
    return Object.freeze({ id: value._id, sourceId: value.sourceId, targetId: value.targetId });
  });
}
