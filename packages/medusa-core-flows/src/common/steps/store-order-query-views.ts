import { Result, Schema } from "effect";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

const Json = Schema.Record(Schema.String, Schema.Unknown);
const RawAmount = Schema.Struct({ value: Schema.String, precision: Schema.Finite });
const Amount = Schema.NullOr(Schema.Finite);
const Collection = Schema.StructWithRest(Schema.Struct({ status: Schema.String,
  amount: Schema.Finite, captured_amount: Schema.optionalKey(Amount), refunded_amount: Schema.optionalKey(Amount),
}), [Json]);
const Time = Schema.optionalKey(Schema.NullOr(Schema.String));
const Fulfillment = Schema.StructWithRest(Schema.Struct({ packed_at: Time, shipped_at: Time, delivered_at: Time, canceled_at: Time }), [Json]);
const Detail = Schema.StructWithRest(Schema.Struct({ raw_fulfilled_quantity: Schema.optionalKey(RawAmount) }), [Json]);
const Item = Schema.StructWithRest(Schema.Struct({ raw_quantity: Schema.optionalKey(RawAmount),
  detail: Schema.optionalKey(Schema.NullOr(Detail)),
}), [Json]);

/** These are the native status helpers' consumed selections, not full Order
 * DTOs. The Query owner has already captured and authenticated every dynamic
 * field. Other native intermediate fields and omissions remain present. */
export const StoreOrderStatusView = Schema.StructWithRest(Schema.Struct({
  currency_code: Schema.optionalKey(Schema.String),
  payment_collections: Schema.Array(Collection), fulfillments: Schema.Array(Fulfillment),
  items: Schema.optionalKey(Schema.Array(Item)),
  payment_status: Schema.mutableKey(Schema.optionalKey(Schema.String)), fulfillment_status: Schema.mutableKey(Schema.optionalKey(Schema.String)),
}), [Json]);
export type StoreOrderStatusView = typeof StoreOrderStatusView.Type;
const decodeStatus = Schema.decodeUnknownResult(StoreOrderStatusView, { onExcessProperty: "error" });
const invalid = () => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Store Order status projection" });
function assertStoreOrderStatusView(input: unknown): asserts input is StoreOrderStatusView {
  Result.getOrThrow(decodeStatus(input).pipe(Result.mapError(invalid)));
}
export function decodeStoreOrderStatusView(input: unknown) {
  // This schema has no transformations. Keep the actual native object's
  // identity: aggregation mutates the same Order held by the result page.
  assertStoreOrderStatusView(input);
  return input;
}

const PageNumber = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const StoreOrderListQuery = Schema.Struct({ entry_point: Schema.Literal("orders"),
  fields: Schema.Array(Schema.String), list: Schema.Literal(true),
  variables: Schema.Struct({ filters: Schema.JsonObject, skip: PageNumber, take: PageNumber,
    order: Schema.optionalKey(Schema.UndefinedOr(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"])))) }),
});
export const isStoreOrderListQuery = Schema.is(StoreOrderListQuery);
export type StoreOrderListVariables = typeof StoreOrderListQuery.Type["variables"];
export const StoreOrderListResult = Schema.Struct({ rows: Schema.Array(Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))),
  metadata: Schema.Struct({ count: PageNumber, skip: PageNumber, take: PageNumber }),
});
export type StoreOrderListResult = typeof StoreOrderListResult.Type;
export const decodeStoreOrderListResult = Schema.decodeUnknownResult(StoreOrderListResult, { onExcessProperty: "error" });
