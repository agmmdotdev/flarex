import { Effect, Schema } from "effect";
import { copyBytes } from "@flarex/utils/bytes";
import { CanonicalNonNegativePostgresBigIntFromString } from "flarex-protocol/internal/postgres-bigint";
import { InternalDocumentIdSchema } from "flarex-protocol/document-id";
import { CorePersistenceError, type CoreDocumentLogEntry } from "../../core/contracts";

export const timestampSchema = Schema.Union([
  Schema.toType(CanonicalNonNegativePostgresBigIntFromString),
  CanonicalNonNegativePostgresBigIntFromString,
]);
export const internalIdSchema = InternalDocumentIdSchema;

const documentShape = {
  ts: timestampSchema,
  table_id: internalIdSchema,
  id: internalIdSchema,
  json_value: Schema.Uint8Array,
  deleted: Schema.Boolean,
  prev_ts: Schema.NullOr(timestampSchema),
};
export const documentRowSchema = Schema.Struct(documentShape);
export const documentRowsSchema = Schema.Array(documentRowSchema);

export const indexRowsSchema = Schema.Array(Schema.Struct({
  ts: timestampSchema,
  key_prefix: Schema.Uint8Array,
  key_suffix: Schema.NullOr(Schema.Uint8Array),
  key_sha256: Schema.Uint8Array.check(Schema.makeFilter(value =>
    value.byteLength === 32 ? undefined : "Expected a SHA-256 digest",
  )),
  deleted: Schema.Boolean,
  document_ts: Schema.NullOr(timestampSchema),
  table_id: Schema.NullOr(internalIdSchema),
  document_id: Schema.NullOr(internalIdSchema),
  json_value: Schema.NullOr(Schema.Uint8Array),
  document_deleted: Schema.NullOr(Schema.Boolean),
  prev_ts: Schema.NullOr(timestampSchema),
}));

export function makeStoredRowsDecoder<S extends Schema.Top>(schema: S) {
  const decode = Schema.decodeUnknownEffect(schema);
  return (input: unknown) => decode(input).pipe(Effect.mapError(cause =>
    new CorePersistenceError({ reason: "corruptData", cause }),
  ));
}

export const decodeDocumentRows = makeStoredRowsDecoder(documentRowsSchema);
export const decodeIndexRows = makeStoredRowsDecoder(indexRowsSchema);

export function documentFromRow(row: typeof documentRowSchema.Type): CoreDocumentLogEntry {
  return Object.freeze({
    ts: row.ts,
    tableId: copyBytes(row.table_id),
    id: copyBytes(row.id),
    jsonValue: row.deleted ? new Uint8Array() : copyBytes(row.json_value),
    deleted: row.deleted,
    prevTs: row.prev_ts,
  });
}
