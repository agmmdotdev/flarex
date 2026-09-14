import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import type { FindConfig } from "@medusajs/types";
import { registerLocalCommerceProfile, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-link-schema";
import { captureProductShippingProfileLinkMetadata } from "./product-shipping-profile-link-schema";
import { prepareLinkService } from "./link-service";
import { selectedLinkEventPolicy } from "./link-events";
import { prepareProductShippingProfileSchema } from "./product-shipping-profile-schema";
import { withCommerceService } from "./commerce-service-bridge";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import { QueryLimit, QueryOffset } from "./query-decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)).pipe(Schema.mutable)]);
const IdFilter = Schema.Union([Ids, Schema.Struct({ $ne: Id })]);
const Data = Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id) }));
const SalesPair = Schema.Struct({ product: Schema.Struct({ product_id: Id }), sales_channel: Schema.Struct({ sales_channel_id: Id }), data: Data });
const ShippingPair = Schema.Struct({ product: Schema.Struct({ product_id: Id }), fulfillment: Schema.Struct({ shipping_profile_id: Id }), data: Data });
// Each array is homogeneous before the native router can fan out with promiseAll.
const Batch = Schema.Union([Schema.Array(SalesPair).check(Schema.isMaxLength(256)).pipe(Schema.mutable),
  Schema.Array(ShippingPair).check(Schema.isMaxLength(256)).pipe(Schema.mutable)]);
const decodeLinks = commerceDecoder(Schema.Union([SalesPair, ShippingPair, Batch]), "invalidInput");
const decodeArguments = commerceDecoder(Schema.Tuple([Batch]), "invalidInput");
const decodeCreated = commerceDecoder(Schema.Array(Schema.Union([
  Schema.StructWithRest(Schema.Struct({ id: Id, product_id: Id, sales_channel_id: Id }), [Schema.Record(Schema.String, Schema.Json)]),
  Schema.StructWithRest(Schema.Struct({ id: Id, product_id: Id, shipping_profile_id: Id }), [Schema.Record(Schema.String, Schema.Json)]),
])).check(Schema.isMaxLength(256)), "storedCorruption");
const Config = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ product_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
const decodeSalesRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  product_id: Schema.optionalKey(IdFilter), sales_channel_id: Schema.optionalKey(IdFilter), id: Schema.optionalKey(IdFilter),
})), config: Schema.optionalKey(Config) }), "invalidInput");
const decodeShippingRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  product_id: Schema.optionalKey(IdFilter), shipping_profile_id: Schema.optionalKey(IdFilter), id: Schema.optionalKey(IdFilter),
})), config: Schema.optionalKey(Config) }), "invalidInput");

/** One native Link router and borrowed owner for the two named Product links.
 * Native routing owns associations; callers never register tables or services. */
export const prepareLocalProductLinks = Effect.fn("ProductLinks.prepare")(function* () {
  const sales = yield* prepareLinkService(yield* captureProductSalesChannelLinkMetadata());
  const shipping = yield* prepareLinkService(yield* captureProductShippingProfileLinkMetadata());
  const compose = (ctx: CommerceCommandContext, owner: Parameters<typeof sales.bind>[1]) => {
    const salesBinding = sales.bind(ctx, owner), shippingBinding = shipping.bind(ctx, owner);
    const router = new Link([salesBinding.loaded, shippingBinding.loaded]);
    const checked = (input: unknown) => owner.run(salesBinding.bound.bridge.checked(ctx,
      Effect.fromResult(captureCommerceInput(input, ctx.resources)).pipe(Effect.flatMap(value => Effect.fromResult(decodeLinks(value))),
        Effect.map(value => structuredClone(value)))));
    return { context: { manager: ctx.manager, transactionManager: ctx.manager },
      link: { create: async (input: unknown) => router.create(await checked(input), { manager: ctx.manager, transactionManager: ctx.manager }),
        dismiss: async (input: unknown) => router.dismiss(await checked(input), { manager: ctx.manager, transactionManager: ctx.manager }) },
      sales: { listAndCount: salesBinding.service.listAndCount.bind(salesBinding.service) },
      shipping: { listAndCount: shippingBinding.service.listAndCount.bind(shippingBinding.service) },
    };
  };
  const use = (ctx: CommerceCommandContext, work: (service: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner), work);
  const commands = commerceServiceCommands(use);
  const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
    Effect.fn("ProductLinks.prepareCommand")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(
      Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
  const create = commands.write("linkCreate", prepare(decodeLinks), ({ link }, input) => link.create(input));
  const dismiss = commands.write("linkDismiss", prepare(decodeLinks), ({ link }, input) => link.dismiss(input));
  const countSales = commands.read("productSalesChannelLinkCount", prepare(decodeSalesRead), ({ sales, context }, args) =>
    sales.listAndCount(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const countShipping = commands.read("productShippingProfileLinkCount", prepare(decodeShippingRead), ({ shipping, context }, args) =>
    shipping.listAndCount(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const graph: GraphModuleDefinition = {
    aliases: [...yield* Effect.fromResult(moduleAliases(sales.joiner)), ...yield* Effect.fromResult(moduleAliases(shipping.joiner))],
    reads: [
      { model: sales.entityName, command: countSales, table: sales.prepared.table, paths: [], orderable: ["product_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount },
      { model: shipping.entityName, command: countShipping, table: shipping.prepared.table, paths: [], orderable: ["product_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount },
    ],
  };
  const eventPolicy = (descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]) => selectedLinkEventPolicy([
    { tableName: "product_sales_channel", serviceName: sales.serviceName, entityName: sales.entityName },
    { tableName: "product_shipping_profile", serviceName: shipping.serviceName, entityName: shipping.entityName },
  ], descriptor, deliver);
  const method = yield* Effect.fromResult(defineWorkflowMethod({ command: create, arguments: decodeArguments, encode: ([links]) => links,
    output: decodeCreated, moduleEvents: [sales.entityName + ".attached", shipping.entityName + ".attached"] }));
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "link", source: { name: "flarex-product-links", profile: "medusa.product.links" },
    methods: { create: method }, graph }));
  return { create, dismiss, countSales, countShipping, commands: [create, dismiss, countSales, countShipping],
    workflow, graph, eventPolicy, withService: use, prepareProfile: prepareProductLinkProfile };
});

const prepareProductLinkProfile = Effect.fn("ProductLinks.prepareProfile")(function* (
  ...args: Parameters<typeof prepareProductShippingProfileSchema>
) {
  const prepared = yield* prepareProductShippingProfileSchema(...args);
  const grants = [];
  for (const tableId of ["product_sales_channel", "product_shipping_profile"]) {
    const key = prepared.layout.frame.tables.find(table => table.identity.tableId === tableId)?.keys.find(key => key.kind === "primary");
    if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    grants.push({ tableId, keyId: key.identity.keyId, update: "existingPrimaryKey" as const, remove: "declaredKey" as const,
      lifecycle: "managedSoftDelete" as const, upsert: "activeRow" as const, observeRows: true as const });
  }
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.product.links", grants);
  return { ...prepared, profile, initialization: { rows: undefined } };
});
