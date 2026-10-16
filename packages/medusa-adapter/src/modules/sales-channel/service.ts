import { commerceModuleEventBus } from "../../module/events";
import { Effect, Result, Schema } from "effect";
import { SalesChannel } from "@medusajs/sales-channel/models";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { salesChannelStaticResources } from "@medusajs/sales-channel/static-manifest";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";

import type { FindConfig, SalesChannelDTO, CreateSalesChannelDTO, UpdateSalesChannelDTO, FilterableSalesChannelProps } from "@medusajs/framework/types";

import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";

import { prepareSalesChannelRepository } from "./repository";
import { salesChannelLogicalEventPolicy } from "./events";
import { captureSalesChannelMetadata } from "./schema";
import { compileSalesChannelCreateContracts } from "./create-input";
import { QueryLimit, QueryOffset } from "../../query/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const SimpleSalesChannelInput = Schema.Struct({ id: Schema.optionalKey(Id), name: Schema.String });
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
  id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)), Schema.Struct({ $ne: Id })])),
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
 * The host supplies settlement, source admission and the event destination. */
export const makeLocalSalesChannelCommands = Effect.fn("SalesChannelAdapter.commands")(function* () {
  const metadata = yield* captureSalesChannelMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { bind, table } = yield* prepareSalesChannelRepository(metadata.frame);
    const sourceTable = metadata.frame.tables[0];
    if (sourceTable === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const createContracts = yield* compileSalesChannelCreateContracts(sourceTable);
    const module = yield* defineCommerceModule({
      name: "flarex-sales-channel-local", models: [SalesChannel],
      profile: { name: "sales-channel", capabilities: [], bind: (ctx, owner) => {
        const bound = bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => work.pipe(Effect.catchTag("CommerceTransactionError", error => bound.bridge.current().refuse(error))), refuse: bound.refuse,
        });
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
    const prepare = commerceCommandPreparation("SalesChannelCommand.prepare");
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
    const graph = yield* scalarGraphDefinition(yield* moduleAliases(joiner), "SalesChannel", count, table);
    const createSalesChannels = yield* defineWorkflowMethod({ command: create, arguments: createContracts.decodeArguments,
      encode: ([channels]) => channels, output: createContracts.decodeRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: "created" })] });
    const workflow = yield* defineWorkflowModule({ name: Modules.SALES_CHANNEL, source: module.description, methods: { createSalesChannels }, graph, logical: { ...salesChannelLogicalEventPolicy(), commands: [create, update, remove, list, count, retrieve] } });
    return { create, update, delete: remove, list, count, retrieve, graph, workflow,
      commands: [create, update, remove, list, count, retrieve],
      withService: module.use,
      logicalEventPolicy: salesChannelLogicalEventPolicy,
    };
  }));
});
