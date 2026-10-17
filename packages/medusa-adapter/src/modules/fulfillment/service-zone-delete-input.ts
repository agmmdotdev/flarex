import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { projectNativeRow } from "../../repository/result";
import { compileServiceZoneGraphContracts } from "./service-zone-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ServiceZoneDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeServiceZoneDeletionIds = commerceDecoder(ServiceZoneDeletionIds, "invalidInput");
export const decodeServiceZoneDeletionArguments = commerceDecoder(Schema.Tuple([ServiceZoneDeletionIds]), "invalidInput");
export const ServiceZoneDeletionOutput = Schema.Struct({
  service_zone_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 4))),
  geo_zone_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 16))),
  shipping_option_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 8))),
  shipping_option_rule_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 16))),
});
export const decodeServiceZoneDeletionOutput = commerceDecoder(ServiceZoneDeletionOutput, "storedCorruption");
const decodeTuple = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({ ServiceZone: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 4))),
    GeoZone: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 16))),
    ShippingOption: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 8))),
    ShippingOptionRule: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 16))) }),
]), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileServiceZoneDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const graph = yield* compileServiceZoneGraphContracts(metadata);
    // The native declared cascade graph owns lifecycle presentation order.
    if (graph.zone.cascades.delete.length !== 2 || graph.zone.cascades.delete[0] !== "geo_zones" || graph.zone.cascades.delete[1] !== "shipping_options" ||
      graph.option.cascades.delete.length !== 1 || graph.option.cascades.delete[0] !== "rules" || graph.geo.cascades.delete.length || graph.rule.cascades.delete.length)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const entities = graph.entities.map(entity => ({ ...entity, linkableKey: entity.table.name + "_id" }));
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const tuple = yield* decodeTuple(input);
      if (!jsonEqual(tuple[0], tuple[1].ServiceZone ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const raw: Readonly<Record<string, readonly object[] | undefined>> = tuple[1];
      const cascades: Record<string, object[]> = {};
      for (const entity of entities) {
        const rows = raw[entity.model];
        if (rows === undefined) continue;
        for (const row of rows) yield* entity.decodeRow(row);
        cascades[entity.model] = rows.map(row => ({ ...row }));
      }
      return [tuple[0].map(row => ({ ...row })), cascades] satisfies [object[], Record<string, unknown[]>];
    });
    const nativeCascades = (input: Readonly<Record<string, readonly JsonObject[]>>) => Result.gen(function* () {
      if (Object.keys(input).some(model => !entities.some(entity => entity.model === model)))
        return yield* Result.fail(commerceError("storedCorruption"));
      return Object.fromEntries(entities.flatMap(entity => {
        const rows = input[entity.model];
        return rows === undefined ? [] : [[entity.model, rows.map(projectNativeRow)]];
      }));
    });
    return { ...graph, entities, decodeLifecycleResult, nativeCascades, decodeOutput: decodeServiceZoneDeletionOutput, Output: ServiceZoneDeletionOutput };
  });
}
