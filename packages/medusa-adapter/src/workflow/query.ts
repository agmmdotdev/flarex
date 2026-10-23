import { Effect, Result, Schema } from "effect";
import { coerceFilterValue } from "@medusajs/drizzle/filter-value";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { prepareWorkflowGraphQuery, WorkflowGraphCacheOptions, WorkflowGraphQuery } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PreparedLocalGraph } from "../local-graph/model";
import type { CommercePromiseOwner } from "../module/promise-owner";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import { captureWorkflowInput } from "./value";

const Name = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Fields = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isLengthBetween(1, 256));
const VariantPriceSetIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(
  Schema.isMaxLength(8), Schema.makeFilter(ids => new Set(ids).size <= 4));
const decodeRemote = commerceDecoder(Schema.Union([
  Schema.Struct({ entryPoint: Name, fields: Fields,
    variables: Schema.Struct({ id: Schema.Array(Schema.UndefinedOr(Schema.String)).check(Schema.isMaxLength(commerceLimits.catalogRows)) }) }),
  Schema.Struct({ service: Name, fields: Fields, variables: Schema.Struct({ filters: Schema.JsonObject }) }),
  Schema.Struct({ entryPoint: Schema.Literal("product_variant_price_set"),
    fields: Schema.Tuple([Schema.Literal("variant_id"), Schema.Literal("price_set_id")]),
    variables: Schema.Struct({ variant_id: VariantPriceSetIds }) }),
]), "unsupportedProfile");
const decodeSingleton = commerceDecoder(Schema.Union([Schema.Tuple([
  Schema.Struct({ entryPoint: Schema.Literals(["stock_location", "fulfillment"]), fields: Fields, variables: Schema.Struct({ id: Schema.String }) }),
  Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true), throwIfRelationNotFound: Schema.optionalKey(Schema.Undefined) }),
]), Schema.Tuple([
  Schema.Struct({ entryPoint: Schema.Literal("payment_collection"), fields: Fields, variables: Schema.Struct({ id: Schema.String }) }),
  Schema.Struct({ throwIfKeyNotFound: Schema.Literal(false), throwIfRelationNotFound: Schema.optionalKey(Schema.Undefined) }),
])]), "unsupportedProfile");
const decodeGraphArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([WorkflowGraphQuery]), Schema.Tuple([WorkflowGraphQuery, WorkflowGraphCacheOptions]),
]), "unsupportedProfile");

/** Selected native callable ABIs over the same authenticated graph. This
 * facade owns no reads, synthetic rows, aliases, transactions or finalization. */
export function bindWorkflowQuery(graph: PreparedLocalGraph, context: AtomicCommerceContext, owner: CommercePromiseOwner) {
  const query = graph.bind(context);
  const remote = (...args: unknown[]) => owner.run(Effect.gen(function* () {
    if (args.length === 2) {
      const [input, options] = yield* checkedCommerceValue(context, () => captureWorkflowInput(args).pipe(Result.flatMap(decodeSingleton)));
      // The pinned singleton RemoteQuery and graph both remove hydration-only
      // join columns. Existing array-ID and service callers retain their native
      // projection, including their admitted Link join fields.
      const data = yield* input.entryPoint === "fulfillment"
        ? query.list({ entity: input.entryPoint, fields: input.fields, filters: { id: [input.variables.id] } })
        : Effect.gen(function* () {
          const result = yield* query.graph({ entity: input.entryPoint, fields: input.fields,
            filters: { id: [input.variables.id] }, pagination: { take: commerceLimits.catalogRows } });
          if (result.metadata.count > commerceLimits.catalogRows) return yield* context.refuse(commerceError("unsupportedProfile"));
          if (result.data.length !== result.metadata.count) return yield* context.refuse(commerceError("storedCorruption"));
          return result.data;
        });
      if (data.length > 1) return yield* context.refuse(commerceError("storedCorruption"));
      // This is the native business failure, not an ABI or authority refusal.
      // The workflow's existing invoke owner latches an unhandled rejection.
      if (data.length === 0 && options.throwIfKeyNotFound) return yield* Effect.fail(commerceError("adapterFailure",
        new MedusaError(MedusaError.Types.NOT_FOUND, (input.entryPoint === "fulfillment" ? "Fulfillment" : "StockLocation") + " id not found: " + input.variables.id)));
      return data;
    }
    if (args.length !== 1) return yield* context.refuse(commerceError("unsupportedProfile"));
    const input = yield* checkedCommerceValue(context, () => captureWorkflowInput(args[0]).pipe(Result.flatMap(decodeRemote)));
    const result = yield* "entryPoint" in input
      ? query.native({ entity: input.entryPoint, fields: input.fields,
        // RemoteJoiner.fetchData deduplicates IDs in first occurrence order.
        // The captured public call keeps its raw duplicates and empty strings;
        // this named ABI still reads the genuine stored Link graph, even [].
        filters: "variant_id" in input.variables ? { variant_id: [...new Set(input.variables.variant_id)] }
          : { id: input.variables.id.map(value => coerceFilterValue("id", value)) },
        pagination: { take: commerceLimits.catalogRows } })
      : query.service({ service: input.service, fields: input.fields, filters: input.variables.filters, pagination: { take: commerceLimits.catalogRows } });
    if (result.metadata.count > commerceLimits.catalogRows) return yield* context.refuse(commerceError("unsupportedProfile"));
    if (result.data.length !== result.metadata.count) return yield* context.refuse(commerceError("storedCorruption"));
    return result.data;
  }));
  const nativeGraph = (...args: unknown[]) => owner.run(Effect.gen(function* () {
    const [input] = yield* checkedCommerceValue(context, () => captureWorkflowInput(args).pipe(Result.flatMap(decodeGraphArguments)));
    const plan = yield* checkedCommerceValue(context, () => prepareWorkflowGraphQuery(input, commerceLimits.catalogRows)
      .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
    const result = yield* query.graph(plan.query);
    yield* checkedCommerceValue(context, () => plan.validate(result).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
    return result;
  }));
  return Object.freeze(Object.assign(remote, { maxPageSize: commerceLimits.catalogRows, graph: nativeGraph }));
}
