import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import { ServiceZoneGeoZoneCreate } from "./service-zone-create-input";
import { compileFulfillmentGraphContracts } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ServiceZoneUpdateIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ServiceZoneUpdateSelector = Schema.Struct({ id: Schema.Union([Id, ServiceZoneUpdateIds]) });
/** The native workflow admits new geography or an ID-only existing member. */
export const ServiceZoneUpdateGeo = Schema.Union([ServiceZoneGeoZoneCreate, Schema.Struct({ id: Id })]);
export const ServiceZoneUpdateData = Schema.Struct({ name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  geo_zones: Schema.optionalKey(Schema.Array(ServiceZoneUpdateGeo).pipe(Schema.mutable).check(Schema.isMaxLength(4))) });
export const ServiceZoneUpdateInput = Schema.Struct({ selector: ServiceZoneUpdateSelector, update: ServiceZoneUpdateData });
export const ServiceZoneUpdateReadInput = Schema.Struct({ filters: ServiceZoneUpdateSelector, config: Schema.optionalKey(NativePreimageConfig) });
const Managed = { created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String), deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) };
export const ServiceZoneGeoPreimage = Schema.Struct({ ...ServiceZoneGeoZoneCreate.fields, id: Id,
  service_zone_id: Schema.optionalKey(Id), ...Managed });
/** Retained originals may contain sixteen old children, independently of the
 * forward replacement bound. Native membership, not reconstitution, owns undo. */
export const ServiceZoneUpdateUpsert = Schema.Struct({ id: Id, name: ServiceZoneUpdateData.fields.name,
  geo_zones: Schema.optionalKey(Schema.Array(ServiceZoneGeoPreimage).pipe(Schema.mutable).check(Schema.isMaxLength(16))) });
export const ServiceZoneUpdateUpserts = Schema.Array(ServiceZoneUpdateUpsert).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ServiceZoneUpdateNormalizedGeo = Schema.Struct({ ...ServiceZoneGeoZoneCreate.fields, id: Schema.optionalKey(Id),
  service_zone_id: Schema.optionalKey(Id), ...Managed });
export const ServiceZoneUpdateNormalized = Schema.Struct({ id: Id, name: ServiceZoneUpdateData.fields.name,
  geo_zones: Schema.optionalKey(Schema.Array(ServiceZoneUpdateNormalizedGeo).pipe(Schema.mutable).check(Schema.isMaxLength(16))) });
const decodeInput = commerceDecoder(ServiceZoneUpdateInput, "invalidInput"), decodeUpserts = commerceDecoder(ServiceZoneUpdateUpserts, "invalidInput");
export const decodeServiceZoneUpdateInput = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeInput));
export const decodeServiceZoneUpdateUpserts = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeUpserts), Result.flatMap(rows =>
  new Set(rows.map(row => row.id)).size !== rows.length || rows.reduce((sum, row) => sum + (row.geo_zones?.length ?? 0), 0) > 16
    // One genuine list projection selects the same root fields/relations for
    // every retained original. General mixed module upserts are not this inverse.
    || rows.some(row => (row.name !== undefined) !== (rows[0]?.name !== undefined) ||
      (row.geo_zones !== undefined) !== (rows[0]?.geo_zones !== undefined))
    ? Result.fail(commerceError("invalidInput")) : Result.succeed(rows)));
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeGeoRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(16)), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileServiceZoneUpdateContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentGraphContracts(metadata);
    const zoneProjection = yield* compileRowProjection(graph.zone), geoProjection = yield* compileRowProjection(graph.geo);
    const decode = (input: unknown, full: boolean) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input), roots = new Set<string>(), geos = new Set<string>();
      const result: Array<JsonObject & { readonly id: string }> = [];
      for (const row of rows) {
        const { geo_zones, ...scalar } = row;
        const decoded = yield* (full ? graph.decodeZoneRow(scalar) : zoneProjection(scalar));
        if (typeof decoded.id !== "string" || roots.has(decoded.id) || decoded.deleted_at !== undefined && decoded.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        roots.add(decoded.id);
        if (geo_zones !== undefined) for (const member of yield* decodeGeoRowsShape(geo_zones)) {
          const child = yield* (full ? graph.decodeGeoRow(member) : geoProjection(member));
          if (typeof child.id !== "string" || geos.has(child.id) || child.service_zone_id !== decoded.id || child.deleted_at !== undefined && child.deleted_at !== null)
            return yield* Result.fail(commerceError("storedCorruption"));
          geos.add(child.id);
        }
        result.push({ ...row, id: decoded.id });
      }
      if (geos.size > 16) return yield* Result.fail(commerceError("storedCorruption"));
      return result;
    });
    const decodeRows = (input: unknown) => decode(input, true), decodePreimages = (input: unknown) => decode(input, false);
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native ServiceZone update rows"));
    return { ...graph, entities: graph.zoneEntities, zoneProjection, geoProjection, decodeRows, decodePreimages, decodeSerializedRows: decodePreimages, Output };
  });
}
