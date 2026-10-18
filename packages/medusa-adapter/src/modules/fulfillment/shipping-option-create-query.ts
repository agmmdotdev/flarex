import { Result, Schema } from "effect";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import type { ReadPlan } from "../../query/read";
import type { compileShippingOptionCreationContracts } from "./shipping-option-create-input";

const FilterId = Schema.String.check(Schema.isMaxLength(256));
export const ShippingOptionReadFilters = Schema.Struct({ id: Schema.optionalKey(Schema.Union([FilterId, Schema.Array(FilterId).check(Schema.isMaxLength(4))])) });
export const ShippingProviderReadFilters = Schema.Struct({ id: Schema.optionalKey(Schema.Union([FilterId, Schema.Array(FilterId).check(Schema.isMaxLength(8))])) });
export const ShippingOptionReadConfig = Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 64))),
  relations: Schema.optionalKey(Schema.Array(Schema.Literal("fulfillment_set")).check(Schema.isMaxLength(1))),
  take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
});
export const ShippingOptionReadInput = Schema.Struct({ filters: Schema.optionalKey(ShippingOptionReadFilters), config: Schema.optionalKey(ShippingOptionReadConfig) });
export const decodeShippingOptionReadInput = commerceDecoder(ShippingOptionReadInput, "invalidInput");
export const ShippingProviderReadInput = Schema.Struct({ filters: Schema.optionalKey(ShippingProviderReadFilters), config: Schema.optionalKey(ShippingOptionReadConfig) });
export const decodeShippingProviderReadInput = commerceDecoder(ShippingProviderReadInput, "invalidInput");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile"), decodeFilters = commerceDecoder(ShippingOptionReadFilters, "unsupportedProfile");
const decodeProviderFilters = commerceDecoder(ShippingProviderReadFilters, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 64))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(1))), limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}), "unsupportedProfile");
const where: WherePolicy = { decode: decodeFilters, fields: new Map([["id", { column: "id",
  decode: commerceDecoder(Schema.Union([FilterId, Schema.Array(FilterId).check(Schema.isMaxLength(4))]), "unsupportedProfile") }]]) };
const providerWhere: WherePolicy = { decode: decodeProviderFilters, fields: new Map([["id", { column: "id",
  decode: commerceDecoder(Schema.Union([FilterId, Schema.Array(FilterId).check(Schema.isMaxLength(8))]), "unsupportedProfile") }]]) };
type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionCreationContracts>>;

/** Option/Zone/Set cohorts remain four. Native availability may reach eight
 * Provider endpoints through the complete selected Link cohort. The only local
 * relation admitted by this profile is ServiceZone.fulfillment_set. */
export function prepareShippingOptionCreationQuery(contracts: Contracts) {
  return Result.gen(function* () {
    const catalog = yield* makeReadCatalog(contracts.entities.map(entity => ({ name: entity.table.name,
      columns: entity.table.columns.map(column => column.name), primaryKeys: ["id"],
      foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns), companions: {} })), contracts.relations);
    const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
    const query = (tableName: string, input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), provider = tableName === contracts.provider.name,
        selection = yield* (provider ? decodeProviderFilters : decodeFilters)(envelope.where ?? {}), options = yield* decodeOptions(envelope.options ?? {});
      if (![contracts.option.name, contracts.zone.name, contracts.set.name, contracts.provider.name].includes(tableName))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const paths = options.populate ?? [], zone = tableName === contracts.zone.name;
      if (paths.some(path => !zone || path !== "fulfillment_set")) return yield* Result.fail(commerceError("unsupportedProfile"));
      const projection = yield* compileProjection(catalog, tableName, options.fields, paths, zone
        ? { ...leaf, allowedPaths: ["fulfillment_set"], selectableRelations: ["fulfillment_set"], nested: new Map([["fulfillment_set", leaf]]) }
        : { ...leaf, allowedPaths: [] });
      const direction = options.orderBy?.id === "DESC" ? "desc" : "asc", skip = options.offset ?? 0;
      const plan: ReadPlan = { table: tableName, projection, paths, withDeleted: false, ordering: new Map(), relationFilters: [],
        query: { skip, order: { column: "id", direction }, predicate: { kind: "and", children: [yield* compileWhere(selection, provider ? providerWhere : where), { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: rows => ({ rows: preservePrimaryKeyOrFilterOrder(
          (direction === "asc" ? rows : [...rows].reverse()).slice(skip, options.limit === undefined ? undefined : skip + options.limit),
          selection, ["id"], [["id", direction === "asc" ? "ASC" : "DESC"]]), count: rows.length }) },
      };
      return { ...plan, selection, options };
    });
    return { catalog, query };
  });
}
