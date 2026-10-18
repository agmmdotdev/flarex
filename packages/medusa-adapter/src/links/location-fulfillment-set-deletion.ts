import { Effect, Result } from "effect";
import { LocationFulfillmentSet, getModuleService } from "@medusajs/link-modules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { defineWorkflowModule } from "../workflow/module";
import { captureLocationFulfillmentSetLinkMetadata } from "./location-fulfillment-set-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { captureCommerceInput } from "../value/input";
import { compileLinkLifecycleReceipt } from "./lifecycle-receipt";
import { linkLogicalEventPolicy } from "./events";

const nativeJoiner = getModuleService(LocationFulfillmentSet).prototype.__joinerConfig();
export function captureLocationFulfillmentSetDeletionService(service: unknown,
  admission: "stock-location-deletions" | "fulfillment-set-deletions") {
  return Result.gen(function* () {
    const definition = linkWorkflowServiceDefinition(service);
    if (definition === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (definition.admission !== admission || definition.lifecycle.maximumRows !== 8 || definition.lifecycle.completeHistory !== true ||
      definition.routing.__joinerConfig.serviceName !== LocationFulfillmentSet.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const actual = yield* captureCommerceInput(definition.routing.__joinerConfig), expected = yield* captureCommerceInput(nativeJoiner);
    if (!jsonEqual(actual, expected)) return yield* Result.fail(commerceError("unsupportedProfile"));
    return definition;
  });
}

/** Both installed endpoint roots share the same native stored family and
 * complete-history proof. Endpoint identities retain their native duplicates. */
export const prepareLocationFulfillmentSetDeletionLinks = Effect.fn("LocationFulfillmentSetDeletionLinks.prepare")(function* (
  admission: "stock-location-deletions" | "fulfillment-set-deletions", prefix: string,
) {
  const metadata = yield* captureLocationFulfillmentSetLinkMetadata();
  const prepared = yield* prepareLinkService(metadata, 8, true);
  const nativeService = yield* Effect.fromResult(prepareLinkWorkflowService(prepared, prefix, admission));
  const softDelete = nativeService.softDelete, restore = nativeService.restore;
  const softDeleteName = nativeService.softDeleteName, restoreName = nativeService.restoreName;
  const softDeleteMethod = nativeService.softDeleteMethod, restoreMethod = nativeService.restoreMethod;
  const returnLinkableKeys = prepared.routing.__joinerConfig.primaryKeys;
  if (softDelete === undefined || restore === undefined || softDeleteName === undefined || restoreName === undefined ||
    softDeleteMethod === undefined || restoreMethod === undefined || returnLinkableKeys === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const validateLifecycle = yield* Effect.fromResult(compileLinkLifecycleReceipt({ table: metadata.frame,
    endpoints: ["stock_location_id", "fulfillment_set_id"], returnLinkableKeys, maximumEndpoints: 8, maximumRows: 8,
    distinctEndpoint: { name: "fulfillment_set_id", maximum: 4 },
    softDeleteCommand: softDeleteName, restoreCommand: restoreName, selectionPlan: prepared.prepared.lifecycleReadPlan }));
  const base = linkLogicalEventPolicy(prepared.prepared.table.name, prepared.serviceName, prepared.entityName,
    ["stock_location_id", "fulfillment_set_id"], [nativeService.createName], [], [softDeleteName], [restoreName]);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("LocationFulfillmentSetDeletionLinks.validateCall")(function* (call, activity) {
    if (call.commandName === softDeleteName || call.commandName === restoreName) yield* validateLifecycle(call, activity);
    yield* base.validateLogicalCall(call, activity);
  });
  const logicalEventPolicy = () => ({ capture: base.capture, validateLogicalCall });
  const commands = [nativeService.create, nativeService.list, softDelete, restore];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "location_fulfillment_set_deletion_links",
    source: { name: prepared.serviceName, profile: admission }, graph: { aliases: [], reads: [] },
    methods: { create: nativeService.createMethod, list: nativeService.listMethod, softDelete: softDeleteMethod, restore: restoreMethod },
    logical: { ...logicalEventPolicy(), commands } }));
  return { workflow, commands, logicalEventPolicy, nativeService };
});
