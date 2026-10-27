import { checkoutLinkReadPolicy } from "./checkout-link-read-receipt";
import { Effect, Result, Schema } from "effect";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { CartPaymentCollection } from "@medusajs/link-modules";
import { commerceCommandPreparation } from "../module/commands";
import { defineGraphReadCommand } from "../local-graph/commands";
import { moduleAliases } from "../local-graph/module";
import { nativeLinkGraphEndpoints, nativeLinkGraphPaths, nativeLinkGraphServices } from "../local-graph/links";
import { decodeGraphCount } from "../local-graph/query";
import { defineWorkflowModule } from "../workflow/module";
import { commerceDecoder } from "../value/decoder";
import { ScalarId as Id } from "../repository/scalar-id-read";
import { prepareLinkService } from "./service";
import { linkLogicalEventPolicy } from "./events";
import { captureCartPaymentCollectionLinkMetadata } from "./cart-payment-collection-schema";
import { captureCommerceInput } from "../value/input";

const Filter = Schema.Union([Id, Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4))]);
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  id: Schema.optionalKey(Filter), cart_id: Schema.optionalKey(Filter), payment_collection_id: Schema.optionalKey(Filter),
})), config: Schema.optionalKey(Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable)),
  skip: Schema.optionalKey(Schema.Literal(0)), take: Schema.optionalKey(Schema.Literals([4, 15, 256])),
  order: Schema.optionalKey(Schema.Struct({ cart_id: Schema.optionalKey(Schema.Literal("ASC")) })),
})) }), "invalidInput");

/** Genuine stored Module Link reads. Payment workflows receive no Link create,
 * cascade or dismissal capability; installed rows remain authoritative. */
export const prepareCartPaymentCollectionLinkRead = Effect.fn("CartPaymentCollectionLink.prepareRead")(function* () {
  const metadata = yield* captureCartPaymentCollectionLinkMetadata(), prepared = yield* prepareLinkService(metadata);
  const prepare = commerceCommandPreparation("CartPaymentCollectionLink.prepareInput")(decodeRead);
  const count = defineGraphReadCommand("cartPaymentCollectionCount", Effect.fn("CartPaymentCollectionLink.count")(function* (ctx: CommerceCommandContext, input: Json) {
    const args = yield* prepare(ctx, input);
    const result = yield* prepared.useService(ctx, ({ service, context }) => service.listAndCount(args.filters,
      { ...args.config, take: args.config?.take ?? 4 }, context));
    const [rows, total] = yield* Effect.fromResult(decodeGraphCount(result))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (total > 4 || rows.length !== total) return yield* ctx.refuse(commerceError("limitExceeded"));
    return [rows, total];
  }));
  const aliases = yield* Effect.fromResult(moduleAliases(prepared.joiner)), model = aliases[0]?.model;
  if (model === undefined || aliases.some(alias => alias.model !== model)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const endpoints = yield* Effect.fromResult(nativeLinkGraphEndpoints(prepared.joiner, [
    { path: "cart", maximumSources: 4, maximumTargets: 4 },
    { path: "payment_collection", maximumSources: 4, maximumTargets: 4 },
  ]));
  const remotePaths = [
    ...(yield* Effect.fromResult(nativeLinkGraphPaths(prepared.joiner, [
      { root: "Cart", path: "payment_collection", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 },
      { root: "PaymentCollection", path: "cart", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 },
    ], undefined, [CartPaymentCollection]))),
  ];
  const basePolicy = linkLogicalEventPolicy(metadata.frame.name, prepared.serviceName, prepared.entityName, ["cart_id", "payment_collection_id"]);
  const policy = yield* Effect.fromResult(checkoutLinkReadPolicy(metadata.frame, ["cart_id", "payment_collection_id"], "cartPaymentCollectionCount",
    "CartPaymentCollectionLink.validateRead", basePolicy, input => Result.gen(function* () {
      const args = yield* decodeRead(input);
      const plan = yield* captureCommerceInput(buildQuery(args.filters, { ...args.config, take: args.config?.take ?? 4,
        ...(args.config?.select === undefined ? {} : { select: [...args.config.select] }),
        ...(args.config?.relations === undefined ? {} : { relations: [...args.config.relations] }),
      })).pipe(Result.flatMap(query => prepared.prepared.readPlan(query, defaultCommerceResources.queryRows)));
      return { plan, includes: (row: JsonObject) => row.deleted_at === null &&
        (["id", "cart_id", "payment_collection_id"] as const).every(name => {
          const filter = args.filters?.[name], value = row[name];
          return filter === undefined || typeof value === "string" && (typeof filter === "string" ? filter === value : filter.includes(value));
        }) };
    })));
  const commands = [count];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "cart_payment_collection_links",
    source: { name: prepared.serviceName, profile: "cart-payment-collection-read" }, methods: {},
    graph: { aliases, services: yield* Effect.fromResult(nativeLinkGraphServices(prepared.joiner)),
      reads: [{ model, command: count, table: prepared.prepared.table, paths: [], orderable: ["cart_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }],
      linkEndpoints: endpoints, remotePaths }, logical: { ...policy, commands } }));
  return { metadata, prepared, workflow, count, commands, logicalEventPolicy: () => policy };
});
