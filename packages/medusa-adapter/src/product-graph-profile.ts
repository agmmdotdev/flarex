import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { decodeVariantReference } from "./product-value-profile";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import type { CreationProfile, CreationStep, GraphCatalog, ReplacementProfile } from "./write/graph-model";

const decodeReference = commerceDecoder(Schema.Union([Schema.String, Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)])]), "invalidInput");
const decodeAssociation = commerceDecoder(Schema.Struct({ id: Schema.String }), "invalidInput");
const creationReference: Extract<CreationStep, { kind: "references" }>["decode"] = input =>
  Result.map(decodeVariantReference(input), supplied => ({ key: supplied.id, supplied }));

/** Adapt the checked Product value contract to the shared graph mechanics. */
export function productGraphCatalog(catalog: ProductRuntimeMetadata): GraphCatalog {
  return {
    entities: catalog.entities, tables: catalog.tables, writablePivots: catalog.writablePivots, queryRelations: catalog.queryRelations,
    decodeRow: (entity, input) => Result.map(catalog.valueProfile.decodeRow(entity.table.name, input), decoded => ({ supplied: decoded.supplied, key: decoded.id })),
    decodeReference: (_entity, input) => Result.map(decodeReference(input), reference => typeof reference === "string"
      ? { key: reference } : { key: reference.id, supplied: reference }),
    decodeAssociation: (_entity, input) => Result.map(decodeAssociation(input), reference => reference.id),
  };
}

/** Product normalization declares variants before their option-value links.
 * Tags/categories are external references; variant links repeat exact snapshots. */
export function productCreationProfile(catalog: ProductRuntimeMetadata): CreationProfile {
  const external = (name: "tags" | "categories"): CreationStep => ({
    kind: "references", name, target: name === "tags" ? catalog.tag : catalog.category, membership: "external",
    decode: name === "tags" ? creationReference : input => typeof input === "string"
      ? Result.succeed({ key: input }) : Result.fail(commerceError("invalidInput")),
    resolve: () => {
      const descriptor = catalog.queryRelations.get(catalog.product.table.name)?.get(name);
      if (descriptor?.join.type !== "manyToMany") return Result.fail(commerceError("unsupportedProfile"));
      const source = descriptor.join.sourceColumns[0], target = descriptor.join.targetColumns[0];
      if (source === undefined || target === undefined) return Result.fail(commerceError("unsupportedProfile"));
      return Result.succeed({ table: descriptor.join.pivotTable, link: (parent, reference) => ({ [source]: parent, [target]: reference }) });
    },
  });
  return {
    catalog: productGraphCatalog(catalog),
    root: { entity: catalog.product, omitRelations: ["images", "options", "variants", "tags", "categories"], steps: [
      external("tags"), external("categories"),
      { kind: "children", name: "variants", foreignKey: catalog.foreignKeys.variant, node: { entity: catalog.variant, omitRelations: [], steps: [] } },
      { kind: "children", name: "images", foreignKey: catalog.foreignKeys.image, node: { entity: catalog.image, omitRelations: [], steps: [] } },
      { kind: "children", name: "options", foreignKey: catalog.foreignKeys.option, node: { entity: catalog.option, omitRelations: ["values"], steps: [
        { kind: "children", name: "values", foreignKey: catalog.foreignKeys.value, node: { entity: catalog.value, omitRelations: ["variants"], steps: [
          { kind: "references", name: "variants", target: catalog.variant, membership: "declaredSnapshot", decode: creationReference,
            resolve: () => Result.succeed({ table: catalog.pivot.table.name, link: (parent, reference) => ({ [catalog.pivot.variantColumn]: reference, [catalog.pivot.valueColumn]: parent }) }) },
        ] } },
      ] } },
    ] },
    rowLimitDetail: (maximum, attempted, tables) => ({ boundary: "productGraphRows", maximum, attempted, tables }),
  };
}

/** Module policy owns admission, membership and presentation. Storage, planning
 * state, dependency ordering and performed-action capture stay shared. */
export function productReplacementProfile(catalog: ProductRuntimeMetadata): ReplacementProfile {
  return {
    catalog: productGraphCatalog(catalog),
    allowedRelations: entity => entity === catalog.product ? ["options", "variants", "images", "tags", "categories"]
      : entity === catalog.option ? ["values"] : entity === catalog.variant ? ["options"] : entity === catalog.collection ? ["products"] : [],
    ownedToOne: entity => entity === catalog.product ? ["collection", "type"] : [],
    mutableForeignKeys: entity => entity === catalog.product,
    toManyMode: (entity, _name, child) => entity === catalog.collection
      ? child === catalog.product ? Result.succeed("associate") : Result.fail(commerceError("unsupportedProfile"))
      : Result.succeed("replace"),
    validateLink: Effect.fn("ProductAdapter.validateGraphLink")(function* (source, next, selected, load) {
      if (source !== catalog.variant) return;
      const options = yield* load(catalog.option.table);
      if (!options.some(value => value.id === selected.option_id && value.product_id === next.product_id)) return yield* Effect.fail(commerceError("invalidInput"));
    }),
    projectionPaths: (entity, relations) => relations.flatMap(name => name === "options" && entity === catalog.product ? [name, "options.values"] : [name]),
    project: rows => {
      const projection = new Map(rows);
      const images = projection.get(catalog.image.table.name);
      if (images !== undefined) {
        const ranked: { row: typeof images[number]; rank: number }[] = [];
        for (const row of images) {
          if (typeof row.rank !== "number") return Result.fail(commerceError("storedCorruption"));
          ranked.push({ row, rank: row.rank });
        }
        projection.set(catalog.image.table.name, ranked.sort((left, right) => left.rank - right.rank).map(value => value.row));
      }
      return Result.succeed(projection);
    },
  };
}
