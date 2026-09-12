import { Effect, Result, Schema } from "effect";
import { ProductSalesChannel, LinkService, getModuleService } from "@medusajs/link-modules";
import { Link, type DeleteEntityInput } from "@medusajs/modules-sdk/link";
import { Modules } from "@medusajs/framework/utils/portable";
import type { Context, FindConfig, IEventBusModuleService, ILinkModule, LoadedModule } from "@medusajs/types";
import { registerLocalCommerceProfile, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-link-schema";
import { prepareProductSalesChannelLinkRepository } from "./product-sales-channel-link-repository";
import { productSalesChannelLinkEventPolicy } from "./product-sales-channel-link-events";
import { prepareProductSalesChannelLinkSchema } from "./sales-channel-schema";
import { withCommerceService } from "./commerce-service-bridge";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import { QueryLimit, QueryOffset } from "./query-decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)).pipe(Schema.mutable)]);
const LinkInput = Schema.Struct({
  product: Schema.Struct({ product_id: Id }), sales_channel: Schema.Struct({ sales_channel_id: Id }),
  data: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id) })),
});
const decodeLinks = commerceDecoder(Schema.Union([LinkInput, Schema.Array(LinkInput).check(Schema.isMaxLength(256)).pipe(Schema.mutable)]), "invalidInput");
const decodeEndpoint = commerceDecoder(Schema.Union([
  Schema.Struct({ product: Schema.Struct({ product_id: Ids }) }),
  Schema.Struct({ sales_channel: Schema.Struct({ sales_channel_id: Ids }) }),
]), "unsupportedProfile");
const decodeRead = commerceDecoder(Schema.Struct({
  filters: Schema.optionalKey(Schema.Struct({ product_id: Schema.optionalKey(Ids), sales_channel_id: Schema.optionalKey(Ids), id: Schema.optionalKey(Ids) })),
  config: Schema.optionalKey(Schema.Struct({
    select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
    relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
    order: Schema.optionalKey(Schema.Struct({ product_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
    withDeleted: Schema.optionalKey(Schema.Boolean),
  })),
}), "invalidInput");
const decodeEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
const decodeEvents = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");
const decodeCascade = commerceDecoder(Schema.Tuple([Schema.Null,
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id)))]), "adapterFailure");
interface BoundLink { readonly link: Readonly<Pick<Link, "create" | "dismiss" | "delete" | "restore" | "list">>;
  readonly service: Readonly<Pick<ILinkModule, "list" | "listAndCount">>; readonly context: Context;
  readonly cascade: (result: unknown) => Promise<Json> }

/** One prepared Link owns its repository, native services/router, read tokens
 * and event policy. Host assembly still explicitly selects all participants. */
export const prepareLocalProductSalesChannelLink = Effect.fn("LinkAdapter.prepare")(function* () {
  const metadata = yield* captureProductSalesChannelLinkMetadata();
  const prepared = yield* Effect.fromResult(prepareProductSalesChannelLinkRepository(metadata.frame));
  const joiner = structuredClone(ProductSalesChannel);
  const serviceName = joiner.serviceName;
  const entityName = "LinkProductSalesChannel";
  if (serviceName === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const Service = getModuleService(joiner);
  const use = (ctx: CommerceCommandContext, work: (service: BoundLink) => Promise<unknown>) => withCommerceService(ctx, owner => {
    const bound = prepared.bind(ctx, owner);
    const eventBus: IEventBusModuleService = {
      emit: (input, options) => owner.run(bound.bridge.checked(bound.bridge.current(), Effect.gen(function* () {
        yield* Effect.fromResult(decodeEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
        const events = yield* Effect.fromResult(decodeEvents(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        for (const event of events) yield* bound.bridge.current().captureLocalEvent(event);
      }))),
      subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
      releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse,
    };
    const service = new Service({
      baseRepository: bound.repository, linkService: new LinkService({ linkRepository: bound.repository }),
      primaryKey: "product_id", foreignKey: "sales_channel_id", extraFields: [], entityName, serviceName,
      [Modules.EVENT_BUS]: eventBus,
    }, { scope: "internal" });
    // The native router consumes loaded config values and actual bound methods.
    // Do not overwrite the service's __joinerConfig method with a data property.
    const loaded = { __joinerConfig: service.__joinerConfig(), __definition: {
      key: serviceName, defaultPackage: "@medusajs/link-modules", label: entityName, isQueryable: true,
      defaultModuleDeclaration: { scope: "internal" as const },
    }, create: service.create.bind(service), dismiss: service.dismiss.bind(service), list: service.list.bind(service),
      softDelete: service.softDelete.bind(service), restore: service.restore.bind(service),
    } satisfies LoadedModule & Pick<ILinkModule, "create" | "dismiss" | "list" | "softDelete" | "restore">;
    const router = new Link([loaded]);
    const endpoint = (input: unknown) => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
      const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
      return structuredClone(yield* Effect.fromResult(decodeEndpoint(captured)));
    })));
    return {
      // Actual bound native methods, without mutable registration or routing
      // metadata capabilities escaping into command code.
      link: Object.freeze({ create: router.create.bind(router), dismiss: router.dismiss.bind(router),
        // Admission precedes native traversal even for a borrowed service call.
        delete: async (input: DeleteEntityInput, context?: Context) => router.delete(await endpoint(input), context),
        restore: async (input: DeleteEntityInput, context?: Context) => router.restore(await endpoint(input), context), list: router.list.bind(router) }),
      service: Object.freeze({ list: service.list.bind(service), listAndCount: service.listAndCount.bind(service) }),
      context: { manager: ctx.manager, transactionManager: ctx.manager },
      cascade: result => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
        const captured = yield* Effect.fromResult(captureCommerceInput(result, ctx.resources));
        // Validate the entire native errors-as-data tuple before projecting it.
        return (yield* Effect.fromResult(decodeCascade(captured)))[1];
      }))),
    };
  }, work);
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
  const eventPolicy = (descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]) =>
    productSalesChannelLinkEventPolicy(serviceName, entityName, descriptor, deliver);
  return { create, dismiss, delete: remove, restore, list, count, links, graph, withService: use, eventPolicy, prepareProfile: prepareLinkProfile,
    commands: [create, dismiss, remove, restore, list, count, links] };
});

const prepareLinkProfile = Effect.fn("LinkAdapter.prepareProfile")(function* (
  ...args: Parameters<typeof prepareProductSalesChannelLinkSchema>
) {
  const prepared = yield* prepareProductSalesChannelLinkSchema(...args);
  const table = prepared.layout.frame.tables.find(table => table.identity.tableId === "product_sales_channel");
  const key = table?.keys.find(key => key.kind === "primary");
  if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.product-sales-channel.link",
    [{ tableId: "product_sales_channel", keyId: key.identity.keyId, update: "existingPrimaryKey",
      remove: "declaredKey", lifecycle: "managedSoftDelete", upsert: "activeRow", observeRows: true }]);
  return { ...prepared, profile, initialization: { rows: undefined } };
});
