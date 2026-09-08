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
const decodeUpdatePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(256)), "invalidInput");
export const decodeRelatedUpdate = commerceDecoder(Schema.Struct({
  id: Schema.String.check(Schema.isLengthBetween(1, 256)), data: Schema.JsonObject,
}), "invalidInput");
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
  tag: ProductEntityMetadata; type: ProductEntityMetadata; collection: ProductEntityMetadata;
}) {
  const scalarNames = (entity: ProductEntityMetadata) => {
    const managed = ["created_at", "updated_at", "deleted_at", ...entity.table.foreignKeys.flatMap(key => key.columns)];
    return entity.table.columns.map(column => column.name).filter(name => !managed.includes(name));
  };
  const shape = (names: readonly string[], reason: "invalidInput" | "unsupportedProfile") =>
    commerceDecoder(Schema.Record(Schema.Literals(names), Schema.optionalKey(Schema.Json)), reason);
  const createRoot = shape([...scalarNames(catalog.product), "options", "variants", "images", "tag_ids", "collection_id", "type_id"], "unsupportedProfile");
  const decodeIds = commerceDecoder(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isMaxLength(256)), "invalidInput");
  const decodeReference = commerceDecoder(Schema.NullOr(Schema.String.check(Schema.isLengthBetween(1, 256))), "invalidInput");
  const standalone = new Map([catalog.tag, catalog.type, catalog.collection, catalog.image].map(entity => [entity.table.name,
    shape([...scalarNames(entity), ...(entity === catalog.image ? ["product_id"] : [])], "unsupportedProfile"),
  ]));
  const updateData = new Map([catalog.tag, catalog.type].map(entity => [entity.table.name,
    shape(scalarNames(entity).filter(name => name !== "id"), "unsupportedProfile"),
  ]));
  const createChildren = {
    options: shape(["title", "values"], "unsupportedProfile"),
    variants: shape([...scalarNames(catalog.variant), "options"], "unsupportedProfile"),
    images: shape(scalarNames(catalog.image), "unsupportedProfile"),
  };
  const relations = new Map([
    [catalog.product.table.name, ["images", "options", "variants", "tags"]],
    [catalog.option.table.name, ["values"]], [catalog.value.table.name, ["variants"]],
    [catalog.variant.table.name, []], [catalog.image.table.name, []],
  ]);
  const graphRows = new Map(Object.values(catalog).map(entity => [entity.table.name,
    shape([...entity.table.columns.map(column => column.name), ...relations.get(entity.table.name) ?? []], "invalidInput"),
  ]));
  return {
    validateRelatedChange: (table: string, input: Json) => Result.gen(function* () {
      const decode = standalone.get(table);
      if (decode === undefined || !updateData.has(table)) return yield* Result.fail(commerceError("unsupportedProfile"));
      const inputs = Array.isArray(input) ? input : [input];
      if (inputs.length > 256) return yield* Result.fail(commerceError("limitExceeded"));
      const ids = new Set<string>();
      for (const row of inputs) {
        const value = yield* decode(row);
        const id = yield* decodeId(value.id);
        if (id !== undefined) {
          if (ids.has(id)) return yield* Result.fail(commerceError("invalidInput"));
          ids.add(id);
        }
      }
    }),
    validateRelatedUpdateData: (table: string, input: Json) => {
      const decode = updateData.get(table);
      return decode === undefined ? Result.fail(commerceError("unsupportedProfile")) : decode(input);
    },
    decodeRelatedUpdatePairs: (table: string, input: Json) => Result.gen(function* () {
      const decode = updateData.get(table);
      const decodeEntity = graphRows.get(table);
      if (decode === undefined || decodeEntity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const rows = [];
      const ids = new Set<string>();
      for (const pair of yield* decodeUpdatePairs(input)) {
        const entity = yield* decodeEntity(pair.entity);
        const id = yield* decodeId(entity.id);
        if (id === undefined || ids.has(id) || (pair.update.id !== undefined && pair.update.id !== id)) return yield* Result.fail(commerceError("invalidInput"));
        ids.add(id);
        const { id: selectedId, ...data } = pair.update;
        yield* decode(data);
        rows.push({ ...data, id });
      }
      return rows;
    }),
    validateCreate: (input: Json) => Result.gen(function* () {
      for (const product of Array.isArray(input) ? input : [input]) {
        const root = yield* createRoot(product);
        if (root.tag_ids !== undefined) yield* decodeIds(root.tag_ids);
        for (const name of ["collection_id", "type_id"]) if (root[name] !== undefined) yield* decodeReference(root[name]);
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
    validateRelatedCreate: (table: string, input: Json) => Result.gen(function* () {
      const decode = standalone.get(table);
      if (decode === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const inputs = Array.isArray(input) ? input : [input];
      if (inputs.length > 256) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of inputs) {
        const value = yield* decode(row);
        yield* decodeId(value.id);
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
