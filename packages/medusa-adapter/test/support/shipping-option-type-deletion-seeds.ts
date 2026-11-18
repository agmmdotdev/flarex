import { Schema } from "effect";
import { shippingProfileOptionParents, shippingProfileDeletionSeedTime, type ShippingProfileDeletionInitialRow } from "./shipping-profile-seeds";

export const shippingOptionTypeDeletionSeedTime = shippingProfileDeletionSeedTime;
const managed = (deleted = false) => ({ created_at: shippingOptionTypeDeletionSeedTime, updated_at: shippingOptionTypeDeletionSeedTime,
  deleted_at: deleted ? shippingOptionTypeDeletionSeedTime : null });

export const shippingOptionTypeDeletionParents: readonly ShippingProfileDeletionInitialRow[] = [...shippingProfileOptionParents,
  { table: "shipping_profile", row: { id: "sotype-delete-profile", name: "Type deletion Profile", type: "default", metadata: null, ...managed() } },
];

export function shippingOptionTypeDeletionGraph(prefix: string, count = 1, options: Readonly<{
  optionsPerType?: number; deletedOptions?: boolean; deletedTypes?: boolean;
}> = {}) {
  const ids = Array.from({ length: count }, (_, index) => `${prefix}-type-${index}`);
  const rows: ShippingProfileDeletionInitialRow[] = ids.flatMap(id => [
    { table: "shipping_option_type", row: { id, label: " Native " + id, description: null, code: " Native CODE ", ...managed(options.deletedTypes) } },
    ...Array.from({ length: options.optionsPerType ?? 0 }, (_, index) => ({ table: "shipping_option", row: {
      id: `${id}-option-${index}`, name: "Canonical native Option", price_type: "flat", data: null, metadata: { fixture: prefix },
      service_zone_id: "sp-delete-zone", shipping_profile_id: "sotype-delete-profile", provider_id: "sp-delete-provider",
      shipping_option_type_id: id, ...managed(options.deletedOptions),
    } })),
  ]);
  return { ids, optionIds: rows.filter(row => row.table === "shipping_option").map(row => Schema.decodeUnknownSync(Schema.String)(row.row.id)), rows };
}
