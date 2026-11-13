import { Effect, Result, Schema } from "effect";
import { Fulfillment } from "@medusajs/fulfillment/models";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, workflowModuleDefinition } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { prepareIdReadRepository } from "../../repository/id-read";
import { ScalarId } from "../../repository/scalar-id-read";
import type { CommerceRelation } from "../../query/relations";
import { makeReadCatalog } from "../../query/catalog";
import { storeOrderRelatedLimit } from "../order/store-read-input";
import { makeFulfillmentCheckoutReadCommands } from "./checkout-read-service";
import { captureFulfillmentCreationMetadata } from "./shipping-profile-schema";
import { defineFulfillmentPersistenceModule, fulfillmentServiceRouting } from "./fulfillment-module";

const Ids = Schema.Union([ScalarId, Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(storeOrderRelatedLimit))]);
const Read = Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Ids) })),
  config: Schema.optionalKey(Schema.Struct({
    select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(5))),
    take: Schema.optionalKey(Schema.Literals([4, 15, 50, 200, 256])), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })),
  })) });
const decodeRead = commerceDecoder(Read, "invalidInput");

/** Genuine local Fulfillment reads, retaining checkout's existing model reads. */
export const makeFulfillmentStoreOrderReadCommands = Effect.fn("FulfillmentStoreOrderRead.commands")(function* () {
  const base = yield* makeFulfillmentCheckoutReadCommands(), metadata = yield* captureFulfillmentCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const root = metadata.frame.tables.find(table => table.name === "fulfillment");
    if (root === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const names = ["items", "labels", "delivery_address", "provider", "shipping_option"];
    const relations = new Map<string, CommerceRelation>();
    for (const name of names) {
      const declared = root.relationships.find(relation => relation.name === name);
      if (declared === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (declared.type === "hasMany") {
        const relation = describeToManyRelation(root, name, metadata.frame.tables);
        if (relation?.join.type !== "hasMany") return yield* Result.fail(commerceError("unsupportedProfile"));
        relations.set(name, relation);
      } else {
        const columns = declared.foreignKeyNames;
        if ((declared.type !== "hasOneWithFK" && declared.type !== "belongsTo") || columns?.length !== 1 ||
          !root.foreignKeys.some(key => key.referencedTable === declared.targetTable && key.columns.length === 1 &&
            key.columns[0] === columns[0] && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        relations.set(name, { name, targetTable: declared.targetTable, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
          join: { type: "belongsTo", foreignKeys: columns } });
      }
    }
    const tables = [root, ...metadata.frame.tables.filter(table => [...relations.values()].some(relation => relation.targetTable === table.name))];
    const relationMap = new Map([[root.name, relations]]);
    const prepared = yield* prepareIdReadRepository(root, "Fulfillment", tables, relationMap, [], "fulfillmentCountForStoreOrders", {
      hasManyPaths: ["items", "labels"], belongsToPaths: ["delivery_address", "provider", "shipping_option"],
      maximumRows: storeOrderRelatedLimit, allowBareRelations: true, allowWildcard: true, decodeRead,
    });
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-fulfillment-store-order-read", profile: "fulfillment.store-order-read",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, denied: bound.denied,
          repository: model => model === Fulfillment ? bound.repository : bound.denied, events: bound.mutationEvents, eventBus };
      }, service: native => ({ listAndCountFulfillments: native.listAndCountFulfillments.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use);
    const count = commands.read("fulfillmentCountForStoreOrders", commerceCommandPreparation("FulfillmentStoreOrderRead.prepare")(decodeRead),
      ({ service, context }, input) => Reflect.apply(service.listAndCountFulfillments, service, [input.filters ?? {}, input.config ?? {}, context]));
    const baseDefinition = workflowModuleDefinition(base.workflow);
    if (baseDefinition === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const catalog = yield* makeReadCatalog(tables.map(table => ({ name: table.name, columns: table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])) })), relationMap);
    const routing = fulfillmentServiceRouting().__joinerConfig, aliases = yield* moduleAliases(routing);
    const graph = yield* withNativeGraphMetadata({ aliases: [...baseDefinition.graph.aliases, ...aliases.filter(alias => alias.model === "Fulfillment")],
      reads: [...baseDefinition.graph.reads, { model: "Fulfillment", command: count, table: prepared.table,
        paths: yield* relationPaths(catalog, root.name, names, { nativeFields: true }), nativeFields: true,
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, [routing], metadata.frame.tables);
    const policy = { capture: prepared.policy.capture, validateLogicalCall: Effect.fn("FulfillmentStoreOrderRead.validateRead")(function* (
      call: Parameters<typeof prepared.policy.validateLogicalCall>[0], activity: Parameters<typeof prepared.policy.validateLogicalCall>[1],
    ) { return yield* call.commandName === "fulfillmentCountForStoreOrders" ? prepared.policy.validateLogicalCall(call, activity)
      : base.logicalEventPolicy().validateLogicalCall(call, activity); }) };
    const admitted = [...base.commands, count];
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description, methods: {}, graph,
      logical: { ...policy, commands: admitted } });
    return { workflow, count, commands: admitted, prepared, base, logicalEventPolicy: () => policy };
  }));
});
