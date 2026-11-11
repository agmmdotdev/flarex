import { Effect, Schema } from "effect";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductVariantParentReadConfig = Schema.Struct({
  select: Schema.Tuple([Schema.Literal("id"), Schema.Literal("product_id")]), relations: Schema.Array(Schema.Never),
});
export const ProductVariantParentRows = Schema.Array(Schema.Struct({ id: Id, product_id: Id })).check(Schema.isMaxLength(8));
const decodeInput = commerceDecoder(Schema.Struct({ filters: Schema.Struct({
  id: Schema.Array(Id).check(Schema.isLengthBetween(1, 8)), product_id: Schema.optionalKey(Id),
}), config: ProductVariantParentReadConfig }), "receiptMismatch");
const decodeOutput = commerceDecoder(ProductVariantParentRows, "receiptMismatch");
const isParentConfig = Schema.is(ProductVariantParentReadConfig);

/** Membership identifies this exact native projection, leaving ordinary
 * preimage reads on their existing receipt path. */
export function isProductVariantParentRead(input: Json) {
  return isJsonObject(input) && isParentConfig(input.config);
}

/** Both Product-owned parent guards bind their exact projection to the genuine
 * observed rows. The DAL read retains the same root's OCC dependency. */
export const validateProductVariantParentRead = Effect.fn("Product.validateVariantParentRead")(function* (
  table: string, call: Parameters<LogicalCommerceCallValidation>[0], activity: Parameters<LogicalCommerceCallValidation>[1],
) {
  const input = yield* Effect.fromResult(decodeInput(call.input));
  const result = yield* Effect.fromResult(decodeOutput(call.result));
  const expected = activity.observedRows.filter(({ table: observedTable, row }) => observedTable === table &&
    typeof row.id === "string" && input.filters.id.includes(row.id) &&
    (input.filters.product_id === undefined || row.product_id === input.filters.product_id) && row.deleted_at === null);
  if (call.mode !== "read" || result.length !== expected.length || new Set(result.map(row => row.id)).size !== result.length ||
    result.some(row => !expected.some(observed => observed.row.id === row.id && observed.row.product_id === row.product_id)))
    return yield* Effect.fail(commerceError("receiptMismatch"));
});
