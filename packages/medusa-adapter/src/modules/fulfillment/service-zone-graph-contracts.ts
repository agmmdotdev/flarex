import { Result, type Effect } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

/** Checked scalar metadata and the installed ServiceZone descendant topology.
 * Creation presentation and lifecycle admission remain with their consumers. */
export function compileServiceZoneGraphContracts(metadata: Metadata) {
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
    return { zone, geo, option, rule, entities, relation, decodeZoneRow, decodeGeoRow };
  });
}
