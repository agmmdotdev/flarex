import { Effect, Option, Schema } from "effect";
import type { DocumentObject } from "flarex-protocol/document-value";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { CoreNativeOperations } from "../../core/api";
import type { LogicalDocuments } from "../../storage/documents/logicalDocuments/ports";
import { capturePrivateJsonData, useCapturedPrivateJsonData } from "../../values/privateJsonData";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError, cmsLimits, type CmsTransactionError } from "./model";
import { nativeResult } from "./nativeFailure";
const decodeBatchIds = Schema.decodeUnknownEffect(Schema.Array(Schema.String).check(Schema.makeFilter(ids =>
  new Set(ids).size === ids.length ? undefined : "CMS batch identities must be distinct")));
const decodeCanonicalBatchIds = Schema.decodeUnknownEffect(Schema.Array(DeveloperDocumentIdSchema).check(Schema.makeFilter(ids =>
  new Set(ids).size === ids.length ? undefined : "CMS batch identities must be distinct")));
export type NativeCmsWriteAuthorization = (transition: Readonly<{
  operation: "insert" | "patch" | "replace" | "delete"; table: string; id?: string; before: JsonObject | null; fields?: unknown;
}>) => Effect.Effect<(id: string) => void, CmsTransactionError>;

/** This translation owns no snapshot, working set, constraint or settlement. */
export function makeNativeCmsDocuments(operations: CoreNativeOperations, lifetime: CmsRequestLifetime,
  authorize?: NativeCmsWriteAuthorization): LogicalDocuments<CmsTransactionError> {
  const document = Effect.fn("NativeCmsDocuments.document")(function* (value: DocumentObject) {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(value, cmsLimits.documentBytes,
      (_reason, cause) => cmsError("storedCorruption", cause)));
    if (!isJsonObject(captured.value)) return yield* Effect.fail(cmsError("storedCorruption"));
    return captured.value;
  });
  const normalize = Effect.fn("NativeCmsDocuments.normalize")(function* (table: string | undefined, id: string) {
    if (table === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
    const normalized = yield* nativeResult(operations.normalizeId(table, id));
    if (Option.isNone(normalized)) return yield* Effect.fail(cmsError("invalidInput"));
    return normalized.value;
  });
  const get = Effect.fn("NativeCmsDocuments.get")(function* (table: string | undefined, id: string) {
    const found = yield* nativeResult(operations.get(yield* normalize(table, id)));
    return Option.isNone(found) ? null : yield* document(found.value);
  });
  const written = Effect.fn("NativeCmsDocuments.written")(function* (id: string) {
    const found = yield* nativeResult(operations.get(id));
    if (Option.isNone(found)) return yield* Effect.fail(cmsError("storedCorruption"));
    return yield* document(found.value);
  });
  return {
    validateIds: Effect.fn("NativeCmsDocuments.validateIds")((context, id, table, ids) => lifetime.operation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(ids, lifetime.remainingBytes(), cmsError));
      if (!Array.isArray(captured.value) || captured.value.length > cmsLimits.pageRows)
        return yield* Effect.fail(cmsError("limitExceeded"));
      // Capture and validate the entire canonical batch before importing even
      // metadata dependencies. Core normalization supplies table authority only.
      const batch = yield* decodeCanonicalBatchIds(captured.value).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      yield* lifetime.fromResult(lifetime.charge(captured.bytes));
      // Empty batches still authenticate the named table; normalization of an
      // absent ID records metadata only and does not observe row absence.
      if (batch.length === 0) yield* nativeResult(operations.normalizeId(table, undefined));
      for (const documentId of batch) {
        if ((yield* normalize(table, documentId)) !== documentId) return yield* Effect.fail(cmsError("invalidInput"));
      }
    }))),
    get: (context, id, documentId, table) => lifetime.operation(context, id, "read", get(table, documentId)),
    getMany: Effect.fn("NativeCmsDocuments.getMany")((context, id, table, ids) => lifetime.operation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(ids, lifetime.remainingBytes(), cmsError));
      if (!Array.isArray(captured.value) || captured.value.length > cmsLimits.pageRows)
        return yield* Effect.fail(cmsError("limitExceeded"));
      const batch = yield* decodeBatchIds(captured.value).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      // Core charges this immutable batch once and validates every typed ID
      // before reading; this port owns its narrower per-call shape and bound.
      const values = yield* nativeResult(operations.getMany(table, Object.freeze(batch)));
      return yield* Effect.forEach(values, value => value === null ? Effect.succeed(null) : document(value));
    }))),
    find: (context, id, table, query) => lifetime.operation(context, id, "read", Effect.gen(function* () {
      const found = yield* nativeResult(operations.find(table, query.where));
      const ordered = found.toSorted((left, right) => String(left._id) < String(right._id) ? -1 : String(left._id) > String(right._id) ? 1 : 0);
      const docs = yield* Effect.forEach(ordered.slice(query.offset, query.offset + query.limit), document);
      return { docs, total: ordered.length };
    })),
    insert: (context, id, table, fields) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const accepted = authorize === undefined ? undefined : yield* authorize({ operation: "insert", table, before: null, fields });
      const inserted = yield* nativeResult(operations.insert(table, fields));
      accepted?.(inserted);
      return yield* written(inserted);
    })),
    patch: (context, id, documentId, fields, table) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const selected = yield* normalize(table, documentId);
      const accepted = authorize === undefined || table === undefined ? undefined
        : yield* authorize({ operation: "patch", table, id: selected, before: yield* get(table, selected), fields });
      yield* nativeResult(operations.patch(selected, fields));
      accepted?.(selected);
      return yield* written(selected);
    })),
    replace: (context, id, documentId, fields, table) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const selected = yield* normalize(table, documentId);
      const accepted = authorize === undefined || table === undefined ? undefined
        : yield* authorize({ operation: "replace", table, id: selected, before: yield* get(table, selected), fields });
      yield* nativeResult(operations.replace(selected, fields));
      accepted?.(selected);
      return yield* written(selected);
    })),
    delete: (context, id, documentId, table) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const selected = yield* normalize(table, documentId);
      const accepted = authorize === undefined || table === undefined ? undefined
        : yield* authorize({ operation: "delete", table, id: selected, before: null });
      yield* nativeResult(operations.delete(selected));
      accepted?.(selected);
    })),
  };
}
