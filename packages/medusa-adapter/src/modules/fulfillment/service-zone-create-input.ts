import { Result, Schema, type Effect } from "effect";
import { describeToManyRelation, fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Shape admission leaves native GeoZone validation and its first-error order intact. */
export const ServiceZoneGeoZoneCreate = Schema.Struct({ type: Schema.optionalKey(Schema.String),
  country_code: Schema.optionalKey(Schema.String), province_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
  city: Schema.optionalKey(Schema.NullOr(Schema.String)), postal_expression: Schema.optionalKey(Schema.Json),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) });
export const ServiceZoneCreate = Schema.Struct({ name: Schema.String, fulfillment_set_id: Id,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  geo_zones: Schema.optionalKey(Schema.Array(ServiceZoneGeoZoneCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4))) });
export const ServiceZoneCreates = Schema.Array(ServiceZoneCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ServiceZonePhysicalDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeServiceZoneCreates = commerceDecoder(ServiceZoneCreates, "invalidInput");
export const decodeServiceZonePhysicalDeletionIds = commerceDecoder(ServiceZonePhysicalDeletionIds, "invalidInput");
export const decodeServiceZonePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeChildren = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeEmptyOptions = commerceDecoder(Schema.Array(Schema.Never), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

/** One checked native eight-table snapshot owns scalar rows and cascade closure. */
export function compileServiceZoneCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const zone = metadata.tables.find(table => table.name === "service_zone"), geo = metadata.tables.find(table => table.name === "geo_zone"),
      option = metadata.tables.find(table => table.name === "shipping_option"), rule = metadata.tables.find(table => table.name === "shipping_option_rule");
    if (metadata.tables.length !== 8 || zone === undefined || geo === undefined || option === undefined || rule === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relation = describeToManyRelation(zone, "geo_zones", metadata.tables);
    if (relation?.targetTable !== geo.name || relation.join.type !== "hasMany" || relation.join.foreignKeys[0] !== "service_zone_id" ||
      relation.join.foreignKeys.length !== 1 || relation.sourcePrimaryKeys.length !== 1 || relation.sourcePrimaryKeys[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [child, parent, column] of [[geo, zone, "service_zone_id"], [option, zone, "service_zone_id"], [rule, option, "shipping_option_id"]] as const)
      if (!child.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === column && key.referencedTable === parent.name &&
        key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === "cascade"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    const cascadeEdges = metadata.tables.flatMap(table => table.foreignKeys.filter(key =>
      key.onDelete === "cascade" && [zone.name, geo.name, option.name, rule.name].includes(key.referencedTable))
      .map(key => ({ table: table.name, target: key.referencedTable, columns: key.columns, referenced: key.referencedColumns })));
    if (cascadeEdges.length !== 3 || cascadeEdges[0]?.table !== option.name || cascadeEdges[1]?.table !== geo.name || cascadeEdges[2]?.table !== rule.name)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const entities = [];
    for (const [table, model, maximum] of [[zone, "ServiceZone", 4], [geo, "GeoZone", 16], [option, "ShippingOption", 8], [rule, "ShippingOptionRule", 16]] as const)
      entities.push({ table, model, maximum, decodeRow: yield* compileCompleteRow(table) });
    const decodeZoneRow = entities[0]?.decodeRow, decodeGeoRow = entities[1]?.decodeRow;
    if (decodeZoneRow === undefined || decodeGeoRow === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const defaults = new Map<string, JsonObject>();
    for (const entity of entities) {
      const values: Record<string, Json> = {};
      for (const column of entity.table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
        if (column.defaultValue !== undefined) values[column.name] = column.defaultValue;
        else if (column.nullable) values[column.name] = null;
      }
      defaults.set(entity.table.name, values);
    }
    const descriptors = new Map(zone.relationships.map(relationship => [relationship.name, { relationship }]));
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input), roots = new Set<string>(), children = new Set<string>();
      for (const value of rows) {
        const { geo_zones, shipping_options, ...scalar } = value, root = yield* decodeZoneRow(scalar);
        if (typeof root.id !== "string" || roots.has(root.id) || root.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        roots.add(root.id); yield* decodeEmptyOptions(shipping_options);
        for (const child of yield* decodeChildren(geo_zones)) {
          const row = yield* decodeGeoRow(child);
          if (typeof row.id !== "string" || children.has(row.id) || row.service_zone_id !== root.id || row.deleted_at !== null)
            return yield* Result.fail(commerceError("storedCorruption"));
          children.add(row.id);
        }
      }
      if (children.size > 16) return yield* Result.fail(commerceError("storedCorruption"));
      return rows;
    });
    const initializeRows = (roots: readonly JsonObject[], children: readonly JsonObject[]) => Result.gen(function* () {
      const rows = roots.map(row => ({ ...row, geo_zones: children.filter(child => child.service_zone_id === row.id).map(child => ({ ...child })) }));
      fillEmptyToManyRelations(rows, descriptors);
      return yield* decodeRows(rows);
    });
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows => Result.isSuccess(decodeRows(rows)) || "Expected complete native ServiceZone creation rows"));
    return { zone, geo, option, rule, entities, relation, defaults, decodeZoneRow, decodeGeoRow, decodeRows, initializeRows, Output };
  });
}
