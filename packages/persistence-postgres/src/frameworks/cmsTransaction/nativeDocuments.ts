import { Effect, Option } from "effect";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { CoreNativeOperations } from "../../core/api";
import type { LogicalDocuments } from "../../storage/documents/logicalDocuments/ports";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError, cmsLimits, type CmsTransactionError } from "./model";
import { projectCoreCmsFailure } from "./nativeFailure";

const select = (where: JsonObject): Parameters<CoreNativeOperations["find"]>[1] | null => {
  const fields = Object.entries(where);
  if (fields.length === 0) return { kind: "all" };
  const field = fields[0];
  if (fields.length !== 1 || field === undefined || typeof field[1] !== "string") return null;
  return field[0] === "_id" ? { kind: "id", id: field[1] } : { kind: "equal", field: field[0], value: field[1] };
};

/** This translation owns no snapshot, working set, constraint or settlement. */
export function makeNativeCmsDocuments(operations: CoreNativeOperations, lifetime: CmsRequestLifetime): LogicalDocuments<CmsTransactionError> {
  const document = Effect.fn("NativeCmsDocuments.document")(function* (value: DocumentObject) {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(value, cmsLimits.documentBytes,
      (_reason, cause) => cmsError("storedCorruption", cause)));
    if (!isJsonObject(captured.value)) return yield* Effect.fail(cmsError("storedCorruption"));
    return captured.value;
  });
  const normalize = Effect.fn("NativeCmsDocuments.normalize")(function* (table: string | undefined, id: string) {
    if (table === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
    const normalized = yield* operations.normalizeId(table, id).pipe(Effect.mapError(projectCoreCmsFailure));
    if (Option.isNone(normalized)) return yield* Effect.fail(cmsError("invalidInput"));
    return normalized.value;
  });
  const get = Effect.fn("NativeCmsDocuments.get")(function* (table: string | undefined, id: string) {
    const found = yield* operations.get(yield* normalize(table, id)).pipe(Effect.mapError(projectCoreCmsFailure));
    return Option.isNone(found) ? null : yield* document(found.value);
  });
  const written = Effect.fn("NativeCmsDocuments.written")(function* (id: string) {
    const found = yield* operations.get(id).pipe(Effect.mapError(projectCoreCmsFailure));
    if (Option.isNone(found)) return yield* Effect.fail(cmsError("storedCorruption"));
    return yield* document(found.value);
  });
  return {
    get: (context, id, documentId, table) => lifetime.operation(context, id, "read", get(table, documentId)),
    getMany: (context, id) => lifetime.operation(context, id, "read", Effect.fail(cmsError("unsupportedProfile"))),
    find: (context, id, table, query) => lifetime.operation(context, id, "read", Effect.gen(function* () {
      const selection = select(query.where);
      if (selection === null) return yield* Effect.fail(cmsError("unsupportedProfile"));
      const found = yield* operations.find(table, selection).pipe(Effect.mapError(projectCoreCmsFailure));
      const ordered = found.toSorted((left, right) => String(left._id) < String(right._id) ? -1 : String(left._id) > String(right._id) ? 1 : 0);
      const docs = yield* Effect.forEach(ordered.slice(query.offset, query.offset + query.limit), document);
      return { docs, total: ordered.length };
    })),
    insert: (context, id, table, fields) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      return yield* written(yield* operations.insert(table, fields).pipe(Effect.mapError(projectCoreCmsFailure)));
    })),
    patch: (context, id, documentId, fields, table) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const selected = yield* normalize(table, documentId);
      yield* operations.patch(selected, fields).pipe(Effect.mapError(projectCoreCmsFailure));
      return yield* written(selected);
    })),
    replace: (context, id, documentId, fields, table) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const selected = yield* normalize(table, documentId);
      yield* operations.replace(selected, fields).pipe(Effect.mapError(projectCoreCmsFailure));
      return yield* written(selected);
    })),
    delete: (context, id, documentId, table) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      yield* operations.delete(yield* normalize(table, documentId)).pipe(Effect.mapError(projectCoreCmsFailure));
    })),
  };
}
