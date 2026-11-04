import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

export const shippingProfileDeletionSeedTime = "2026-10-17T00:00:00.000Z";
export type ShippingProfileDeletionInitialRow = Readonly<{ table: string; row: JsonObject }>;
const managed = (deleted = false) => ({ created_at: shippingProfileDeletionSeedTime, updated_at: shippingProfileDeletionSeedTime,
  deleted_at: deleted ? shippingProfileDeletionSeedTime : null });

/** Full native DML seed with every real FK target. This is canonical initial
 * state, not ShippingOption creation/provider capability. */
export const shippingProfileOptionParents: readonly ShippingProfileDeletionInitialRow[] = [
  { table: "fulfillment_set", row: { id: "sp-delete-set", name: "Shipping deletion set", type: "shipping", metadata: null, ...managed() } },
  { table: "service_zone", row: { id: "sp-delete-zone", name: "Shipping deletion zone", fulfillment_set_id: "sp-delete-set", metadata: null, ...managed() } },
  { table: "shipping_option_type", row: { id: "sp-delete-option-type", label: "Shipping deletion type", description: null, code: "shipping", ...managed() } },
  { table: "fulfillment_provider", row: { id: "sp-delete-provider", is_enabled: true, ...managed() } },
];
export function shippingProfileDeletionGraph(prefix: string, count = 1, options: Readonly<{
  optionsPerProfile?: number; deletedOptions?: boolean; deletedProfiles?: boolean; linksPerProfile?: number; deletedLinks?: boolean;
}> = {}) {
  const profiles = Array.from({ length: count }, (_, index) => `${prefix}-profile-${index}`);
  const optionIds = profiles.flatMap(id => Array.from({ length: options.optionsPerProfile ?? 0 }, (_, index) => `${id}-option-${index}`));
  const linkIds = profiles.flatMap(id => Array.from({ length: options.linksPerProfile ?? 0 }, (_, index) => `${id}-link-${index}`));
  const productIds = profiles.flatMap(id => Array.from({ length: options.linksPerProfile ?? 0 }, (_, index) => `${id}-product-${index}`));
  const rows: ShippingProfileDeletionInitialRow[] = profiles.flatMap(id => [
    { table: "shipping_profile", row: { id, name: id, type: "default", metadata: { fixture: prefix }, ...managed(options.deletedProfiles) } },
    ...Array.from({ length: options.optionsPerProfile ?? 0 }, (_, index) => ({ table: "shipping_option", row: {
      id: `${id}-option-${index}`, name: `${id} option ${index}`, price_type: "flat", data: null, metadata: { fixture: prefix },
      service_zone_id: "sp-delete-zone", shipping_profile_id: id, provider_id: "sp-delete-provider",
      shipping_option_type_id: "sp-delete-option-type", ...managed(options.deletedOptions),
    } })),
  ]);
  const links: ShippingProfileDeletionInitialRow[] = profiles.flatMap(id => Array.from({ length: options.linksPerProfile ?? 0 }, (_, index) => ({
    table: "product_shipping_profile", row: { id: `${id}-link-${index}`, product_id: `${id}-product-${index}`,
      shipping_profile_id: id, ...managed(options.deletedLinks) },
  })));
  return { profiles, optionIds, linkIds, productIds, rows, links };
}
