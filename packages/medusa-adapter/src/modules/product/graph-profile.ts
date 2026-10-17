import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { decodeVariantReference } from "./value-profile";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import type { CreationProfile, CreationStep, GraphCatalog, ReplacementProfile } from "../../write/graph-model";

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
export type ProductReplacementAdmission = "standard" | "option-workflows";
export function productReplacementProfile(catalog: ProductRuntimeMetadata, admission: ProductReplacementAdmission = "standard"): ReplacementProfile {
  return {
    catalog: productGraphCatalog(catalog), operation: "upsertWithReplace", ordering: new Map(),
    allowedRelations: entity => entity === catalog.product ? ["options", "variants", "images", "tags", "categories"]
      : entity === catalog.option ? ["values"] : entity === catalog.variant ? ["options"] : entity === catalog.collection ? ["products"] : [],
    ownedToOne: entity => entity === catalog.product ? ["collection", "type"] : [],
    mutableForeignKeys: entity => entity === catalog.product,
    admitSelection: (table, rows) => {
      if (admission !== "option-workflows") return Result.succeed(undefined);
      const column = table === catalog.value.table ? catalog.foreignKeys.value
        : table === catalog.pivot.table ? catalog.pivot.valueColumn : undefined;
      if (column === undefined) return Result.succeed(undefined);
      const maximum = table === catalog.value.table ? 4 : 2;
      const counts = new Map<string, number>();
      for (const row of rows) {
        const owner = row[column];
        if (typeof owner !== "string") return Result.fail(commerceError("storedCorruption"));
        const count = (counts.get(owner) ?? 0) + 1;
        if (count > maximum) return Result.fail(commerceError("unsupportedProfile"));
        counts.set(owner, count);
      }
      return Result.succeed(undefined);
    },
    prepareProjection: Effect.fn("ProductAdapter.prepareReplacementProjection")(function* (entity, roots, load) {
      if (admission !== "option-workflows") return;
      if (entity !== catalog.option) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const ids: string[] = [];
      for (const root of roots) {
        if (typeof root.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
        ids.push(root.id);
      }
      // Move the complete Value projection's existing indexed read before
      // writes. The planner reuses this same operation-local selection later.
      yield* load(catalog.value.table, catalog.foreignKeys.value, ids);
    }),
    toManyMode: (entity, _name, child) => entity === catalog.collection
      ? child === catalog.product ? Result.succeed("associate") : Result.fail(commerceError("unsupportedProfile"))
      : Result.succeed("replace"),
    validateLink: Effect.fn("ProductAdapter.validateGraphLink")(function* (source, next, selected, load) {
      if (source !== catalog.variant) return;
      if (typeof selected.option_id !== "string") return yield* Effect.fail(commerceError("invalidInput"));
      const options = yield* load(catalog.option.table, "id", [selected.option_id]);
      if (!options.some(value => value.id === selected.option_id && value.product_id === next.product_id)) return yield* Effect.fail(commerceError("invalidInput"));
    }),
    projectionPaths: (entity, relations) => relations.flatMap(name => name === "options" && entity === catalog.product ? [name, "options.values"] : [name]),
    project: rows => {
      const projection = new Map(rows);
      // Default native relation presentation hides deleted entities without
      // discarding their persisted replacement-removal or receipt evidence.
      for (const entity of catalog.entities) if (entity.table.columns.some(column => column.name === "deleted_at")) {
        const selected = projection.get(entity.table.name);
        if (selected !== undefined) projection.set(entity.table.name, selected.filter(row => row.deleted_at === null));
      }
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
