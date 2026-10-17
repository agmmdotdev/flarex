import { Result, Schema } from "effect";
import { GeoZone } from "@medusajs/fulfillment/models";
import { relationScalarFieldPaths } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope } from "../../query/decoder";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { ServiceZoneUpdateIds, ServiceZoneUpdateSelector, type compileServiceZoneUpdateContracts } from "./service-zone-update-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileServiceZoneUpdateContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const where: WherePolicy = {
  decode: commerceDecoder(Schema.Union([ServiceZoneUpdateSelector,
    Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)) })]), "unsupportedProfile"),
  fields: new Map([["id", { column: "id", decode: commerceDecoder(Schema.Union([Id, ServiceZoneUpdateIds]), "unsupportedProfile") }]]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)), "unsupportedProfile") },
};
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile"), decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(8))),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }))),
  offset: Schema.optionalKey(Schema.Literal(0)), orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}), "unsupportedProfile");

/** Native projected originals retain scalar JSON reached through virtual path
 * syntax. Ordinary query projection remains strict after this named conversion. */
export function prepareServiceZoneUpdateQuery(contracts: Contracts) {
  return Result.gen(function* () {
    const relations = new Map([[contracts.zone.name, new Map([["geo_zones", contracts.relation]])]]);
    const catalog = yield* makeReadCatalog([contracts.zone, contracts.geo].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {} })), relations);
    const table = yield* catalog.table(contracts.zone.name), geo = yield* catalog.table(contracts.geo.name);
    const child: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", incomingKeys: true,
      selectableRelations: [], nested: new Map() };
    const policy: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: ["geo_zones"],
      allowedPaths: ["geo_zones"], nested: new Map([["geo_zones", child]]) };
    const descriptors = new Map([["geo_zones", { targetModel: GeoZone, relationship: { targetModel: "GeoZone" } }]]);
    const byModel = new Map([["GeoZone", new Map<string, never>()]]);
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), selection = yield* decodeWhere(envelope.where ?? {}), options = yield* decodeOptions(envelope.options ?? {});
      const rawPaths = options.populate ?? [], paths = rawPaths.filter(path => path === "geo_zones");
      if (rawPaths.some(path => path !== "geo_zones" && !["geo_zones.postal_expression", "geo_zones.metadata"].some(field => path === field || path.startsWith(field + "."))))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const selected = options.fields === undefined ? undefined : [...options.fields,
        ...relationScalarFieldPaths([...options.fields], descriptors, byModel), ...relationScalarFieldPaths([...rawPaths], descriptors, byModel)];
      let fields: string[] | undefined;
      if (selected !== undefined) {
        fields = ["id", ...selected.filter(field => table.columns.includes(field) || field.startsWith("geo_zones.") && geo.columns.includes(field.slice("geo_zones.".length)))];
        if (paths.includes("geo_zones")) {
          const nested = fields.some(field => field.startsWith("geo_zones."));
          fields.push(...(nested ? ["id", "service_zone_id"] : geo.columns).map(field => "geo_zones." + field));
        }
        fields = [...new Set(fields)];
      }
      const projection = yield* compileProjection(catalog, table.name, fields, paths, policy);
      return { where: selection, options, fields: projection, paths, predicate: yield* compileWhere(selection, where) };
    });
    return { catalog, table, geo, query, read: { table, paths: [{ path: "geo_zones", table: geo, many: true }] } };
  });
}
