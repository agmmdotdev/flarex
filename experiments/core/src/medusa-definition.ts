import { Effect, Schema } from "effect";
import { compileProductDefinition, productModels } from "../../../packages/medusa-adapter/src/modules/product/definition.ts";
import { compileCompleteRow, compileRowProjection } from "../../../packages/medusa-adapter/src/value/complete-row.ts";
import { captureCommerceInput } from "../../../packages/medusa-adapter/src/value/input.ts";
import { ProductStatus } from "@medusajs/framework/utils/portable";
import { compileDefinition, type Field, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { captureJsonInput, IndexedText, JsonValue } from "./value.ts";
const Update = Schema.Struct({ title: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(IndexedText), status: Schema.optionalKey(Schema.Literals(Object.values(ProductStatus))) });
const UpdateInvocation = Schema.Struct({ id: IndexedText, data: Update });
const ResultProjection = Schema.StructWithRest(Schema.Struct({ options: Schema.Tuple([]), tags: Schema.Tuple([]), collection: Schema.Null, type: Schema.Null }),
  [Schema.Record(Schema.String, JsonValue)]);
const ReadProjection = Schema.StructWithRest(Schema.Struct({ collection: Schema.Null, type: Schema.Null }), [Schema.Record(Schema.String, JsonValue)]);

/** Reuse checked executing DML compilation and native complete-row decoding.
 * Installation/authority and the physical layout stay with the new core. */
export const prepareProductDefinition = Effect.fn("ExperimentProduct.definition")(function* () {
  const captured = yield* compileProductDefinition().pipe(Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
  const table = captured.metadata.tables.find(candidate => candidate.name === "product");
  if (table === undefined) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
  const complete = yield* Effect.fromResult(compileCompleteRow(table)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
  const updateValues = yield* Effect.fromResult(compileRowProjection({ ...table, columns: table.columns.filter(column => ["title", "handle", "status"].includes(column.name)) }))
    .pipe(Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
  const fields: Field[] = [];
  for (const column of table.columns) {
    if (["id", "created_at", "updated_at"].includes(column.name)) continue;
    const kind = column.type === "text" || column.type === "id" || column.type === "enum" || column.type === "dateTime" ? "text"
      : column.type === "number" || column.type === "float" ? "number" : column.type === "boolean" ? "boolean" : column.type === "json" ? "json" : null;
    if (kind === null) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    fields.push({ name: column.name, kind, nullable: column.nullable, unique: column.name === "handle",
      ...(column.options?.choices === undefined ? {} : { choices: column.options.choices }) });
  }
  const definition = yield* Effect.fromResult(compileDefinition({ table: "product", fields, equalities: [{ name: "by_handle", field: "handle" }] }));
  const capture = (value: unknown) => Effect.fromResult(complete(value)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })),
    Effect.flatMap(row => row.deleted_at !== null || row.type_id !== null || row.collection_id !== null
      ? Effect.fail(new CoreError({ reason: "unsupported" })) : Effect.succeed(structuredClone(row))));
  const toDocument = (value: unknown) => capture(value).pipe(Effect.flatMap(row => {
    const { created_at, updated_at, ...values } = row;
    return definition.decode({ ...values, createdAt: created_at, updatedAt: updated_at });
  }));
  const toNative = (document: Document) => {
    const { createdAt, updatedAt, ...values } = document;
    return capture({ ...values, created_at: createdAt, updated_at: updatedAt });
  };
  const seed = Effect.fn("ExperimentProduct.seedValue")(function* (id: string, title: string, timestamp: string) {
    const row = { id, title, handle: id.replaceAll("_", "-"), created_at: timestamp, updated_at: timestamp } satisfies Record<string, Schema.Json>;
    const defaults = new Map<string, Schema.Json>();
    for (const column of table.columns) {
      if (Object.hasOwn(row, column.name)) continue;
      if (column.defaultValue !== undefined && typeof column.defaultValue !== "object") defaults.set(column.name, column.defaultValue);
      else if (column.nullable) defaults.set(column.name, null);
      else return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    }
    return yield* toDocument({ ...Object.fromEntries(defaults), ...row });
  });
  const validateUpdate = Effect.fn("ExperimentProduct.updateInput")(function* (id: string, value: unknown) {
    const native = yield* Effect.fromResult(captureCommerceInput({ id, data: value })).pipe(
      Effect.mapError(cause => new CoreError({ reason: cause.reason === "limitExceeded" ? "limit" : "invalid", cause })));
    // Native omission happens before the stricter experimental envelope. The
    // value owner reuses issued capture facts; caller descriptors run once.
    const input = yield* Effect.fromResult(captureJsonInput(native, true));
    const invocation = yield* Schema.decodeUnknownEffect(UpdateInvocation)(input, { onExcessProperty: "error" }).pipe(
      Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
    if (Object.keys(invocation.data).length === 0) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    yield* Effect.fromResult(updateValues(invocation.data)).pipe(Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
    return invocation;
  });
  const decodeResult = Effect.fn("ExperimentProduct.result")(function* (value: unknown) {
    const input = yield* Effect.fromResult(captureCommerceInput(value)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    const projected = yield* Schema.decodeUnknownEffect(ResultProjection)(input).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    const { options: _options, tags: _tags, collection: _collection, type: _type, ...row } = projected;
    const result: Schema.JsonObject = { ...yield* capture(row), options: [], tags: [], collection: null, type: null };
    return result;
  });
  const decodeReadResult = Effect.fn("ExperimentProduct.readResult")(function* (value: unknown) {
    const input = yield* Effect.fromResult(captureCommerceInput(value)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    const projected = yield* Schema.decodeUnknownEffect(ReadProjection)(input).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    const { collection: _collection, type: _type, ...row } = projected;
    const result: Schema.JsonObject = { ...yield* capture(row), collection: null, type: null }; return result;
  });
  return { definition, table, models: productModels, capture, toDocument, toNative, seed,
    validateUpdate, decodeResult, decodeReadResult,
  };
});
export type ProductDefinition = Effect.Success<ReturnType<typeof prepareProductDefinition>>;
