import { Result, Schema } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import type { ProductEntityMetadata } from "./product-runtime-metadata";

export const decodeGraphArray = commerceDecoder(Schema.Array(Schema.Json), "invalidInput");
export const decodeProductProjection = commerceDecoder(Schema.Union([
  Schema.JsonObject, Schema.Array(Schema.JsonObject),
]), "storedCorruption");
export const decodeProductCount = commerceDecoder(Schema.Struct({
  rows: Schema.Array(Schema.JsonObject), count: Schema.Number,
}), "storedCorruption");
const decodeObject = commerceDecoder(Schema.JsonObject, "invalidInput");
const decodeId = commerceDecoder(Schema.UndefinedOr(Schema.String.check(Schema.isLengthBetween(1, 256))), "invalidInput");
const decodeOptionValues = commerceDecoder(Schema.Array(Schema.String), "invalidInput");
const decodeVariantOptions = commerceDecoder(Schema.Record(Schema.String, Schema.String), "invalidInput");
export const decodeVariantReference = commerceDecoder(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
), "invalidInput");

/** DML owns scalar names. These nested shapes select the supported service
 * profile, which differs from Medusa's HTTP/workflow creation validators. */
export function compileProductValueProfile(catalog: {
  product: ProductEntityMetadata; variant: ProductEntityMetadata; image: ProductEntityMetadata;
  option: ProductEntityMetadata; value: ProductEntityMetadata;
}) {
  const scalarNames = (entity: ProductEntityMetadata) => {
    const managed = ["created_at", "updated_at", "deleted_at", ...entity.table.foreignKeys.flatMap(key => key.columns)];
    return entity.table.columns.map(column => column.name).filter(name => !managed.includes(name));
  };
  const shape = (names: readonly string[], reason: "invalidInput" | "unsupportedProfile") =>
    commerceDecoder(Schema.Record(Schema.Literals(names), Schema.optionalKey(Schema.Json)), reason);
  const createRoot = shape([...scalarNames(catalog.product), "options", "variants", "images"], "unsupportedProfile");
  const createChildren = {
    options: shape(["title", "values"], "unsupportedProfile"),
    variants: shape([...scalarNames(catalog.variant), "options"], "unsupportedProfile"),
    images: shape(scalarNames(catalog.image), "unsupportedProfile"),
  };
  const relations = new Map([
    [catalog.product.table.name, ["images", "options", "variants"]],
    [catalog.option.table.name, ["values"]], [catalog.value.table.name, ["variants"]],
    [catalog.variant.table.name, []], [catalog.image.table.name, []],
  ]);
  const graphRows = new Map(Object.values(catalog).map(entity => [entity.table.name,
    shape([...entity.table.columns.map(column => column.name), ...relations.get(entity.table.name) ?? []], "invalidInput"),
  ]));
  return {
    validateCreate: (input: Json) => Result.gen(function* () {
      for (const product of Array.isArray(input) ? input : [input]) {
        const root = yield* createRoot(product);
        for (const relation of ["options", "variants", "images"] as const) {
          const children = root[relation];
          if (children === undefined) continue;
          for (const inputChild of yield* decodeGraphArray(children)) {
            const child = yield* createChildren[relation](inputChild);
            if (relation === "options" && child.values !== undefined) yield* decodeOptionValues(child.values);
            if (relation === "variants" && child.options !== undefined) yield* decodeVariantOptions(child.options);
          }
        }
      }
    }),
    decodeRow: (table: string, input: Json) => Result.gen(function* () {
      const supplied = yield* decodeObject(input);
      const decode = graphRows.get(table);
      if (decode === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      yield* decode(supplied);
      return { supplied, id: yield* decodeId(supplied.id) };
    }),
  };
}
