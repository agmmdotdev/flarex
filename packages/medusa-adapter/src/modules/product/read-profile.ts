import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import type { ProjectionPolicy } from "../../query/projection";
import type { WherePolicy } from "../../query/predicate";

const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeText = commerceDecoder(Schema.String, "unsupportedProfile");
const decodeIdentity = commerceDecoder(Schema.Union([Schema.Null, Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]), "unsupportedProfile");
const decodeSelectors = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String })).check(Schema.isMinLength(1), Schema.isMaxLength(256)), "unsupportedProfile");
const decodeAssignments = commerceDecoder(Schema.Array(Schema.Struct({ variant_id: Schema.String, image_id: Schema.String })).check(Schema.isMaxLength(256)), "unsupportedProfile");

export const scalarProjection: ProjectionPolicy = {
  keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map(),
};
const retainedProjection: ProjectionPolicy = { ...scalarProjection, keys: "retain", storageKeys: "first" };
const nestedProjection: ProjectionPolicy = { ...retainedProjection, joinKeys: "retain" };
const parentProjection: ProjectionPolicy = { ...nestedProjection, selectableRelations: ["product"],
  nested: new Map([["product", retainedProjection]]),
};
const inverseProjection: ProjectionPolicy = { ...retainedProjection, selectableRelations: ["products"],
  nested: new Map([["products", nestedProjection]]),
};
const collectionProjection: ProjectionPolicy = { ...inverseProjection,
  nested: new Map([["products", { ...nestedProjection, incomingKeys: true }]]),
};
// Pinned Drizzle projectLoadedRelationsFromTree retains target primary keys and
// the incoming owner FK on hasMany rows, including explicit nested selections.
const ownedProjection: ProjectionPolicy = { ...retainedProjection, incomingKeys: true };
const productOptionProjection: ProjectionPolicy = { ...ownedProjection, selectableRelations: ["values"],
  nested: new Map([["values", ownedProjection]]),
};
/** Native Option compensation selects nested Value keys without broadening
 * ordinary related reads or adding DTO-only paths to shared compilation. */
export const optionWorkflowReadProjection: ProjectionPolicy = { ...parentProjection,
  allowedPaths: ["product", "values"], selectableRelations: ["product", "values"],
  nested: new Map([...parentProjection.nested, ...productOptionProjection.nested]),
};
const productVariantProjection: ProjectionPolicy = { ...ownedProjection, selectableRelations: ["options"],
  nested: new Map([["options", retainedProjection]]),
};
export const categoryReadProjection: ProjectionPolicy = { ...inverseProjection, allowedPaths: ["products"] };
export const publicProductProjection: ProjectionPolicy = { ...scalarProjection,
  keys: "retainWhenNested", joinKeys: "retainWhenNested", nullToOne: true,
  selectableRelations: ["collection", "type", "categories", "tags", "images", "options", "variants"],
  nested: new Map([["collection", retainedProjection], ["type", retainedProjection], ["categories", retainedProjection],
    ["tags", retainedProjection], ["images", ownedProjection], ["options", productOptionProjection], ["variants", productVariantProjection]]),
};
export const internalProductProjection: ProjectionPolicy = { ...publicProductProjection, keys: "retain" };

export interface RelatedReadProfile {
  readonly projection: ProjectionPolicy;
  readonly paths: readonly string[];
  readonly where: WherePolicy;
}

/** Module admission data. Shared compilation never discriminates model names. */
export function productRelatedReadProfiles(entities: Pick<ProductRuntimeMetadata, "type" | "tag" | "collection" | "option" | "variant" | "category" | "assignment" | "image" | "value">): ReadonlyMap<string, RelatedReadProfile> {
  const settings = [
    { entity: entities.type, fields: ["value"], paths: [], projection: retainedProjection },
    { entity: entities.tag, fields: ["value"], paths: ["products", "products.collection"], projection: inverseProjection },
    { entity: entities.collection, fields: ["title", "handle"], paths: ["products"], projection: collectionProjection },
    { entity: entities.option, fields: ["title"], paths: ["product", "values"], projection: parentProjection },
    { entity: entities.variant, fields: ["title"], paths: ["product", "product.images", "images", "options"],
      projection: { ...parentProjection, selectableRelations: ["product", "options"],
        nested: new Map([...parentProjection.nested, ["options", nestedProjection]]) } },
    { entity: entities.category, fields: [], paths: ["products"], projection: scalarProjection },
    { entity: entities.assignment, fields: [], paths: [], projection: scalarProjection },
    { entity: entities.image, fields: [], paths: ["variants"], projection: scalarProjection },
    { entity: entities.value, fields: [], paths: [], projection: scalarProjection },
  ];
  return new Map(settings.map(({ entity, fields, paths, projection }) => {
    const names = [...entity.table.columns.filter(column => column.primaryKey).map(column => column.name), ...entity.table.foreignKeys.flatMap(key => key.columns)];
    const filters = new Map(names.map(column => [column, { column, decode: decodeIdentity }]));
    for (const column of fields) filters.set(column, { column, decode: decodeText });
    return [entity.table.name, { projection: { ...projection, allowedPaths: paths }, paths, where: { decode: decodeWhere, fields: filters,
      selectors: { decode: entity === entities.assignment ? decodeAssignments : decodeSelectors,
        mode: entity === entities.assignment ? "tuples" : "membership", key: "id" },
    } } satisfies RelatedReadProfile];
  }));
}
