import { Result, Schema } from "effect";
import { OrderStatus } from "@medusajs/framework/utils/portable";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

// Exact selected projections for the pinned refund roots. Stored data and
// quantities have already crossed their native DML and numeric boundaries.
// These views grant no additional query, module or persistence capability.
export const RefundCreditOrderQuery = Schema.Struct({ entity: Schema.Literal("orders"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("status"), Schema.Literal("summary"), Schema.Literal("total"),
    Schema.Literal("payment_collections.id")]), filters: Schema.Struct({ id: Schema.String }),
  options: Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true) }) });
export const RefundChangeQuery = Schema.Struct({ entity: Schema.Literal("order_change"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("status"), Schema.Literal("change_type"), Schema.Literal("actions.id"),
    Schema.Literal("actions.order_id"), Schema.Literal("actions.action"), Schema.Literal("actions.details"), Schema.Literal("actions.reference"),
    Schema.Literal("actions.reference_id"), Schema.Literal("actions.internal_note")]),
  filters: Schema.Struct({ order_id: Schema.String, status: Schema.Tuple([Schema.Literal("pending")]) }) });
export const RefundPaymentsQuery = Schema.Struct({ entity: Schema.Literal("payments"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("currency_code"), Schema.Literal("refunds.id"), Schema.Literal("refunds.amount"),
    Schema.Literal("captures.id"), Schema.Literal("captures.amount"), Schema.Literal("payment_collection.order.id"),
    Schema.Literal("payment_collection.order.currency_code")]), filters: Schema.Struct({ id: Schema.Array(Schema.String) }),
  options: Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true) }) });
const CreditOrder = Schema.Struct({ id: Schema.String, status: Schema.Literals(Object.values(OrderStatus)),
  summary: Schema.NullOr(Schema.JsonObject), total: Schema.Finite, payment_collections: Schema.Array(Schema.Struct({ id: Schema.String })) });
const Change = Schema.Struct({ id: Schema.String, status: Schema.Literal("pending"), change_type: Schema.NullOr(Schema.String),
  actions: Schema.Array(Schema.Struct({ id: Schema.String, order_id: Schema.String, action: Schema.String, details: Schema.JsonObject,
    reference: Schema.NullOr(Schema.String), reference_id: Schema.NullOr(Schema.String), internal_note: Schema.NullOr(Schema.String) })) });
const Payment = Schema.Struct({ id: Schema.String, currency_code: Schema.String,
  refunds: Schema.Array(Schema.Struct({ id: Schema.String, amount: Schema.Finite })),
  captures: Schema.Array(Schema.Struct({ id: Schema.String, amount: Schema.Finite })),
  payment_collection: Schema.NullOr(Schema.Struct({ order: Schema.NullOr(Schema.Struct({ id: Schema.String, currency_code: Schema.String })) })) });
export type RefundCreditOrderView = typeof CreditOrder.Type;
export type RefundChangeView = typeof Change.Type;
export type RefundPaymentView = typeof Payment.Type;
const isCreditOrder = Schema.is(RefundCreditOrderQuery), isChange = Schema.is(RefundChangeQuery), isPayments = Schema.is(RefundPaymentsQuery);
const decodeOrders = Schema.decodeUnknownResult(Schema.Array(CreditOrder), { onExcessProperty: "error" });
const decodeChanges = Schema.decodeUnknownResult(Schema.Array(Change), { onExcessProperty: "error" });
const decodePayments = Schema.decodeUnknownResult(Schema.Array(Payment), { onExcessProperty: "error" });
const malformed = () => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native refund graph projection" });

/** Generic graph callers retain partial JSON rows. The three exact native
 * selectors additionally authenticate the fields their typed roots consume. */
export function decodeRefundGraphRows(input: unknown, rows: readonly (typeof Schema.JsonObject.Type)[]) {
  if (isCreditOrder(input)) return decodeOrders(rows).pipe(Result.mapError(malformed));
  if (isChange(input)) return decodeChanges(rows).pipe(Result.mapError(malformed));
  if (isPayments(input)) return decodePayments(rows).pipe(Result.mapError(malformed));
  return Result.succeed(rows);
}
