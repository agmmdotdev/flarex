import { Effect } from "effect";
import { describeToManyRelation, type ToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceRelations } from "./commerce-relations";
import { Product, ProductOption, ProductOptionValue, ProductVariant, ProductImage } from "@medusajs/product/models";
import { buildModuleResourceEventName, camelToSnakeCase, CommonEvents, Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { productModels, type captureProductSchema } from "./product-schema";

export type ProductMetadata = Effect.Success<ReturnType<typeof captureProductSchema>>["metadata"]["frame"];
type Table = ProductMetadata["tables"][number];
export interface ProductEntityMetadata {
  readonly table: Table;
  readonly model: string;
  readonly prefix: string | undefined;
  readonly eventObject: string;
  readonly createdEvent: string;
}
export interface ProductRuntimeMetadata {
  readonly product: ProductEntityMetadata;
  readonly option: ProductEntityMetadata;
  readonly value: ProductEntityMetadata;
  readonly variant: ProductEntityMetadata;
  readonly image: ProductEntityMetadata;
  readonly entities: readonly ProductEntityMetadata[];
  readonly foreignKeys: { readonly option: string; readonly value: string; readonly variant: string; readonly image: string };
  readonly pivot: { readonly table: Table; readonly variantColumn: string; readonly valueColumn: string };
  readonly queryRelations: CommerceRelations;
}

/** Select admitted model objects; identities, columns, prefixes and joins stay
 * owned by the pinned DML compiler. Its entity tables preserve input order. */
export const productRuntimeMetadata = Effect.fn("ProductAdapter.runtimeMetadata")(function* (metadata: ProductMetadata) {
  const entity = Effect.fn("ProductAdapter.entityMetadata")(function* (model: typeof productModels[number]) {
    const table = metadata.tables[productModels.indexOf(model)];
    const primary = table?.columns.filter(column => column.primaryKey);
    if (table === undefined || primary?.length !== 1 || primary[0]?.name !== "id" || primary[0].type !== "id") return yield* Effect.fail(commerceError("unsupportedProfile"));
    const eventObject: string = camelToSnakeCase(model.name);
    return { table, model: model.name, prefix: primary[0].options?.prefix, eventObject,
      createdEvent: buildModuleResourceEventName({ prefix: Modules.PRODUCT, objectName: eventObject, action: CommonEvents.CREATED }),
    } satisfies ProductEntityMetadata;
  });
  const product = yield* entity(Product);
  const option = yield* entity(ProductOption);
  const value = yield* entity(ProductOptionValue);
  const variant = yield* entity(ProductVariant);
  const image = yield* entity(ProductImage);
  const foreignKey = Effect.fn("ProductAdapter.foreignKey")(function* (from: ProductEntityMetadata, to: ProductEntityMetadata) {
    const joins = from.table.relationships.filter(relation => relation.type === "belongsTo" && relation.targetModel === to.model);
    const columns = joins[0]?.foreignKeyNames;
    if (joins.length !== 1 || columns?.length !== 1 || columns[0] === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return columns[0];
  });
  const link = variant.table.relationships.find(relation => relation.name === "options" && relation.type === "manyToMany" && relation.targetModel === value.model);
  const pivot = metadata.tables.find(table => table.name === link?.pivotTable);
  if (pivot === undefined || link?.joinColumns?.length !== 1 || link.inverseJoinColumns?.length !== 1 || link.joinColumns[0] === undefined || link.inverseJoinColumns[0] === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const queryRelations = new Map<string, Map<string, ToManyRelation>>();
  for (const path of productRelations) {
    let source = product.table;
    for (const name of path.split(".")) {
      const descriptor = describeToManyRelation(source, name, metadata.tables);
      const target = metadata.tables.find(table => table.name === descriptor?.targetTable);
      if (descriptor === undefined || target === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const declared = queryRelations.get(source.name) ?? new Map<string, ToManyRelation>();
      declared.set(name, descriptor);
      queryRelations.set(source.name, declared);
      source = target;
    }
  }
  return { product, option, value, variant, image, entities: [product, option, value, variant, image],
    foreignKeys: { option: yield* foreignKey(option, product), value: yield* foreignKey(value, option), variant: yield* foreignKey(variant, product), image: yield* foreignKey(image, product) },
    pivot: { table: pivot, variantColumn: link.joinColumns[0], valueColumn: link.inverseJoinColumns[0] }, queryRelations,
  } satisfies ProductRuntimeMetadata;
});

/** Supported service query paths are capability policy, not a second schema. */
export const productRelations = Object.freeze(["images", "options", "options.values", "variants", "variants.options"]);
