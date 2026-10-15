import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import type { FindConfig } from "@medusajs/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantInventoryLinkMetadata } from "../composition/product-variant-inventory-schema";
import { captureVariantPricingLinkMetadata } from "../composition/product-variant-pricing-schema";
import { prepareLinkService } from "./service";
import { selectedLinkLogicalEventPolicy } from "./events";
import { withCommerceService } from "../module/service-bridge";
import { commerceServiceCommands } from "../module/commands";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { moduleAliases } from "../local-graph/module";
import { decodeGraphCount } from "../local-graph/query";
import type { GraphModuleDefinition } from "../local-graph/model";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "../workflow/module";
import { prepareLinkWorkflowService } from "./workflow-service";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(8)).pipe(Schema.mutable)]);
const IdFilter = Schema.Union([Ids, Schema.Struct({ $ne: Id })]);
const Data = Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id) }));
const InventoryPair = Schema.Struct({ product: Schema.Struct({ variant_id: Id }), inventory: Schema.Struct({ inventory_item_id: Id }), data: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id), required_quantity: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 }))) })) });
const PricingPair = Schema.Struct({ product: Schema.Struct({ variant_id: Id }), pricing: Schema.Struct({ price_set_id: Id }), data: Data });
// Each array is homogeneous before the native router can fan out with promiseAll.
export const VariantInventoryLinkBatch = Schema.Array(InventoryPair).check(Schema.isMaxLength(8)).pipe(Schema.mutable);
export const VariantPricingLinkBatch = Schema.Array(PricingPair).check(Schema.isMaxLength(8)).pipe(Schema.mutable);
const Batch = Schema.Union([VariantInventoryLinkBatch, VariantPricingLinkBatch]);
export const VariantLinkBatch = Batch;
const decodeLinks = commerceDecoder(Schema.Union([InventoryPair, PricingPair, Batch]), "invalidInput");
const decodeArguments = commerceDecoder(Schema.Tuple([Batch]), "invalidInput");
const decodeCreated = commerceDecoder(Schema.Array(Schema.Union([
  Schema.StructWithRest(Schema.Struct({ id: Id, variant_id: Id, inventory_item_id: Id }), [Schema.Record(Schema.String, Schema.Json)]),
  Schema.StructWithRest(Schema.Struct({ id: Id, variant_id: Id, price_set_id: Id }), [Schema.Record(Schema.String, Schema.Json)]),
])).check(Schema.isMaxLength(8)), "storedCorruption");
const Config = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ variant_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
const decodeInventoryRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  variant_id: Schema.optionalKey(IdFilter), inventory_item_id: Schema.optionalKey(IdFilter), id: Schema.optionalKey(IdFilter),
})), config: Schema.optionalKey(Config) }), "invalidInput");
const decodePricingRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  variant_id: Schema.optionalKey(IdFilter), price_set_id: Schema.optionalKey(IdFilter), id: Schema.optionalKey(IdFilter),
})), config: Schema.optionalKey(Config) }), "invalidInput");
/** One native Link router and borrowed owner for the two named Product links.
 * Native routing owns associations; callers never register tables or services. */
