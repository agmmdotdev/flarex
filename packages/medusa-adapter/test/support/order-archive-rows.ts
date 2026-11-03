import type { OrderInitialRow } from "./logical-order-fixture";

export const orderArchiveStamp = "2020-02-03T04:05:06.000Z";
export const orderArchiveIds = ["order173-d", "order173-b", "order173-c", "order173-a"] as const;

/** Explicit existing native serial values. This seed grants no Order creation
 * or serial allocation capability and contains no fixture business algorithm. */
export function orderArchiveRows(): readonly OrderInitialRow[] {
  return orderArchiveIds.map((id, index) => ({ table: "order", row: {
    id, display_id: 300 + index, custom_display_id: "existing-" + id, region_id: "reg-existing", customer_id: "cus-existing",
    version: index + 1, sales_channel_id: "sc-existing", status: index === 1 ? "canceled" : index === 2 ? "draft" : "completed",
    is_draft_order: index === 2, email: `existing-${index}@example.invalid`, currency_code: index % 2 ? "eur" : "usd",
    locale: "en-US", no_notification: index % 2 === 0, metadata: { ordinal: index, preserved: { owner: id } },
    canceled_at: index === 1 ? orderArchiveStamp : null, shipping_address_id: null, billing_address_id: null,
    created_at: orderArchiveStamp, updated_at: orderArchiveStamp, deleted_at: null,
  } }));
}
