import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { CoreError } from "./errors.ts";

export const Document = Schema.StructWithRest(Schema.Struct({
  id: Schema.String, createdAt: Schema.String, updatedAt: Schema.String,
}), [Schema.Record(Schema.String, Schema.Json)]);
export type Document = typeof Document.Type;
export const Field = Schema.Struct({ name: Schema.String, kind: Schema.Literals(["text", "number"]), unique: Schema.Boolean });
export type Field = Readonly<typeof Field.Type>;

/** The first profile admits required scalar fields and native timestamps only. */
export function compileDefinition(input: { readonly table: string; readonly fields: readonly Field[] }) {
  const fields: Field[] = [];
  const codecs = new Map<string, Schema.Codec<Schema.Json>>([
    ["id", Schema.String], ["createdAt", Schema.String], ["updatedAt", Schema.String],
  ]);
  for (const field of input.fields) {
    if ((field.unique && field.kind !== "text") || codecs.has(field.name)) {
      return Result.fail(new CoreError({ reason: "unsupported" }));
    }
    fields.push(Object.freeze({ ...field }));
    codecs.set(field.name, field.kind === "text" ? Schema.String : Schema.Number.check(Schema.isFinite()));
  }
  const shape = Schema.Struct(Object.fromEntries(codecs));
  const identity = JSON.stringify({ table: input.table, fields, timestamps: true });
  return Result.succeed(Object.freeze({
    table: input.table,
    version: createHash("sha256").update(identity).digest("hex"),
    fields: Object.freeze(fields),
    decode: (value: unknown) => Schema.decodeUnknownEffect(shape)(value, { onExcessProperty: "error" }).pipe(
      Effect.flatMap(body => Schema.decodeUnknownEffect(Document)(body)),
      Effect.mapError(cause => new CoreError({ reason: "invalid", cause })),
    ),
  }));
}
export type Definition = Result.Result.Success<ReturnType<typeof compileDefinition>>;

export function uniqueKeys(definition: Definition, document: Document) {
  return definition.fields.filter(field => field.unique).map(field => ({
    field: field.name,
    key: JSON.stringify(document[field.name]),
  }));
}
