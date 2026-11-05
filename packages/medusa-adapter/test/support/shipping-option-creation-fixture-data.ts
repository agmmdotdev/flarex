import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ShippingOptionCreationInput } from "../../src/workflows/fulfillment/create-shipping-options";

export const shippingOptionSeedTime = "2026-10-18T00:00:00.000Z";
export const shippingOptionParents = { zone: "sz138", unavailableZone: "sz138-unavailable", set: "set138", location: "loc138",
  profile: "sp138", type: "sot138", provider: "manual_manual", region: "reg138" } as const;
export const shippingOptionRegionIds = [shippingOptionParents.region, ...Array.from({ length: 7 }, (_, index) => "reg138-" + (index + 1))];
export type ShippingOptionCreationSeed = Readonly<{ table: string; row: JsonObject }>;
export type ShippingOptionRetained = Readonly<{ creation: unknown; pricing: unknown; links: unknown; event: unknown }>;

export function shippingOptionCreationInput(prefix: string, count = 1): typeof ShippingOptionCreationInput.Type {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}-${index}`, price_type: "flat", service_zone_id: shippingOptionParents.zone,
    shipping_profile_id: shippingOptionParents.profile, provider_id: shippingOptionParents.provider,
    type: { label: `${prefix}-type-${index}`, code: `${prefix}-type-${index}` },
    prices: [{ currency_code: "usd", amount: 100 + index }], rules: [{ attribute: "enabled", operator: "eq", value: true }] }));
}

/** Fresh source-local seed groups shared by ordinary and retained construction. */
export function shippingOptionCreationRows(historicalParents = false): Readonly<Record<
  "fulfillment" | "pricing" | "region" | "stock_location" | "locationLinks" | "providerLinks" | "priceSetLinks",
  readonly ShippingOptionCreationSeed[]
>> {
  const managed = { created_at: shippingOptionSeedTime, updated_at: shippingOptionSeedTime, deleted_at: null };
  const parentManaged = { ...managed, deleted_at: historicalParents ? shippingOptionSeedTime : null };
  return {
    fulfillment: [
      { table: "fulfillment_set", row: { id: shippingOptionParents.set, name: "Shipping138", type: "shipping", metadata: null, ...managed } },
      { table: "fulfillment_set", row: { id: "set138-unavailable", name: "Unavailable138", type: "shipping", metadata: null, ...managed } },
      { table: "shipping_profile", row: { id: shippingOptionParents.profile, name: "Shipping138", type: "default", metadata: null, ...parentManaged } },
      { table: "shipping_option_type", row: { id: shippingOptionParents.type, label: "Existing138", code: "existing138", description: null, ...parentManaged } },
      { table: "fulfillment_provider", row: { id: shippingOptionParents.provider, is_enabled: true, ...managed } },
      ...[shippingOptionParents.zone, shippingOptionParents.unavailableZone].map(id => ({ table: "service_zone", row: { id, name: id,
        fulfillment_set_id: id === shippingOptionParents.zone ? shippingOptionParents.set : "set138-unavailable", metadata: null, ...managed } })),
    ],
    stock_location: [{ table: "stock_location", row: { id: shippingOptionParents.location, name: "Shipping138", address_id: null, metadata: null, ...managed } }],
    locationLinks: [{ table: "location_fulfillment_set", row: { id: "locfs138", stock_location_id: shippingOptionParents.location,
      fulfillment_set_id: shippingOptionParents.set, ...managed } }],
    providerLinks: [{ table: "location_fulfillment_provider", row: { id: "locfp138", stock_location_id: shippingOptionParents.location,
      fulfillment_provider_id: shippingOptionParents.provider, ...managed } }],
    pricing: [],
    priceSetLinks: [],
    region: shippingOptionRegionIds.map(id => ({ table: "region", row: { id, name: "Region138-" + id, currency_code: "eur",
      automatic_taxes: true, metadata: null, ...managed } })),
  };
}
