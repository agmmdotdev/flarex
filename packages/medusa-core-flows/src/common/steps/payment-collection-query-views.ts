import { Result, Schema } from "effect";
import { PaymentCollectionStatus } from "@medusajs/framework/utils/portable";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

const RawAmount = Schema.Struct({ value: Schema.String, precision: Schema.Finite });
const Reference = Schema.Struct({ id: Schema.String });
export const CartCollectionCreateQuery = Schema.Struct({ entry_point: Schema.Literal("cart"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("completed_at"), Schema.Literal("currency_code"),
    Schema.Literal("total"), Schema.Literal("raw_total"), Schema.Literal("payment_collection.id")]),
  variables: Schema.Struct({ id: Schema.String }), throw_if_key_not_found: Schema.Literal(true), list: Schema.Literal(false) });
export const CartCollectionCreateView = Schema.Struct({ id: Schema.String, completed_at: Schema.NullOr(Schema.String),
  currency_code: Schema.String, total: Schema.Finite, raw_total: RawAmount, payment_collection: Schema.optionalKey(Schema.NullOr(Reference)) });
export const CartCollectionRefreshQuery = Schema.Struct({ entity: Schema.Literal("cart"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("region_id"), Schema.Literal("currency_code"), Schema.Literal("total"),
    Schema.Literal("raw_total"), Schema.Literal("payment_collection.id"), Schema.Literal("payment_collection.raw_amount"),
    Schema.Literal("payment_collection.amount"), Schema.Literal("payment_collection.currency_code"), Schema.Literal("payment_collection.payment_sessions.id")]),
  filters: Schema.Struct({ id: Schema.String }), options: Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true), isList: Schema.Literal(false) }) });
export const CartCollectionRefreshView = Schema.Struct({ id: Schema.String, region_id: Schema.NullOr(Schema.String), currency_code: Schema.String,
  total: Schema.Finite, raw_total: RawAmount, payment_collection: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String,
    amount: Schema.Finite, raw_amount: RawAmount, currency_code: Schema.String, payment_sessions: Schema.Array(Reference) }))) });
export const OrderCollectionCreateQuery = Schema.Struct({ entity: Schema.Literal("order"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("summary"), Schema.Literal("total"), Schema.Literal("currency_code"), Schema.Literal("region_id")]),
  filters: Schema.Struct({ id: Schema.String }), options: Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true), isList: Schema.Literal(false) }) });
export const OrderCollectionCreateView = Schema.Struct({ id: Schema.String, summary: Schema.NullOr(Schema.JsonObject), total: Schema.Finite,
  currency_code: Schema.String, region_id: Schema.NullOr(Schema.String) });
export const CollectionCancellationQuery = Schema.Struct({ entity: Schema.Literal("payment_collection"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("status"), Schema.Literal("payments.id"), Schema.Literal("payments.captured_at"), Schema.Literal("captured_amount")]),
  filters: Schema.Struct({ id: Schema.String }) });
export const CollectionCancellationView = Schema.Struct({ id: Schema.String, status: Schema.Literals(Object.values(PaymentCollectionStatus)),
  payments: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String, captured_at: Schema.NullOr(Schema.String) }))), captured_amount: Schema.NullOr(Schema.Finite) });
const isRefresh = Schema.is(CartCollectionRefreshQuery), isOrder = Schema.is(OrderCollectionCreateQuery), isCancel = Schema.is(CollectionCancellationQuery);
const decodeRefresh = Schema.decodeUnknownResult(Schema.Tuple([CartCollectionRefreshView]), { onExcessProperty: "error" });
const decodeOrder = Schema.decodeUnknownResult(Schema.Tuple([OrderCollectionCreateView]), { onExcessProperty: "error" });
const decodeCancel = Schema.decodeUnknownResult(Schema.Array(CollectionCancellationView), { onExcessProperty: "error" });
export const decodeCartCollectionCreateView = Schema.decodeUnknownResult(CartCollectionCreateView, { onExcessProperty: "error" });
const malformed = () => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native payment collection graph projection" });

/** Exact selected views; no full DTO assertion, storage decoder or query grant. */
export function decodePaymentCollectionGraphRows(input: unknown, rows: readonly (typeof Schema.JsonObject.Type)[]) {
  if (isRefresh(input)) return decodeRefresh(rows).pipe(Result.mapError(malformed));
  if (isOrder(input)) return decodeOrder(rows).pipe(Result.mapError(malformed));
  if (isCancel(input)) return decodeCancel(rows).pipe(Result.mapError(malformed));
  return Result.succeed(rows);
}
