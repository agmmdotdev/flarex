import { Effect, Result, Schema } from "effect";
import type { FindConfig } from "@medusajs/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-schema";
import { prepareLinkService, type BoundLink } from "./service";
import { linkLogicalEventPolicy } from "./events";
import { commerceServiceCommands } from "../module/commands";
import { commerceDecoder } from "../value/decoder";
import { moduleAliases } from "../local-graph/module";
import { decodeGraphCount } from "../local-graph/query";
import type { GraphModuleDefinition } from "../local-graph/model";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "../workflow/module";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Union([Id, Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(256))]);
const IdFilter = Schema.Union([Ids, Schema.Struct({ $ne: Id })]);
const LinkInput = Schema.Struct({
  product: Schema.Struct({ product_id: Id }), sales_channel: Schema.Struct({ sales_channel_id: Id }),
  data: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id) })),
});
const decodeLinks = commerceDecoder(Schema.Union([LinkInput, Schema.Array(LinkInput).pipe(Schema.mutable).check(Schema.isMaxLength(256))]), "invalidInput");
const decodeCreateArguments = commerceDecoder(Schema.Tuple([
  Schema.Array(LinkInput).check(Schema.isMaxLength(256)),
]), "invalidInput");
const decodeCreatedLinks = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Id, product_id: Id, sales_channel_id: Id }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256)), "storedCorruption");
const decodeEndpoint = commerceDecoder(Schema.Union([
  Schema.Struct({ product: Schema.Struct({ product_id: Ids }) }),
  Schema.Struct({ sales_channel: Schema.Struct({ sales_channel_id: Ids }) }),
]), "unsupportedProfile");
const decodeRead = commerceDecoder(Schema.Struct({
  filters: Schema.optionalKey(Schema.Struct({ product_id: Schema.optionalKey(IdFilter), sales_channel_id: Schema.optionalKey(IdFilter), id: Schema.optionalKey(IdFilter) })),
  config: Schema.optionalKey(Schema.Struct({
    select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
    relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
    order: Schema.optionalKey(Schema.Struct({ product_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
    withDeleted: Schema.optionalKey(Schema.Boolean),
  })),
}), "invalidInput");
/** Named construction selects the supported native definition and commands. */
export const prepareProductSalesChannelLink = Effect.fn("ProductSalesChannelLink.prepare")(function* () {
  const metadata = yield* captureProductSalesChannelLinkMetadata();
  const { use: useNative, prepared, joiner, serviceName, entityName } = yield* prepareLinkService(metadata);
  // This named module facade exposes borrowed reads; write access stays with
  // explicit internal construction, not a workflow resource.
  const use = (ctx: CommerceCommandContext, work: (bound: Omit<BoundLink, "service"> & {
    readonly service: Pick<BoundLink["service"], "list" | "listAndCount">;
  }) => Promise<unknown>) => useNative(ctx, bound => work({ ...bound,
    service: Object.freeze({ list: bound.service.list, listAndCount: bound.service.listAndCount }) }));
  const commands = commerceServiceCommands(use);
  const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
    Effect.fn("LinkCommand.prepare")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(
      Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
  const create = commands.write("linkCreate", prepare(decodeLinks), ({ link, context }, data) => link.create(data, context));
  const dismiss = commands.write("linkDismiss", prepare(decodeLinks), ({ link, context }, data) => link.dismiss(data, context));
  const remove = commands.write("linkDelete", prepare(decodeEndpoint), async ({ link, context, cascade }, data) => cascade(await link.delete(data, context)));
  const restore = commands.write("linkRestore", prepare(decodeEndpoint), async ({ link, context, cascade }, data) => cascade(await link.restore(data, context)));
  const list = commands.read("linkList", prepare(decodeRead), ({ service, context }, args) => service.list(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const count = commands.read("linkCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCount(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const links = commands.read("linkListDefinitions", prepare(decodeLinks), ({ link, context }, data) => link.list(data, { asLinkDefinition: true }, context));
  const graph: GraphModuleDefinition = { aliases: yield* Effect.fromResult(moduleAliases(joiner)), reads: [{
    model: entityName, command: count, table: prepared.table, paths: [], orderable: ["product_id"],
    uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount,
  }] };
  const logicalEventPolicy = () => linkLogicalEventPolicy("product_sales_channel", serviceName, entityName,
    ["product_id", "sales_channel_id"]);
  const workflowCreate = yield* Effect.fromResult(defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
    encode: ([links]) => links, output: decodeCreatedLinks, moduleEvents: [entityName + ".attached"] }));
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "link", source: { name: serviceName, profile: "medusa.product-sales-channel.link" },
    methods: { create: workflowCreate }, graph, logical: { ...logicalEventPolicy(), commands: [create, dismiss, remove, restore, list, count, links] } }));
  return { create, dismiss, delete: remove, restore, list, count, links, graph, workflow, withService: use, logicalEventPolicy,
    commands: [create, dismiss, remove, restore, list, count, links] };
});
