import { Result, Schema, type Effect } from "effect";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileFulfillmentGraphContracts } from "./fulfillment-graph-contracts";
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
    const { zone, geo, option, rule, zoneEntities: entities, relation, decodeZoneRow, decodeGeoRow } = yield* compileFulfillmentGraphContracts(metadata);
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
