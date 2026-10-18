import { Effect, Result, Schema } from "effect";
import type { FindConfig, ModuleJoinerConfig } from "@medusajs/types";
import { getModuleService } from "@medusajs/link-modules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { ScalarId as Id } from "../repository/scalar-id-read";
import { commerceServiceCommands, commerceCommandPreparation } from "../module/commands";
import { moduleAliases } from "../local-graph/module";
import { nativeLinkGraphServices } from "../local-graph/links";
import { decodeGraphCount } from "../local-graph/query";
import type { GraphModuleDefinition, GraphRemotePath } from "../local-graph/model";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { defineWorkflowModule } from "../workflow/module";
import { compileLinkLifecycleReceipt } from "./lifecycle-receipt";
import { linkLogicalEventPolicy } from "./events";
import type { captureLinkMetadata } from "./schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";

/** Issued native methods and their complete routing metadata must agree with
 * the named source before a composed router may receive them. */
export function captureShippingOptionLinkService(service: unknown, expected: ModuleJoinerConfig) {
  return Result.gen(function* () {
    const definition = linkWorkflowServiceDefinition(service);
    if (definition === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (definition.admission !== "shipping-option-links" || definition.lifecycle.maximumRows !== 8 || definition.lifecycle.completeHistory !== true)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const actual = yield* captureCommerceInput(definition.routing.__joinerConfig);
    const native = yield* captureCommerceInput(getModuleService(expected).prototype.__joinerConfig());
    if (!jsonEqual(actual, native)) return yield* Result.fail(commerceError("unsupportedProfile"));
    return definition;
  });
}

/** Shared construction for the two selected Shipping Option Link families.
 * Native commands own all reads and transitions; this adds no router or DAL. */
export const prepareShippingOptionLinkService = Effect.fn("ShippingOptionLinks.prepareService")(function* (
  metadata: Effect.Success<ReturnType<typeof captureLinkMetadata>>,
  selection: { readonly name: string; readonly prefix: string; readonly remotePaths?: readonly GraphRemotePath[] },
) {
  const prepared = yield* prepareLinkService(metadata, 8, true);
  const nativeService = yield* Effect.fromResult(prepareLinkWorkflowService(prepared, selection.prefix, "shipping-option-links"));
  const [primary, foreign] = prepared.joiner.relationships ?? [];
  const { softDelete, restore, dismiss, softDeleteName, restoreName, dismissName, softDeleteMethod, restoreMethod, dismissMethod } = nativeService;
  const returnLinkableKeys = prepared.routing.__joinerConfig.primaryKeys;
  if (primary === undefined || foreign === undefined || returnLinkableKeys === undefined || softDelete === undefined || restore === undefined || dismiss === undefined
    || softDeleteName === undefined || restoreName === undefined || dismissName === undefined
    || softDeleteMethod === undefined || restoreMethod === undefined || dismissMethod === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const Filter = Schema.Union([Id, Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(8))]);
  const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Filter), [primary.foreignKey]: Schema.optionalKey(Filter), [foreign.foreignKey]: Schema.optionalKey(Filter),
  })), config: Schema.optionalKey(Schema.Struct({
    select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
    relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
    order: Schema.optionalKey(Schema.Struct({ [primary.foreignKey]: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
    withDeleted: Schema.optionalKey(Schema.Boolean),
  })) }), "invalidInput");
  const count = commerceServiceCommands(prepared.useService).read(selection.prefix + "Count", commerceCommandPreparation("ShippingOptionLinks.prepareRead")(decodeRead),
    ({ service, context }, input) => service.listAndCount(input.filters, input.config as FindConfig<unknown> | undefined, context));
  const aliases = yield* Effect.fromResult(moduleAliases(prepared.joiner));
  const services = yield* Effect.fromResult(nativeLinkGraphServices(prepared.joiner));
  const model = aliases[0]?.model;
  if (model === undefined || aliases.some(alias => alias.model !== model)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const graph: GraphModuleDefinition = { aliases, services, reads: [{ model, command: count, table: prepared.prepared.table,
    paths: [], orderable: [primary.foreignKey], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }],
    ...(selection.remotePaths === undefined ? {} : { remotePaths: selection.remotePaths }),
  };
  const validateLifecycle = yield* Effect.fromResult(compileLinkLifecycleReceipt({ table: metadata.frame,
    endpoints: [primary.foreignKey, foreign.foreignKey], returnLinkableKeys, maximumEndpoints: 8, maximumRows: 8,
    softDeleteCommand: softDeleteName, restoreCommand: restoreName, selectionPlan: prepared.prepared.lifecycleReadPlan }));
  const base = linkLogicalEventPolicy(prepared.prepared.table.name, prepared.serviceName, prepared.entityName,
    [primary.foreignKey, foreign.foreignKey], [nativeService.createName], [dismissName], [softDeleteName], [restoreName]);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionLinks.validateCall")(function* (call, activity) {
    if (call.commandName === softDeleteName || call.commandName === restoreName) yield* validateLifecycle(call, activity);
    yield* base.validateLogicalCall(call, activity);
  });
  const logicalEventPolicy = () => ({ capture: base.capture, validateLogicalCall });
  const commands = [nativeService.create, nativeService.list, dismiss, softDelete, restore, count];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: selection.name,
    source: { name: prepared.serviceName, profile: "shipping-option-links" }, graph,
    methods: { create: nativeService.createMethod, list: nativeService.listMethod, dismiss: dismissMethod, softDelete: softDeleteMethod, restore: restoreMethod },
    logical: { ...logicalEventPolicy(), commands } }));
  return { prepared, nativeService, workflow, graph, count, commands, logicalEventPolicy };
});
