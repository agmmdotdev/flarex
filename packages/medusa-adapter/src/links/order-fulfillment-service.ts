import { Effect, Result, Schema } from "effect";
import { OrderFulfillment } from "@medusajs/link-modules";
import { OrderModuleService } from "@medusajs/order/services";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceCommandPreparation } from "../module/commands";
import { defineGraphReadCommand } from "../local-graph/commands";
import { moduleAliases } from "../local-graph/module";
import { nativeLinkGraphEndpoints, nativeLinkGraphPaths, nativeLinkGraphServices } from "../local-graph/links";
import { decodeGraphCount } from "../local-graph/query";
import { defineWorkflowModule } from "../workflow/module";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { ScalarId } from "../repository/scalar-id-read";
import { storeOrderPageLimit, storeOrderRelatedLimit } from "../modules/order/store-read-input";
import { prepareLinkService, withNativeLinkGraphMetadata } from "./service";
import { linkLogicalEventPolicy } from "./events";
import { checkoutLinkReadPolicy } from "./checkout-link-read-receipt";
import { captureOrderFulfillmentLinkMetadata } from "./order-fulfillment-schema";

const Filter = Schema.Union([ScalarId, Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(storeOrderRelatedLimit))]);
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  id: Schema.optionalKey(Filter), order_id: Schema.optionalKey(Filter), fulfillment_id: Schema.optionalKey(Filter),
})), config: Schema.optionalKey(Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable)),
  skip: Schema.optionalKey(Schema.Literal(0)), take: Schema.optionalKey(Schema.Literals([4, 15, 50, 200, 256])),
  order: Schema.optionalKey(Schema.Struct({ order_id: Schema.optionalKey(Schema.Literal("ASC")) })),
})) }), "invalidInput");

/** Genuine stored Order–Fulfillment links, with a named Store page cohort. */
export const prepareOrderFulfillmentLinkRead = Effect.fn("OrderFulfillmentLink.prepareRead")(function* () {
  const metadata = yield* captureOrderFulfillmentLinkMetadata(), prepared = yield* prepareLinkService(metadata);
  const prepare = commerceCommandPreparation("OrderFulfillmentLink.prepareInput")(decodeRead);
  const count = defineGraphReadCommand("orderFulfillmentCountForStore", Effect.fn("OrderFulfillmentLink.count")(function* (ctx: CommerceCommandContext, input: Json) {
    const args = yield* prepare(ctx, input);
    const result = yield* prepared.useService(ctx, ({ service, context }) => service.listAndCount(args.filters,
      { ...args.config, take: args.config?.take ?? storeOrderRelatedLimit }, context));
    const [rows, total] = yield* Effect.fromResult(decodeGraphCount(result)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (total > storeOrderRelatedLimit || rows.length !== total) return yield* ctx.refuse(commerceError("limitExceeded"));
    return [rows, total];
  }));
  const aliases = yield* Effect.fromResult(moduleAliases(prepared.joiner)), model = aliases[0]?.model;
  if (model === undefined || aliases.some(alias => alias.model !== model)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const endpoints = yield* Effect.fromResult(nativeLinkGraphEndpoints(prepared.joiner, [
    { path: "order", maximumSources: storeOrderRelatedLimit, maximumTargets: storeOrderPageLimit },
    { path: "fulfillments", maximumSources: storeOrderRelatedLimit, maximumTargets: storeOrderRelatedLimit },
  ]));
  const remotePaths = yield* Effect.fromResult(nativeLinkGraphPaths(prepared.joiner, [
    { root: "Order", path: "fulfillments", maximumSources: storeOrderPageLimit, maximumLinks: storeOrderRelatedLimit,
      maximumTargets: storeOrderRelatedLimit, maximumPerSource: 4 },
    { root: "Fulfillment", path: "order", maximumSources: storeOrderRelatedLimit, maximumLinks: storeOrderRelatedLimit,
      maximumTargets: storeOrderPageLimit, maximumPerSource: 1 },
  ], undefined, [OrderFulfillment]));
  const base = linkLogicalEventPolicy(metadata.frame.name, prepared.serviceName, prepared.entityName, ["order_id", "fulfillment_id"]);
  const policy = yield* Effect.fromResult(checkoutLinkReadPolicy(metadata.frame, ["order_id", "fulfillment_id"], "orderFulfillmentCountForStore",
    "OrderFulfillmentLink.validateRead", base, input => Result.gen(function* () {
      const args = yield* decodeRead(input);
      const plan = yield* captureCommerceInput(buildQuery(args.filters, { ...args.config, take: args.config?.take ?? storeOrderRelatedLimit,
        ...(args.config?.select === undefined ? {} : { select: [...args.config.select] }),
        ...(args.config?.relations === undefined ? {} : { relations: [...args.config.relations] }),
      })).pipe(Result.flatMap(query => prepared.prepared.readPlan(query, defaultCommerceResources.queryRows)));
      return { plan, includes: (row: JsonObject) => row.deleted_at === null && (["id", "order_id", "fulfillment_id"] as const).every(name => {
        const filter = args.filters?.[name], value = row[name];
        return filter === undefined || typeof value === "string" && (typeof filter === "string" ? value === filter : filter.includes(value));
      }) };
    }), storeOrderRelatedLimit));
  const commands = [count];
  const graph = yield* Effect.fromResult(withNativeLinkGraphMetadata({ aliases, services: yield* Effect.fromResult(nativeLinkGraphServices(prepared.joiner)),
    reads: [{ model, command: count, table: prepared.prepared.table, paths: [], orderable: ["order_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }],
    linkEndpoints: endpoints, remotePaths }, [prepared.joiner], [metadata.frame],
  [OrderModuleService.prototype.__joinerConfig(), FulfillmentModuleService.prototype.__joinerConfig()]));
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "order_fulfillment_links", source: {
    name: prepared.serviceName, profile: "order-fulfillment.store-read" }, methods: {}, graph, logical: { ...policy, commands } }));
  return { metadata, prepared, workflow, count, commands, logicalEventPolicy: () => policy };
});
