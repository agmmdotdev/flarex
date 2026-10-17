import { Result, Schema, type Effect } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { projectNativeRow } from "../../repository/result";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

/** Checked scalar metadata and the installed FulfillmentSet descendant topology.
 * Each consumer explicitly selects its own root and bounded entity subset. */
export function compileFulfillmentGraphContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const set = metadata.tables.find(table => table.name === "fulfillment_set"),
      zone = metadata.tables.find(table => table.name === "service_zone"), geo = metadata.tables.find(table => table.name === "geo_zone"),
      option = metadata.tables.find(table => table.name === "shipping_option"), rule = metadata.tables.find(table => table.name === "shipping_option_rule");
    if (metadata.tables.length !== 8 || set === undefined || zone === undefined || geo === undefined || option === undefined || rule === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const zones = describeToManyRelation(set, "service_zones", metadata.tables);
    if (zones?.targetTable !== zone.name || zones.join.type !== "hasMany" || zones.join.foreignKeys[0] !== "fulfillment_set_id" ||
      zones.join.foreignKeys.length !== 1 || zones.sourcePrimaryKeys.length !== 1 || zones.sourcePrimaryKeys[0] !== "id" ||
      set.cascades.delete.length !== 1 || set.cascades.delete[0] !== "service_zones")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relation = describeToManyRelation(zone, "geo_zones", metadata.tables);
    if (relation?.targetTable !== geo.name || relation.join.type !== "hasMany" || relation.join.foreignKeys[0] !== "service_zone_id" ||
      relation.join.foreignKeys.length !== 1 || relation.sourcePrimaryKeys.length !== 1 || relation.sourcePrimaryKeys[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [child, parent, column] of [[zone, set, "fulfillment_set_id"], [geo, zone, "service_zone_id"],
      [option, zone, "service_zone_id"], [rule, option, "shipping_option_id"]] as const)
      if (!child.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === column && key.referencedTable === parent.name &&
        key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === "cascade") ||
        child === zone && child.columns.find(value => value.name === column)?.nullable !== false)
        return yield* Result.fail(commerceError("unsupportedProfile"));
    const cascadeEdges = metadata.tables.flatMap(table => table.foreignKeys.filter(key =>
      key.onDelete === "cascade" && [set.name, zone.name, geo.name, option.name, rule.name].includes(key.referencedTable))
      .map(key => ({ table: table.name, target: key.referencedTable, columns: key.columns, referenced: key.referencedColumns })));
    if (cascadeEdges.length !== 4 || cascadeEdges[0]?.table !== option.name || cascadeEdges[1]?.table !== zone.name ||
      cascadeEdges[2]?.table !== geo.name || cascadeEdges[3]?.table !== rule.name)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const entities = [];
    for (const [table, model, maximum] of [[set, "FulfillmentSet", 4], [zone, "ServiceZone", 4], [geo, "GeoZone", 16],
      [option, "ShippingOption", 8], [rule, "ShippingOptionRule", 16]] as const)
      entities.push({ table, model, maximum, decodeRow: yield* compileCompleteRow(table) });
    const decodeSetRow = entities[0]?.decodeRow, decodeZoneRow = entities[1]?.decodeRow, decodeGeoRow = entities[2]?.decodeRow;
    if (decodeSetRow === undefined || decodeZoneRow === undefined || decodeGeoRow === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { set, zone, geo, option, rule, entities, zoneEntities: entities.slice(1), zones, relation, decodeSetRow, decodeZoneRow, decodeGeoRow };
  });
}

/** The selected native lifecycle root owns its tuple and declared model order;
 * scalar row contracts and complete graph topology have already been checked. */
export function compileFulfillmentLifecycleGraph(metadata: Metadata, selection: "serviceZone" | "fulfillmentSet") {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentGraphContracts(metadata);
    if (graph.zone.cascades.delete.length !== 2 || graph.zone.cascades.delete[0] !== "geo_zones" || graph.zone.cascades.delete[1] !== "shipping_options" ||
      graph.option.cascades.delete.length !== 1 || graph.option.cascades.delete[0] !== "rules" || graph.geo.cascades.delete.length || graph.rule.cascades.delete.length)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const root = selection === "fulfillmentSet" ? graph.set : graph.zone;
    const entities = (selection === "fulfillmentSet" ? graph.entities : graph.zoneEntities)
      .map(entity => ({ ...entity, linkableKey: entity.table.name + "_id" }));
    const rootEntity = entities[0];
    if (rootEntity === undefined || rootEntity.table !== root) return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeTuple = commerceDecoder(Schema.Tuple([
      Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(rootEntity.maximum)),
      Schema.Struct(Object.fromEntries(entities.map(entity => [entity.model,
        Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, entity.maximum)))]))),
    ]), "storedCorruption");
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const tuple = yield* decodeTuple(input);
      if (!jsonEqual(tuple[0], tuple[1][rootEntity.model] ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const cascades: Record<string, object[]> = {};
      for (const entity of entities) {
        const rows = tuple[1][entity.model];
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
    return { ...graph, root, entities, decodeLifecycleResult, nativeCascades };
  });
}
