import { Effect, Result, Schema } from "effect";
import { prepareWorkflowGraphQuery, WorkflowGraphOptions, WorkflowGraphQuery, WorkflowGraphResult } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PreparedLocalGraph } from "../local-graph/model";
import type { CommercePromiseOwner } from "../module/promise-owner";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import { captureWorkflowInput } from "./value";
import { captureCommerceInput } from "../value/input";

const Name = Schema.String.check(Schema.isBetweenLength(1, 256), Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Fields = Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 256))).check(Schema.isBetweenLength(1, 256));
const VariantPriceSetIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(
  Schema.isMaxLength(8), Schema.makeFilter(ids => new Set(ids).size <= 4));
const decodeRemote = commerceDecoder(Schema.Union([
  Schema.Struct({ entryPoint: Schema.Literal("cart_promotion"),
    fields: Schema.Tuple([Schema.Literal("cart_id"), Schema.Literal("promotion_id")]),
    variables: Schema.Struct({ cart_id: Schema.Array(Schema.String).check(Schema.isMaxLength(4)) }) }),
  Schema.Struct({ entryPoint: Name, fields: Fields,
    variables: Schema.Struct({ id: Schema.Array(Schema.UndefinedOr(Schema.String)).check(Schema.isMaxLength(commerceLimits.catalogRows)) }) }),
  Schema.Struct({ service: Name, fields: Fields, variables: Schema.Struct({ filters: Schema.JsonObject }) }),
  Schema.Struct({ entryPoint: Schema.Literal("product_variant_price_set"),
    fields: Schema.Tuple([Schema.Literal("variant_id"), Schema.Literal("price_set_id")]),
    variables: Schema.Struct({ variant_id: VariantPriceSetIds }) }),
]), "unsupportedProfile");
const decodeSingleton = commerceDecoder(Schema.Union([Schema.Tuple([
  Schema.Struct({ entryPoint: Schema.Literals(["stock_location", "fulfillment", "payment", "order", "refund_reason", "cart"]), fields: Fields, variables: Schema.Struct({ id: Schema.String }) }),
  Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true), throwIfRelationNotFound: Schema.optionalKey(Schema.Undefined) }),
]), Schema.Tuple([
  Schema.Struct({ entryPoint: Schema.Literals(["payment_collection", "customer"]), fields: Fields, variables: Schema.Struct({ id: Schema.String }) }),
  Schema.Struct({ throwIfKeyNotFound: Schema.Literal(false), throwIfRelationNotFound: Schema.optionalKey(Schema.Undefined) }),
]), Schema.Tuple([
  Schema.Struct({ entryPoint: Schema.Literal("order_payment_collection"), fields: Fields,
    variables: Schema.Struct({ payment_collection_id: Schema.String }) }),
  Schema.Struct({ throwIfKeyNotFound: Schema.Boolean, throwIfRelationNotFound: Schema.optionalKey(Schema.Undefined) }),
])]), "unsupportedProfile");
const decodeGraphArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([WorkflowGraphQuery]), Schema.Tuple([WorkflowGraphQuery, WorkflowGraphOptions]),
]), "unsupportedProfile");
const TaggedCalculation = Schema.StructWithRest(Schema.Struct({ __type: Schema.Literal("QueryContext") }),
  [Schema.Record(Schema.String, Schema.Json)]);
const decodeNativeContext = commerceDecoder(Schema.Struct({ calculated_price: Schema.optionalKey(TaggedCalculation) }), "unsupportedProfile");
const ShippingContext = Schema.Record(Schema.String, Schema.Json).check(Schema.makeFilter(value => Object.keys(value).length <= 16));
const ShippingIds = Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))]);
const ShippingAddress = Schema.Struct({ country_code: Schema.optionalKey(Schema.NullOr(Schema.String)), province_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
  city: Schema.optionalKey(Schema.NullOr(Schema.String)), postal_expression: Schema.optionalKey(Schema.NullOr(Schema.String)) });
