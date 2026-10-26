import { Effect, Schema } from "effect";
import { compileProductDefinition, productModels } from "../../../packages/medusa-adapter/src/modules/product/definition.ts";
import { compileCompleteRow } from "../../../packages/medusa-adapter/src/value/complete-row.ts";
import { captureCommerceInput } from "../../../packages/medusa-adapter/src/value/input.ts";
import { compileDefinition, type Field, type Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
const Update = Schema.Struct({ title: Schema.String });

/** Reuse checked executing DML compilation and native complete-row decoding.
 * Installation/authority and the physical layout stay with the new core. */
export const prepareProductDefinition = Effect.fn("ExperimentProduct.definition")(function* () {
  const captured = yield* compileProductDefinition().pipe(Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
  const table = captured.metadata.tables.find(candidate => candidate.name === "product");
  if (table === undefined) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
  const complete = yield* Effect.fromResult(compileCompleteRow(table)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
  const fields: Field[] = [];
  for (const column of table.columns) {
    if (["id", "created_at", "updated_at"].includes(column.name)) continue;
    const kind = column.type === "text" || column.type === "id" || column.type === "enum" || column.type === "dateTime" ? "text"
      : column.type === "number" || column.type === "float" ? "number" : column.type === "boolean" ? "boolean" : column.type === "json" ? "json" : null;
    if (kind === null) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
    fields.push({ name: column.name, kind, nullable: column.nullable, unique: column.name === "handle",
      ...(column.options?.choices === undefined ? {} : { choices: column.options.choices }) });
  }
  const definition = yield* Effect.fromResult(compileDefinition({ table: "product", fields }));
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
  const validateUpdate = Effect.fn("ExperimentProduct.updateInput")(function* (value: unknown) {
    const input = yield* Effect.fromResult(captureCommerceInput(value)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
    return yield* Schema.decodeUnknownEffect(Update)(input, { onExcessProperty: "error" }).pipe(Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
  });
  return { definition, table, models: productModels, capture, toDocument, toNative, seed,
    validateUpdate,
  };
});
export type ProductDefinition = Effect.Success<ReturnType<typeof prepareProductDefinition>>;
