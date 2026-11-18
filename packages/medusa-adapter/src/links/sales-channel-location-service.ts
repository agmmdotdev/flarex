import { Effect, Schema } from "effect";
import type { FindConfig } from "@medusajs/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureSalesChannelLocationLinkMetadata } from "./sales-channel-location-schema";
import { prepareLinkService } from "./service";
import { linkLogicalEventPolicy } from "./events";
import { commerceServiceCommands, commerceCommandPreparation } from "../module/commands";
import { commerceDecoder } from "../value/decoder";
import { ScalarId } from "../repository/scalar-id-read";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { moduleAliases } from "../local-graph/module";
import { decodeGraphCount } from "../local-graph/query";
import type { GraphModuleDefinition } from "../local-graph/model";
import { defineWorkflowMethod, defineWorkflowModule } from "../workflow/module";

const Pair = Schema.Struct({ sales_channel: Schema.Struct({ sales_channel_id: ScalarId }),
  stock_location: Schema.Struct({ stock_location_id: ScalarId }) });
const Pairs = Schema.Array(Pair).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodePairs = commerceDecoder(Pairs, "invalidInput");
const decodeArguments = commerceDecoder(Schema.Tuple([Pairs]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: ScalarId, sales_channel_id: ScalarId, stock_location_id: ScalarId,
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption");
const Filter = Schema.Union([ScalarId, Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(8))]);
const decodeRead = commerceDecoder(Schema.Struct({
  filters: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Filter), sales_channel_id: Schema.optionalKey(Filter),
    stock_location_id: Schema.optionalKey(Filter) })),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
    relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
    order: Schema.optionalKey(Schema.Struct({ sales_channel_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
    withDeleted: Schema.optionalKey(Schema.Boolean) })),
}), "invalidInput");

/** One authentic native router and borrowed DAL for this named Link family. */
export const prepareSalesChannelLocationLink = Effect.fn("SalesChannelLocationLink.prepare")(function* () {
  const native = yield* prepareLinkService(yield* captureSalesChannelLocationLinkMetadata());
  const { prepared, joiner, serviceName, entityName } = native;
  const commands = commerceServiceCommands(native.use);
  const prepare = commerceCommandPreparation("SalesChannelLocationLink.prepareCommand");
  const create = commands.write("linkCreate", prepare(decodePairs), ({ link, context }, input) => link.create(input, context));
  const dismiss = commands.write("linkDismiss", prepare(decodePairs), ({ link, context }, input) => link.dismiss(input, context));
  // Native dynamic-entity ABI; the shared projection owner checks selected columns.
  const list = commands.read("linkList", prepare(decodeRead), ({ service, context }, input) => service.list(input.filters, input.config as FindConfig<unknown> | undefined, context));
  const count = commands.read("linkCount", prepare(decodeRead), ({ service, context }, input) => service.listAndCount(input.filters, input.config as FindConfig<unknown> | undefined, context));
  const aliases = yield* Effect.fromResult(moduleAliases(joiner));
  const queryModel = aliases[0]?.model;
  if (queryModel === undefined || aliases.some(alias => alias.model !== queryModel))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  // Native query aliases and loader event entities are different for this Link.
  const graph: GraphModuleDefinition = { aliases, reads: [{ model: queryModel, command: count, table: prepared.table,
    paths: [], orderable: ["sales_channel_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }] };
  const logicalEventPolicy = () => linkLogicalEventPolicy(prepared.table.name, serviceName, entityName,
    ["sales_channel_id", "stock_location_id"]);
  const workflowCreate = yield* Effect.fromResult(defineWorkflowMethod({ command: create, arguments: decodeArguments,
    encode: ([pairs]) => pairs, output: decodeRows, moduleEvents: [entityName + ".attached"] }));
  const workflowDismiss = yield* Effect.fromResult(defineWorkflowMethod({ command: dismiss, arguments: decodeArguments,
    encode: ([pairs]) => pairs, output: decodeRows, moduleEvents: [entityName + ".detached"] }));
  const admitted = [create, dismiss, list, count];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "link",
    source: { name: serviceName, profile: "medusa.sales-channel-location.link" },
    methods: { create: workflowCreate, dismiss: workflowDismiss }, graph,
    logical: { ...logicalEventPolicy(), commands: admitted } }));
  return { create, dismiss, list, count, graph, workflow, commands: admitted, logicalEventPolicy };
});