const decodeShippingRemote = commerceDecoder(Schema.Tuple([Schema.Struct({ entryPoint: Schema.Literal("shipping_options"), fields: Fields,
  variables: Schema.Struct({ id: Schema.optionalKey(ShippingIds), context: Schema.optionalKey(ShippingContext),
    filters: Schema.Struct({ id: Schema.optionalKey(ShippingIds), fulfillment_set_id: Schema.Array(Schema.String).check(Schema.isMaxLength(4)), address: ShippingAddress }),
    calculated_price: Schema.optionalKey(Schema.Struct({ context: Schema.JsonObject })) }),
}), Schema.Struct({ throwIfKeyNotFound: Schema.Literal(false), throwIfRelationNotFound: Schema.optionalKey(Schema.Undefined) })]), "unsupportedProfile");
const decodeShippingContext = commerceDecoder(Schema.StructWithRest(Schema.Struct({ __type: Schema.Literal("QueryContext") }),
  [Schema.Record(Schema.String, Schema.Json)]), "unsupportedProfile");

const decodeGraphResult = commerceDecoder(WorkflowGraphResult.check(Schema.makeFilter(value =>
  value.data.length <= commerceLimits.catalogRows && value.metadata.count <= commerceLimits.catalogRows &&
  value.metadata.skip < commerceLimits.catalogRows && value.metadata.take <= commerceLimits.catalogRows)), "storedCorruption");

/** Admit the selected native producer ABIs, then delegate normalization,
 * fetching, missing-key behavior and presentation to the bound native Query. */
export function bindWorkflowQuery(graph: PreparedLocalGraph, context: AtomicCommerceContext, owner: CommercePromiseOwner) {
  const query = graph.bind(context);
  const remote = (...args: unknown[]) => owner.run(Effect.gen(function* () {
    if (args.length === 2) {
      const candidate = yield* checkedCommerceValue(context, () => captureWorkflowInput(args));
      const [input, options] = yield* checkedCommerceValue(context, () => decodeShippingRemote(candidate)
        .pipe(Result.orElse(() => decodeSingleton(candidate))));
      return yield* query.remoteQuery(input, options);
    }
    if (args.length !== 1) return yield* context.refuse(commerceError("unsupportedProfile"));
    const input = yield* checkedCommerceValue(context, () => captureWorkflowInput(args[0]).pipe(Result.flatMap(decodeRemote)));
    return yield* query.remoteQuery(input);
  }));
  const nativeGraph = (...args: unknown[]) => owner.run(Effect.gen(function* () {
    const [input, options] = yield* checkedCommerceValue(context, () => captureWorkflowInput(args).pipe(Result.flatMap(decodeGraphArguments)));
    const plan = yield* checkedCommerceValue(context, () => prepareWorkflowGraphQuery({ ...input,
      ...(options === undefined ? {} : { options }) }, commerceLimits.catalogRows)
      .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
    if (plan.query.context !== undefined) {
      if (plan.query.entity === "shipping_options") {
        yield* checkedCommerceValue(context, () => decodeShippingContext(plan.query.context));
      } else {
        const calculation = yield* checkedCommerceValue(context, () => decodeNativeContext(plan.query.context));
        if (calculation.calculated_price !== undefined && plan.query.entity !== "variant" && plan.query.entity !== "variants")
          return yield* context.refuse(commerceError("unsupportedProfile"));
      }
    }
    const native = yield* query.nativeGraph(plan.query, plan.queryOptions);
    const result = yield* checkedCommerceValue(context, () => captureCommerceInput(native).pipe(Result.flatMap(decodeGraphResult)));
    yield* checkedCommerceValue(context, () => plan.validate(result).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
    return result;
  }));
  return Object.freeze(Object.assign(remote, { maxPageSize: commerceLimits.catalogRows, graph: nativeGraph }));
}
