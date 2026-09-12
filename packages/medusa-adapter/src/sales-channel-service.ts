import { Effect, Result, Schema } from "effect";
import { SalesChannel } from "@medusajs/sales-channel/models";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { salesChannelStaticResources } from "@medusajs/sales-channel/static-manifest";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import type { IEventBusModuleService, FindConfig, SalesChannelDTO, CreateSalesChannelDTO, UpdateSalesChannelDTO, FilterableSalesChannelProps } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "./module-definition";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { prepareSalesChannelRepository } from "./sales-channel-repository";
import { salesChannelEventPolicy } from "./sales-channel-events";
import { captureSalesChannelMetadata } from "./sales-channel-schema";
import { QueryLimit, QueryOffset } from "./query-decoder";

const decodeEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
const decodeEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const SimpleSalesChannelInput = Schema.Struct({ id: Schema.optionalKey(Id), name: Schema.String });
const decodeCreateArguments = commerceDecoder(Schema.Tuple([
  Schema.Array(SimpleSalesChannelInput).check(Schema.isMaxLength(256)),
]), "invalidInput");
const decodeCreatedChannels = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Id, name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256)), "storedCorruption");
const Create = Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeCreate = commerceDecoder(Schema.Union([Create, Schema.Array(Create).check(Schema.isMaxLength(256))]), "invalidInput");
// Native update normalization spreads data after the selected ID. Admit the
// actual update DTO before that transformation, so data cannot replace identity
// or smuggle framework-managed lifecycle fields past the DAL.
const decodeUpdate = commerceDecoder(Schema.Struct({ id: Id, data: Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_disabled: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
}) }), "invalidInput");
const decodeDelete = commerceDecoder(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256))]), "invalidInput");
const Filters = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256))])),
  name: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
  is_disabled: Schema.optionalKey(Schema.Boolean),
});
const Config = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
const decodeRead = commerceDecoder(Schema.Struct({
  filters: Schema.optionalKey(Filters), config: Schema.optionalKey(Config),
}), "invalidInput");
const decodeRetrieve = commerceDecoder(Schema.Struct({ id: Id, config: Schema.optionalKey(Config) }), "invalidInput");

/** One definition per prepared model snapshot; each invocation borrows a fresh
 * command-owned service. There is no global container or second runtime owner.
 * The host supplies settlement, profile admission and the event destination. */
export const makeLocalSalesChannelCommands = Effect.fn("SalesChannelAdapter.commands")(function* () {
  const metadata = yield* captureSalesChannelMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { bind, table } = yield* prepareSalesChannelRepository(metadata.frame);
    const module = yield* defineCommerceModule({
      name: "flarex-sales-channel-local", models: [SalesChannel],
      profile: { name: "sales-channel", capabilities: [], bind: (ctx, owner) => {
        const bound = bind(ctx, owner);
        const eventBus: IEventBusModuleService = {
          emit: (input, options) => owner.run(Effect.gen(function* () {
            yield* Effect.fromResult(decodeEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
            const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
            for (const message of yield* Effect.fromResult(decodeEventBatch(captured))) yield* bound.bridge.current().captureLocalEvent(message);
          }).pipe(Effect.catchTag("CommerceTransactionError", error => bound.bridge.current().refuse(error)))),
          subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
          releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse,
        };
        return { baseRepository: bound.repository, repository: () => bound.repository, events: bound.mutationEvents, eventBus };
      } },
      extensions: {},
      service: ({ binding, dependencies, context }) => {
        // The native constructor forwards the full container to MedusaService,
        // although its declared local dependencies omit the inherited event bus.
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        return { service: new SalesChannelModuleService(container, { scope: "internal" }), context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
      Effect.fn("SalesChannelCommand.prepare")((ctx: CommerceCommandContext, input: Json) =>
        Effect.fromResult(decode(input)).pipe(Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
    // SAFETY: framework DTOs/configuration are compile-time interfaces; the
    // selected DAL validates native-normalized inputs before any storage call.
    const create = commands.write("salesChannelCreate", prepare(decodeCreate), ({ service, context }, data) =>
      Array.isArray(data) ? service.createSalesChannels(data as CreateSalesChannelDTO[], context) : service.createSalesChannels(data as CreateSalesChannelDTO, context));
    const update = commands.write("salesChannelUpdate", prepare(decodeUpdate), ({ service, context }, args) => service.updateSalesChannels(args.id, args.data as UpdateSalesChannelDTO, context));
    const remove = commands.write("salesChannelDelete", prepare(decodeDelete), async ({ service, context }, ids) => {
      await service.deleteSalesChannels(ids, context);
      return null;
    });
    const list = commands.read("salesChannelList", prepare(decodeRead), ({ service, context }, args) => service.listSalesChannels(args.filters as FilterableSalesChannelProps | undefined, args.config as FindConfig<SalesChannelDTO> | undefined, context));
    const count = commands.read("salesChannelCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCountSalesChannels(args.filters as FilterableSalesChannelProps | undefined, args.config as FindConfig<SalesChannelDTO> | undefined, context));
    const retrieve = commands.read("salesChannelRetrieve", prepare(decodeRetrieve), ({ service, context }, args) => service.retrieveSalesChannel(args.id, args.config as FindConfig<SalesChannelDTO> | undefined, context));
    const joiner = salesChannelStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases(joiner), reads: [{
      model: "SalesChannel", command: count, table, paths: [], orderable: table.primaryKeys,
      uniqueOrder: table.primaryKeys, multipleOrder: false, decode: decodeGraphCount,
    }] };
    const createSalesChannels = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
      encode: ([channels]) => channels, output: decodeCreatedChannels,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: "created" })] });
    const workflow = yield* defineWorkflowModule({ name: Modules.SALES_CHANNEL, source: module.description, methods: { createSalesChannels }, graph });
    return { create, update, delete: remove, list, count, retrieve, graph, workflow,
      commands: [create, update, remove, list, count, retrieve],
      withService: module.use,
      eventPolicy: salesChannelEventPolicy,
    };
  }));
});
