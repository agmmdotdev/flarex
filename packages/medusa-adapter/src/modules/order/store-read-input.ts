import { Schema } from "effect";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";

export const storeOrderPageLimit = 50;
export const storeOrderRelatedLimit = 200;
/** Page/count, local population and native formatting share one bounded command. */
export const storeOrderReadCommandMs = 30_000;
/** Native fifty-Order totals retain the full numeric DTO within the existing
 * shared node ceiling; bytes, calls and row limits keep ordinary values. */
export const storeOrderReadResources = Object.freeze({ ...defaultCommerceResources, valueNodes: 65_536 });
const PublicIds = Schema.Union([ScalarId, Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(storeOrderPageLimit))]);
const RelatedIds = Schema.Union([ScalarId, Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(storeOrderRelatedLimit))]);
const Status = Schema.Union([Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(storeOrderPageLimit))]);
const fields = { id: Schema.optionalKey(PublicIds), status: Schema.optionalKey(Status) };
export interface PublicFilters { readonly id?: string | readonly string[]; readonly status?: string | readonly string[];
  readonly $and?: readonly PublicFilters[]; readonly $or?: readonly PublicFilters[] }
const logical = (child: Schema.Codec<PublicFilters>) => ({
  $and: Schema.optionalKey(Schema.Array(child).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  $or: Schema.optionalKey(Schema.Array(child).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
});
const leaf = Schema.Struct(fields), first = Schema.Struct({ ...fields, ...logical(leaf) }),
  second = Schema.Struct({ ...fields, ...logical(first) });
export const StoreOrderPublicFilters = Schema.Struct({ ...fields, ...logical(second) });
export const StoreOrderListFilters = Schema.Struct({ ...StoreOrderPublicFilters.fields,
  customer_id: ScalarId, is_draft_order: Schema.Literal(false) });
export const StoreOrderFilters = Schema.Struct({ ...StoreOrderPublicFilters.fields, id: Schema.optionalKey(RelatedIds),
  customer_id: Schema.optionalKey(ScalarId), is_draft_order: Schema.optionalKey(Schema.Literal(false)),
  version: Schema.optionalKey(Schema.Int), order_id: Schema.optionalKey(RelatedIds) });
export const StoreOrderReadConfig = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isBetweenLength(1, 256))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(32))),
  take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.Literals(["ASC", "DESC"]) })),
});
export const StoreOrderRead = Schema.Struct({ filters: StoreOrderFilters, config: Schema.optionalKey(StoreOrderReadConfig) });
export const decodeStoreOrderRead = commerceDecoder(StoreOrderRead, "invalidInput");
export const decodeStoreOrderCount = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(storeOrderRelatedLimit)),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
]), "storedCorruption");
