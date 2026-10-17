import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { ProductVariantInventoryItem, getModuleService } from "@medusajs/link-modules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantInventoryLinkMetadata } from "../composition/product-variant-inventory-schema";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { linkLogicalEventPolicy } from "./events";
import { compileLinkLifecycleReceipt } from "./lifecycle-receipt";
import { decodeLinkCascade } from "./cascade-result";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Endpoint = Schema.Struct({ inventory: Schema.Struct({ inventory_item_id: Ids }) });
const decodeEndpoint = commerceDecoder(Schema.Tuple([Endpoint]), "invalidInput");
const nativeJoiner = getModuleService(ProductVariantInventoryItem).prototype.__joinerConfig();

/** Only the genuine noncascading rich family is loaded. Native Link owns
 * traversal, errors-as-data and retained endpoint-based restoration. */
export function prepareInventoryItemDeletionLinkResource(services: { readonly inventory: unknown }) {
  return Result.gen(function* () {
    const inventory = linkWorkflowServiceDefinition(services.inventory);
    if (inventory === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (inventory.admission !== "inventory-item-deletions" || inventory.lifecycle.maximumRows !== 8 || inventory.lifecycle.completeHistory !== true ||
      inventory.routing.__joinerConfig.serviceName !== ProductVariantInventoryItem.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const actualJoiner = yield* captureCommerceInput(inventory.routing.__joinerConfig);
    const expectedJoiner = yield* captureCommerceInput(nativeJoiner);
    if (!jsonEqual(actualJoiner, expectedJoiner)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const softDelete = inventory.softDeleteMethod, restore = inventory.restoreMethod;
    if (softDelete === undefined || restore === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const family = inventory.routing.__joinerConfig.serviceName;
    const decodeMap = commerceDecoder(Schema.Struct({
      variant_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
      inventory_item_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
    }), "storedCorruption");
    const decodeErrorSelector = commerceDecoder(Schema.Struct({ inventory_item_id: Ids }), "storedCorruption");
    const output = (method: "softDelete" | "restore") => (value: Json) => Result.gen(function* () {
      const tuple = yield* decodeLinkCascade(value);
      for (const [name, map] of Object.entries(tuple[1])) {
        if (name !== family) return yield* Result.fail(commerceError("storedCorruption"));
        const decoded = yield* decodeMap(map);
        if (Object.keys(decoded).length !== 0 && (decoded.variant_id === undefined || decoded.inventory_item_id === undefined ||
          decoded.variant_id.length !== decoded.inventory_item_id.length)) return yield* Result.fail(commerceError("storedCorruption"));
      }
      if (tuple[0] !== null) {
        if (tuple[0].length !== 1 || Object.keys(tuple[1]).length !== 0) return yield* Result.fail(commerceError("storedCorruption"));
        for (const error of tuple[0]) {
          if (error.serviceName !== family || error.method !== method) return yield* Result.fail(commerceError("storedCorruption"));
          yield* decodeErrorSelector(error.args);
        }
      }
      return tuple;
    });
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.inventory-item.deletion-links",
      services: [inventory.routing], lifecycle: inventory.lifecycle }, dependencies: [softDelete, restore],
      methods: { delete: { arguments: decodeEndpoint, output: output("softDelete") },
        restore: { arguments: decodeEndpoint, output: output("restore") } },
      bind: invoke => {
        const loaded = { ...structuredClone(inventory.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(restore, selector, config) };
        const native = new Link([loaded]);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}

export const prepareInventoryItemDeletionLinks = Effect.fn("InventoryItemDeletionLinks.prepare")(function* () {
  const metadata = yield* captureVariantInventoryLinkMetadata();
  const inventory = yield* prepareLinkService(metadata, 8, true);
  const native = yield* Effect.fromResult(prepareLinkWorkflowService(inventory, "inventoryItemLink", "inventory-item-deletions"));
  const softDelete = native.softDeleteMethod, restore = native.restoreMethod;
  const softDeleteCommand = native.softDelete, restoreCommand = native.restore;
  const softDeleteName = native.softDeleteName, restoreName = native.restoreName;
  const returnLinkableKeys = inventory.routing.__joinerConfig.primaryKeys;
  if (softDelete === undefined || restore === undefined || softDeleteCommand === undefined || restoreCommand === undefined ||
    softDeleteName === undefined || restoreName === undefined || returnLinkableKeys === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const validateLifecycle = yield* Effect.fromResult(compileLinkLifecycleReceipt({ table: metadata.frame,
    endpoints: ["variant_id", "inventory_item_id"], returnLinkableKeys, maximumEndpoints: 4, maximumRows: 8,
    softDeleteCommand: softDeleteName, restoreCommand: restoreName, selectionPlan: inventory.prepared.lifecycleReadPlan }));
  const basePolicy = linkLogicalEventPolicy(inventory.prepared.table.name, inventory.serviceName, inventory.entityName,
    ["variant_id", "inventory_item_id"], [native.createName], [], [softDeleteName], [restoreName]);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryItemDeletionLinks.validateCall")(function* (call, activity) {
    if (call.commandName === softDeleteName || call.commandName === restoreName) yield* validateLifecycle(call, activity);
    yield* basePolicy.validateLogicalCall(call, activity);
  });
  const logicalEventPolicy = (): ReturnType<typeof linkLogicalEventPolicy> => ({ capture: basePolicy.capture, validateLogicalCall });
  const nativeServices = { inventory: native };
  const resource = yield* Effect.fromResult(prepareInventoryItemDeletionLinkResource(nativeServices));
  const commands = [native.create, native.list, softDeleteCommand, restoreCommand];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "product_variant_inventory_item_deletion_links",
    source: { name: inventory.serviceName, profile: "inventory-item-deletions" }, graph: { aliases: [], reads: [] },
    methods: { create: native.createMethod, list: native.listMethod, softDelete, restore },
    logical: { ...logicalEventPolicy(), commands } }));
  return { inventory: { workflow, commands, logicalEventPolicy }, nativeServices, resource };
});