export const prepareLocalVariantLinks = Effect.fn("VariantLinks.prepare")(function* (admission: "create" | "variant-updates" | "product-updates" = "create") {
  if (admission !== "create" && admission !== "variant-updates" && admission !== "product-updates") return yield* Effect.fail(commerceError("unsupportedProfile"));
  const inventory = yield* prepareLinkService(yield* captureVariantInventoryLinkMetadata());
  const pricing = yield* prepareLinkService(yield* captureVariantPricingLinkMetadata());
  const inventoryNative = yield* Effect.fromResult(prepareLinkWorkflowService(inventory, "inventoryLink",
    admission === "product-updates" ? "cascade" : admission === "variant-updates" ? "dismiss" : "create"));
  const pricingNative = yield* Effect.fromResult(prepareLinkWorkflowService(pricing, "pricingLink", admission === "product-updates" ? "cascade" : "create"));
  const compose = (ctx: CommerceCommandContext, owner: Parameters<typeof inventory.bind>[1]) => {
    const inventoryBinding = inventory.bind(ctx, owner), pricingBinding = pricing.bind(ctx, owner);
    const router = new Link([inventoryBinding.loaded, pricingBinding.loaded]);
    const checked = (input: unknown) => owner.run(inventoryBinding.bound.bridge.checked(ctx,
      Effect.fromResult(captureCommerceInput(input, ctx.resources)).pipe(Effect.flatMap(value => Effect.fromResult(decodeLinks(value))),
        Effect.map(value => structuredClone(value)))));
    return { context: { manager: ctx.manager, transactionManager: ctx.manager },
      link: { create: async (input: unknown) => router.create(await checked(input), { manager: ctx.manager, transactionManager: ctx.manager }) },
      inventory: { listAndCount: inventoryBinding.service.listAndCount.bind(inventoryBinding.service) },
      pricing: { listAndCount: pricingBinding.service.listAndCount.bind(pricingBinding.service) },
    };
  };
  const use = (ctx: CommerceCommandContext, work: (service: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner), work);
  const commands = commerceServiceCommands(use);
  const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
    Effect.fn("VariantLinks.prepareCommand")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(
      Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
  const create = commands.write("linkCreate", prepare(decodeLinks), ({ link }, input) => link.create(input));
  const countInventory = commands.read("variantInventoryLinkCount", prepare(decodeInventoryRead), ({ inventory, context }, args) =>
    inventory.listAndCount(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const countPricing = commands.read("variantPricingLinkCount", prepare(decodePricingRead), ({ pricing, context }, args) =>
    pricing.listAndCount(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const graph: GraphModuleDefinition = {
    aliases: [...yield* Effect.fromResult(moduleAliases(inventory.joiner)), ...yield* Effect.fromResult(moduleAliases(pricing.joiner))],
    reads: [
      { model: inventory.entityName, command: countInventory, table: inventory.prepared.table, paths: [], orderable: ["variant_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount },
      { model: pricing.entityName, command: countPricing, table: pricing.prepared.table, paths: [], orderable: ["variant_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount },
    ],
  };
  const logicalEventPolicy = () => selectedLinkLogicalEventPolicy([
    { tableName: "product_variant_inventory_item", serviceName: inventory.serviceName, entityName: inventory.entityName,
      endpoints: ["variant_id", "inventory_item_id"], createCommands: [inventoryNative.createName],
      dismissCommands: inventoryNative.dismissName === undefined ? [] : [inventoryNative.dismissName],
      deleteCommands: inventoryNative.softDeleteName === undefined ? [] : [inventoryNative.softDeleteName] },
    { tableName: "product_variant_price_set", serviceName: pricing.serviceName, entityName: pricing.entityName,
      endpoints: ["variant_id", "price_set_id"], createCommands: [pricingNative.createName],
      deleteCommands: pricingNative.softDeleteName === undefined ? [] : [pricingNative.softDeleteName] },
  ]);
  const method = yield* Effect.fromResult(defineWorkflowMethod({ command: create, arguments: decodeArguments, encode: ([links]) => links,
    output: decodeCreated, moduleEvents: [inventory.entityName + ".attached", pricing.entityName + ".attached"] }));
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "link", source: { name: "flarex-variant-links", profile: "medusa.variant.links" },
    methods: { create: method, inventoryNativeCreate: inventoryNative.createMethod, inventoryNativeList: inventoryNative.listMethod,
      pricingNativeCreate: pricingNative.createMethod, pricingNativeList: pricingNative.listMethod,
      ...(inventoryNative.dismissMethod === undefined ? {} : { inventoryNativeDismiss: inventoryNative.dismissMethod }),
      ...(inventoryNative.softDeleteMethod === undefined ? {} : { inventoryNativeSoftDelete: inventoryNative.softDeleteMethod }),
      ...(pricingNative.softDeleteMethod === undefined ? {} : { pricingNativeSoftDelete: pricingNative.softDeleteMethod }) }, graph,
    logical: { ...logicalEventPolicy(), commands: [create, countInventory, countPricing, inventoryNative.create, inventoryNative.list, pricingNative.create, pricingNative.list,
      ...(inventoryNative.dismiss === undefined ? [] : [inventoryNative.dismiss]),
      ...(inventoryNative.softDelete === undefined ? [] : [inventoryNative.softDelete]),
      ...(pricingNative.softDelete === undefined ? [] : [pricingNative.softDelete])] } }));
  return { create, countInventory, countPricing,
    commands: [create, countInventory, countPricing, inventoryNative.create, inventoryNative.list, pricingNative.create, pricingNative.list,
      ...(inventoryNative.dismiss === undefined ? [] : [inventoryNative.dismiss]),
      ...(inventoryNative.softDelete === undefined ? [] : [inventoryNative.softDelete]),
      ...(pricingNative.softDelete === undefined ? [] : [pricingNative.softDelete])],
    nativeServices: { inventory: inventoryNative, pricing: pricingNative },
    workflow, graph, logicalEventPolicy, withService: use };
});
