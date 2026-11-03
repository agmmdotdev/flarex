import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { shippingDeletionClosure } from "./shipping-deletion-closure";

export const serviceZoneSeedTime = "2026-10-18T00:00:00.000Z";
const managed = (deleted = false) => ({ created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: deleted ? serviceZoneSeedTime : null });
export const serviceZoneParents = { active: "zone-create-active-set", historical: "zone-create-historical-set", other: "zone-create-other-set", race: "zone-create-race-set" } as const;
type Seed = Readonly<{ table: string; row: JsonObject }>;

/** Existing canonical fixture rows; callers select the original protected
 * parent cohort only for Set/ServiceZone comparisons. */
export function fulfillmentForestRows(graphs: readonly Readonly<{ rows: readonly Seed[] }>[], includeParents: boolean): readonly Seed[] {
  const supplied: Seed[] = [
    ...(includeParents ? Object.values(serviceZoneParents).map(id => ({ table: "fulfillment_set", row: {
      id, name: id, type: "shipping", metadata: null, ...managed(id === serviceZoneParents.historical),
    } })) : []),
    { table: "shipping_profile", row: { id: "zone-create-protected-profile", name: "Zone protected Profile", type: "default", metadata: null, ...managed() } },
    { table: "shipping_option_type", row: { id: "zone-create-type", label: "Zone type", code: "raw", description: null, ...managed() } },
    { table: "fulfillment_provider", row: { id: "zone-create-provider", is_enabled: true, ...managed() } },
    ...(includeParents ? [
      { table: "service_zone", row: { id: "zone-create-active-name", name: "Reserved global Zone name", fulfillment_set_id: serviceZoneParents.active, metadata: null, ...managed() } },
      { table: "service_zone", row: { id: "zone-create-historical-name", name: "Reusable historical Zone name", fulfillment_set_id: serviceZoneParents.active, metadata: null, ...managed(true) } },
    ] : []),
    ...graphs.flatMap(graph => graph.rows),
  ];
  const order = ["fulfillment_set", "shipping_profile", "shipping_option_type", "fulfillment_provider", "service_zone", "geo_zone", "shipping_option", "shipping_option_rule"];
  const rows = order.flatMap(table => supplied.filter(row => row.table === table));
  if (rows.length !== supplied.length) throw new Error("Unknown canonical Fulfillment fixture table");
  return rows;
}

/** Canonical initial data exercises the installed cascade graph; it does not
 * grant Option/Rule or FulfillmentSet public creation authority. */
export function serviceZoneDeletionGraph(prefix: string, options: Readonly<{
  roots?: number; geos?: number; options?: number; rules?: number; historical?: boolean;
}> = {}) {
  const ids = Array.from({ length: options.roots ?? 1 }, (_, index) => `${prefix}-zone-${index}`);
  const geoIds = Array.from({ length: options.geos ?? 0 }, (_, index) => `${prefix}-geo-${index}`);
  const optionIds = Array.from({ length: options.options ?? 0 }, (_, index) => `${prefix}-option-${index}`);
  const ruleIds = Array.from({ length: options.rules ?? 0 }, (_, index) => `${prefix}-rule-${index}`);
  if (ids.length === 0 || (ruleIds.length > 0 && optionIds.length === 0)) throw new Error("Invalid ServiceZone comparison graph");
  const rows: Seed[] = [
    ...ids.map((id, index) => ({ table: "service_zone", row: { id, name: id, fulfillment_set_id: serviceZoneParents.active,
      metadata: { fixture: prefix }, ...managed(options.historical === true && index % 2 === 0) } })),
    ...geoIds.map((id, index) => ({ table: "geo_zone", row: { id, type: "country", country_code: "Raw" + index,
      province_code: null, city: null, postal_expression: null, metadata: null, service_zone_id: ids[index % ids.length]!,
      ...managed(options.historical === true && index % 2 === 0) } })),
    ...optionIds.map((id, index) => ({ table: "shipping_option", row: { id, name: id, price_type: "flat", data: null, metadata: null,
      service_zone_id: ids[index % ids.length]!, shipping_profile_id: "zone-create-protected-profile", provider_id: "zone-create-provider",
      shipping_option_type_id: "zone-create-type", ...managed(options.historical === true && index % 2 === 0) } })),
    ...ruleIds.map((id, index) => ({ table: "shipping_option_rule", row: { id, attribute: "native.rule", operator: "eq", value: { retained: index },
      shipping_option_id: optionIds[index % optionIds.length]!, ...managed(options.historical === true && index % 2 === 0) } })),
  ];
  return { ids, geoIds, optionIds, ruleIds, allIds: [...ids, ...geoIds, ...optionIds, ...ruleIds], rows };
}

