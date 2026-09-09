import { Effect } from "effect";
import { makeReadCatalog, type ReadCatalog } from "./query/catalog";
import { productRelatedReadProfiles, type RelatedReadProfile } from "./product-read-profile";
import { compileProductValueProfile } from "./product-value-profile";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceRelations, CommerceRelation } from "./commerce-relations";
import { Product, ProductOption, ProductOptionValue, ProductVariant, ProductImage, ProductTag, ProductType, ProductCollection, ProductCategory, ProductVariantProductImage } from "@medusajs/product/models";
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
  readonly updatedEvent: string;
  readonly deletedEvent: string;
  readonly restoredEvent: string;
}
export interface ProductRuntimeMetadata {
  readonly readCatalog: ReadCatalog;
  readonly relatedReads: ReadonlyMap<string, RelatedReadProfile>;
  readonly product: ProductEntityMetadata;
  readonly searchableProductColumns: readonly string[];
  readonly option: ProductEntityMetadata;
  readonly value: ProductEntityMetadata;
  readonly variant: ProductEntityMetadata;
  readonly image: ProductEntityMetadata;
  readonly tag: ProductEntityMetadata;
  readonly type: ProductEntityMetadata;
  readonly collection: ProductEntityMetadata;
  readonly category: ProductEntityMetadata;
  readonly assignment: ProductEntityMetadata;
  readonly entities: readonly ProductEntityMetadata[];
  readonly tables: readonly Table[];
  readonly writablePivots: readonly Table[];
  readonly foreignKeys: { readonly option: string; readonly value: string; readonly variant: string; readonly image: string };
  readonly pivot: { readonly table: Table; readonly variantColumn: string; readonly valueColumn: string };
  readonly queryRelations: CommerceRelations;
  readonly valueProfile: ReturnType<typeof compileProductValueProfile>;
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
      updatedEvent: buildModuleResourceEventName({ prefix: Modules.PRODUCT, objectName: eventObject, action: CommonEvents.UPDATED }),
      deletedEvent: buildModuleResourceEventName({ prefix: Modules.PRODUCT, objectName: eventObject, action: CommonEvents.DELETED }),
      restoredEvent: buildModuleResourceEventName({ prefix: Modules.PRODUCT, objectName: eventObject, action: CommonEvents.RESTORED }),
    } satisfies ProductEntityMetadata;
  });
  const product = yield* entity(Product);
  const searchableProductColumns: string[] = [];
  for (const [name, property] of Object.entries(Product.parse().schema)) {
    const parsed = property.parse(name);
    if (!("dataType" in parsed) || !parsed.dataType.options?.searchable) continue;
    const column = product.table.columns.find(column => column.name === name);
    if (column?.type !== "text") return yield* Effect.fail(commerceError("unsupportedProfile"));
    searchableProductColumns.push(name);
  }
  const option = yield* entity(ProductOption);
  const value = yield* entity(ProductOptionValue);
  const variant = yield* entity(ProductVariant);
  const image = yield* entity(ProductImage);
  const tag = yield* entity(ProductTag);
  const type = yield* entity(ProductType);
  const collection = yield* entity(ProductCollection);
  const category = yield* entity(ProductCategory);
  const assignment = yield* entity(ProductVariantProductImage);
  const foreignKey = Effect.fn("ProductAdapter.foreignKey")(function* (from: ProductEntityMetadata, to: ProductEntityMetadata) {
    const joins = from.table.relationships.filter(relation => relation.type === "belongsTo" && relation.targetModel === to.model);
    const columns = joins[0]?.foreignKeyNames;
    if (joins.length !== 1 || columns?.length !== 1 || columns[0] === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return columns[0];
  });
  const link = variant.table.relationships.find(relation => relation.name === "options" && relation.type === "manyToMany" && relation.targetModel === value.model);
  const pivot = metadata.tables.find(table => table.name === link?.pivotTable);
  if (pivot === undefined || link?.joinColumns?.length !== 1 || link.inverseJoinColumns?.length !== 1 || link.joinColumns[0] === undefined || link.inverseJoinColumns[0] === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const queryRelations = new Map<string, Map<string, CommerceRelation>>();
  for (const path of productRelations) {
    let source = product.table;
    for (const name of path.split(".")) {
      const relation = source.relationships.find(item => item.name === name);
      const targetEntity = [collection, type].find(item => item.model === relation?.targetModel);
      const descriptor: CommerceRelation | undefined = relation?.type === "belongsTo" && targetEntity !== undefined
        ? { name, sourcePrimaryKeys: ["id"], targetTable: targetEntity.table.name, targetPrimaryKeys: ["id"],
          join: { type: "belongsTo", foreignKeys: [yield* foreignKey(product, targetEntity)] } }
        : describeToManyRelation(source, name, metadata.tables);
      const target = metadata.tables.find(table => table.name === descriptor?.targetTable);
      if (descriptor === undefined || target === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const declared = queryRelations.get(source.name) ?? new Map<string, CommerceRelation>();
      declared.set(name, descriptor);
      queryRelations.set(source.name, declared);
      source = target;
    }
  }
  const tagRelation = queryRelations.get(product.table.name)?.get("tags");
  const categoryRelation = queryRelations.get(product.table.name)?.get("categories");
  const tagPivot = metadata.tables.find(table => tagRelation?.join.type === "manyToMany" && table.name === tagRelation.join.pivotTable);
  const categoryPivot = metadata.tables.find(table => categoryRelation?.join.type === "manyToMany" && table.name === categoryRelation.join.pivotTable);
  if (tagPivot === undefined || categoryPivot === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  // Additional paths are internal service capabilities, derived from the same DML.
  for (const [source, names] of [[option, ["values"]], [variant, ["options", "images"]], [image, ["variants"]], [tag, ["products"]], [collection, ["products"]], [category, ["products"]]] as const) {
    const declared = queryRelations.get(source.table.name) ?? new Map<string, CommerceRelation>();
    for (const name of names) {
      const descriptor = describeToManyRelation(source.table, name, metadata.tables);
      if (descriptor === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      declared.set(name, descriptor);
    }
    queryRelations.set(source.table.name, declared);
  }
  for (const source of [option, variant]) {
    const parent = source.table.relationships.find(relation => relation.name === "product");
    if (parent?.type !== "belongsTo" || parent.targetModel !== product.model) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const declared = queryRelations.get(source.table.name);
    if (declared === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    declared.set("product", { name: "product", sourcePrimaryKeys: ["id"], targetTable: product.table.name, targetPrimaryKeys: ["id"],
      join: { type: "belongsTo", foreignKeys: [yield* foreignKey(source, product)] } });
  }
  const entities = [product, option, value, variant, image, tag, type, collection, category, assignment];
  const tables = [...entities.map(item => item.table), pivot, tagPivot, categoryPivot];
  const readCatalog = yield* Effect.fromResult(makeReadCatalog(tables.map(table => ({ name: table.name,
    columns: table.columns.map(column => column.name), primaryKeys: table.columns.filter(column => column.primaryKey).map(column => column.name),
    foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {},
  })), queryRelations));
  return { readCatalog, relatedReads: productRelatedReadProfiles({ option, value, variant, image, tag, type, collection, category, assignment }),
    product, searchableProductColumns, option, value, variant, image, tag, type, collection, category, assignment, entities,
    tables: [...entities.map(item => item.table), pivot, tagPivot, categoryPivot], writablePivots: [pivot, tagPivot, categoryPivot],
    valueProfile: compileProductValueProfile({ product, option, value, variant, image, tag, type, collection, category, assignment }),
    foreignKeys: { option: yield* foreignKey(option, product), value: yield* foreignKey(value, option), variant: yield* foreignKey(variant, product), image: yield* foreignKey(image, product) },
    pivot: { table: pivot, variantColumn: link.joinColumns[0], valueColumn: link.inverseJoinColumns[0] }, queryRelations,
  } satisfies ProductRuntimeMetadata;
});

/** Supported service query paths are capability policy, not a second schema. */
export const productRelations = Object.freeze(["images", "options", "options.values", "variants", "variants.options", "tags", "categories", "collection", "type"]);
