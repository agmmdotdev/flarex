import type { CoreOrderInitialRow as OrderInitialRow } from "./core-order-fixture";
import { orderCompletionRows } from "./order-completion-rows";

export type { OrderInitialRow };

export const orderChangeUpdateStamp = "2020-02-03T04:05:06.000Z";
export const orderChangeUpdateIds = ["ordch-update-d", "ordch-update-b", "ordch-update-c", "ordch-update-a"] as const;
const orderChangeUpdateActionIds = orderChangeUpdateIds.map(id => "ordchact-" + id);
export function orderChangeUpdateRows(): readonly OrderInitialRow[] {
  const parents = orderCompletionRows();
  const changes = orderChangeUpdateIds.map((id, index): OrderInitialRow => ({ table: "order_change", row: {
    id, order_id: parents[index]!.row.id!, return_id: index === 0 ? "ret-existing" : null,
    claim_id: index === 1 ? "claim-existing" : null, exchange_id: index === 2 ? "exchange-existing" : null,
    version: index + 1, change_type: "existing-edit", description: "Original " + id,
    status: ["pending", "requested", "canceled", null][index]!, internal_note: index % 2 ? null : "Private " + id,
    created_by: "creator-" + id, requested_by: "requester-" + id, requested_at: orderChangeUpdateStamp,
    confirmed_by: null, confirmed_at: null, declined_by: null, declined_reason: null, declined_at: null,
    canceled_by: index === 2 ? "original-canceler" : null, canceled_at: index === 2 ? orderChangeUpdateStamp : null,
    metadata: { ordinal: index, nested: { unchanged: id }, literal_empty: "" }, carry_over_promotions: index % 2 === 0,
    created_at: orderChangeUpdateStamp, updated_at: orderChangeUpdateStamp, deleted_at: null,
  } }));
  const actions = changes.map((change, index): OrderInitialRow => ({ table: "order_change_action", row: {
    id: orderChangeUpdateActionIds[index]!, order_id: change.row.order_id!, order_change_id: change.row.id!,
    return_id: null, claim_id: null, exchange_id: null, ordering: 200 + index, version: index + 1,
    reference: "order_item", reference_id: "existing-item-" + index, action: "ITEM_UPDATE", details: { preserved: index },
    amount: null, raw_amount: null, internal_note: "Existing Action", applied: index % 2 === 0,
    created_at: orderChangeUpdateStamp, updated_at: orderChangeUpdateStamp, deleted_at: null,
  } }));
  return [...parents, ...changes, ...actions];
}