/** Canonical eight-table forest plus optional installed locfs history. Counts
 * are aggregate so 4/4/16/8/16 is exactly 48 selected lifecycle rows. */
export function fulfillmentSetDeletionGraph(prefix: string, options: Readonly<{
  sets?: number; zones?: number; geos?: number; options?: number; rules?: number;
  links?: number; historicalLinks?: number;
  history?: Readonly<{ sets?: number; zones?: number; geos?: number; options?: number; rules?: number }>;
  shipping?: Readonly<{ historical?: boolean }>;
}> = {}) {
  const count = options.sets ?? 1, zoneCount = options.zones ?? count;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(zoneCount) || zoneCount < 0 ||
    zoneCount === 0 && ((options.geos ?? 0) !== 0 || (options.options ?? 0) !== 0 || (options.rules ?? 0) !== 0))
    throw new Error("Invalid FulfillmentSet comparison graph");
  const ids = Array.from({ length: count }, (_, index) => `${prefix}-set-${index}`);
  const descendants = zoneCount === 0 ? { ids: [], geoIds: [], optionIds: [], ruleIds: [], allIds: [], rows: [] }
    : serviceZoneDeletionGraph(prefix, { roots: zoneCount, geos: options.geos ?? 0, options: options.options ?? 0, rules: options.rules ?? 0 });
  const parents = new Map(descendants.ids.map((id, index) => {
    const parent = ids[index % ids.length];
    if (parent === undefined) throw new Error("Missing comparison Set parent");
    return [id, parent];
  }));
  const supplied: Seed[] = [
    ...ids.map(id => ({ table: "fulfillment_set", row: { id, name: id, type: "shipping", metadata: { fixture: prefix },
      created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
    ...descendants.rows.map(entry => {
      if (entry.table !== "service_zone") return entry;
      const id = entry.row.id, parent = typeof id === "string" ? parents.get(id) : undefined;
      if (parent === undefined) throw new Error("Missing comparison Zone parent");
      return { ...entry, row: { ...entry.row, fulfillment_set_id: parent } };
    }),
  ];
  const history = new Map([["fulfillment_set", options.history?.sets ?? 0], ["service_zone", options.history?.zones ?? 0],
    ["geo_zone", options.history?.geos ?? 0], ["shipping_option", options.history?.options ?? 0], ["shipping_option_rule", options.history?.rules ?? 0]]);
  const positions = new Map<string, number>();
  const rows: Seed[] = supplied.map(entry => {
    const ordinal = positions.get(entry.table) ?? 0; positions.set(entry.table, ordinal + 1);
    return { ...entry, row: { ...entry.row, deleted_at: ordinal < (history.get(entry.table) ?? 0) ? serviceZoneSeedTime : null } };
  });
  const links = Array.from({ length: options.links ?? 0 }, (_, index) => ({ table: "location_fulfillment_set", row: {
    id: `${prefix}-locfs-${index}`, stock_location_id: `${prefix}-location-${index}`, fulfillment_set_id: ids[index % ids.length]!,
    created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: index < (options.historicalLinks ?? 0) ? serviceZoneSeedTime : null,
  } }));
  const shipping = options.shipping === undefined ? undefined : shippingDeletionClosure(prefix, descendants.optionIds,
    [...new Set(links.flatMap(entry => typeof entry.row.stock_location_id === "string" ? [entry.row.stock_location_id] : []))], options.shipping.historical);
  return { ids, zoneIds: descendants.ids, geoIds: descendants.geoIds, optionIds: descendants.optionIds, ruleIds: descendants.ruleIds,
    allIds: [...ids, ...descendants.allIds], rows: [...rows, ...shipping?.providerRows ?? []], links, shipping };
}
