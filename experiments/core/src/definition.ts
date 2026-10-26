import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { CoreError } from "./errors.ts";
import { CatalogTableIdSchema } from "../../../packages/flarex-protocol/src/catalog.ts";
import { AppCreationTimeV1Schema } from "../../../packages/flarex-protocol/src/app-document.ts";
import { FiniteNumber, JsonValue } from "./value.ts";

export const Document = Schema.StructWithRest(Schema.Struct({
  id: Schema.String, createdAt: Schema.String, updatedAt: Schema.String,
}), [Schema.Record(Schema.String, JsonValue)]);
export type Document = typeof Document.Type;
export const Field = Schema.Struct({ name: Schema.String, kind: Schema.Literals(["text", "number"]), unique: Schema.Boolean });
export type Field = Readonly<typeof Field.Type>;
export const NumericIndex = Schema.Struct({ name: Schema.String, field: Schema.String });
export type NumericIndex = Readonly<typeof NumericIndex.Type>;

/** The first profile admits required scalar fields and native timestamps only. */
export function compileDefinition(input: { readonly table: string; readonly tableId?: number; readonly fields: readonly Field[]; readonly indexes?: readonly NumericIndex[] }) {
  if (input.tableId !== undefined && !Schema.is(CatalogTableIdSchema)(input.tableId)) return Result.fail(new CoreError({ reason: "unsupported" }));
  const fields: Field[] = [];
  const codecs = new Map<string, Schema.Codec<Schema.Json>>([
    ["id", Schema.String], ["createdAt", Schema.String], ["updatedAt", Schema.String],
  ]);
  if (input.tableId !== undefined) codecs.set("systemCreationTime", AppCreationTimeV1Schema);
  for (const field of input.fields) {
    if ((field.unique && field.kind !== "text") || codecs.has(field.name)) {
      return Result.fail(new CoreError({ reason: "unsupported" }));
    }
    fields.push(Object.freeze({ ...field }));
    codecs.set(field.name, field.kind === "text" ? Schema.String : FiniteNumber);
  }
  const shape = Schema.Struct(Object.fromEntries(codecs));
  const indexes = (input.indexes ?? []).map(index => Object.freeze({ ...index }));
  if (indexes.length !== 0 && input.tableId === undefined || new Set(indexes.map(index => index.name)).size !== indexes.length ||
    indexes.some(index => !fields.some(field => field.name === index.field && field.kind === "number"))) {
    return Result.fail(new CoreError({ reason: "unsupported" }));
  }
  const tableId = input.tableId ?? null;
  const identity = JSON.stringify({ table: input.table, tableId, fields, indexes, timestamps: true });
  return Result.succeed(Object.freeze({
    table: input.table,
    tableId,
    version: createHash("sha256").update(identity).digest("hex"),
    fields: Object.freeze(fields),
    indexes: Object.freeze(indexes),
    decode: (value: unknown) => Schema.decodeUnknownEffect(shape)(value, { onExcessProperty: "error" }).pipe(
      Effect.flatMap(body => Schema.decodeUnknownEffect(Document)(body)),
      Effect.mapError(cause => new CoreError({ reason: "invalid", cause })),
    ),
  }));
}
export type Definition = Result.Result.Success<ReturnType<typeof compileDefinition>>;

/** Selected scalar definitions have already decoded these fields. Violating
 * that owned invariant is a defect, never a value to coerce. */
export function numericField(body: Document, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid decoded numeric field: ${field}`);
  return value;
}

export function uniqueKeys(definition: Definition, document: Document) {
  return definition.fields.filter(field => field.unique).map(field => ({
    field: field.name,
    key: JSON.stringify(document[field.name]),
  }));
}
