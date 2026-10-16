import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteInventoryItemWorkflow } from "@medusajs/core-flows/inventory/delete-inventory-items";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { fxControlTables, fxAppRowCurrent } from "../../../persistence-postgres/src/database/schema";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { InventoryItemDeletionInput } from "../../src/modules/inventory/delete-item-input";
import { prepareInventoryItemDeletionLinks } from "../../src/links/inventory-item-deletion";
import { prepareInventoryItemDeletionWorkflow } from "../../src/workflows/inventory/delete-items";
import { prepareInventoryLevelDeletionWorkflow } from "../../src/workflows/inventory/delete-levels";
import { prepareInventoryLevelUpdateWorkflow } from "../../src/workflows/inventory/update-levels";
import { prepareStockAdjustmentsWorkflow, prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareInventoryStockingWorkflow } from "../../src/workflows/inventory/stock";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalProductDeletion } from "./logical-product-deletion-fixture";

const prepared = Result.getOrThrow(deleteInventoryItemWorkflow.prepare());
function inverse(name: string) {
  const step = prepared.nodes.find(node => node.name === name);
  if (step?.kind !== "step" || step.compensation !== "transactionCovered" || step.compensate === undefined)
    throw new Error("Missing genuine Item deletion inverse " + name);
  return step.compensate;
}
const linkDeletion = prepared.nodes.find(node => node.name === "remove-remote-links");
if (linkDeletion?.kind !== "step") throw new Error("Missing genuine native Link deletion callback");
const deleteLinkCallback = linkDeletion.invoke;
const restoreItems = inverse("delete-inventory-item-step"), restoreLinks = inverse("remove-remote-links");
const Tables = Schema.Literals(["inventory_item", "inventory_level", "reservation_item", "product_variant_inventory_item"]);
const Probe = Schema.Struct({ table: Tables, ids: Schema.Array(Schema.String).check(Schema.isMaxLength(8)) });
const Row = Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeProbe = Schema.decodeUnknownEffect(Probe), decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const probeCommand = defineCommerceCommand("itemDeletionCompleteBodyProbe", "read", Effect.fn(function* (ctx, value) {
  const input = yield* decodeProbe(value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const table = yield* ctx.table(input.table);
  return [...yield* table.find(ctx.manager, { order: { column: "id", direction: "asc" }, take: 32,
    predicate: { kind: "in", column: input.table === "inventory_item" ? "id" : "inventory_item_id", values: [...input.ids] } })];
}));

/** Existing genuine Product and stock seeds own all graph creation. The new
 * root binds only Inventory lifecycle and its sole noncascading rich Link. */
export async function prepareLogicalInventoryItemDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalProductDeletion>[2]) {
  const common = await prepareLogicalProductDeletion(driver, close, shared);
  const { fixture, execution } = common;
  const deletion = await Effect.runPromise(makeLocalInventoryCommands("item-deletions"));
  const links = await Effect.runPromise(prepareInventoryItemDeletionLinks());
  const inventoryInput = common.creation.inventory.inventory.hostInput, linkInput = common.creation.inventory.link.hostInput;
  const modules: Parameters<typeof prepareInventoryItemDeletionWorkflow>[0]["modules"] = {
    inventory: { module: deletion.workflow, logicalStorage: inventoryInput.logicalStorage },
    inventory_item_links: { module: links.inventory.workflow, logicalStorage: linkInput.logicalStorage },
  };
  const subscribers = [{ id: "native-inventory-item-deletion", revision: "a".repeat(64) }];
  const options = { execution, modules, link: links.resource, revision: "b".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryItemDeletionWorkflow({ ...options, revision })); close(() => Effect.runPromise(host.close)); return host;
  };
  const readers = {
    inventory: await Effect.runPromise(makeCommerceHost({ ...inventoryInput, commands: [probeCommand] })),
    links: await Effect.runPromise(makeCommerceHost({ ...linkInput, commands: [probeCommand] })),
  };
  for (const reader of Object.values(readers)) close(() => Effect.runPromise(reader.close));
  const probe = (table: typeof Tables.Type, ids: readonly string[]) =>
    (table === "product_variant_inventory_item" ? readers.links : readers.inventory).read(probeCommand, { table, ids: [...ids] }).pipe(Effect.flatMap(decodeRows));
  const policy = deletion.logicalEventPolicy(), participant = defineAtomicCommerceParticipant("inventory");
  const names = ["inventory.inventory-item.deleted", "inventory.inventory-item.restored", "inventory.inventory-level.deleted", "inventory.inventory-level.restored",
    "inventory.reservation-item.deleted", "inventory.reservation-item.restored"];
  const namedContracts = names.map(name => ({ name, contract: defineCommerceEventContract({ name, revision: "c".repeat(64), internal: true, decode: policy.capture }) }));
  const contracts = namedContracts.map(entry => entry.contract);
  const softDelete = defineAtomicCommerceCommand("nativeInventoryItemSoftDeleteAssertion", (ctx, input) => ctx.call(participant, deletion.softDeleteForWorkflow, input));
  const restore = defineAtomicCommerceCommand("nativeInventoryItemRestoreAssertion", (ctx, input) => ctx.call(participant, deletion.restoreForWorkflow, input));
  const native = await Effect.runPromise(execution.prepare({ identityAndAccessPolicy: { profile: "inventory-item-lifecycle-assertion" },
    participants: [{ participant, logicalStorage: inventoryInput.logicalStorage, commands: deletion.commands, validateLogicalCall: policy.validateLogicalCall,
      events: { contracts, select: message => {
        const selected = isJsonObject(message) ? namedContracts.find(entry => entry.name === message.name)?.contract : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected);
      } } }], commands: [softDelete, restore], events: { producerRevision: "c".repeat(64), contracts, subscribers,
      validate: emitted => emitted.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  close(() => Effect.runPromise(native.close));
  const prepareRestore = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      inventory: { module: deletion.workflow, methods: ["restoreInventoryItems"], graph: false },
      inventory_item_links: { module: links.inventory.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    }, true, { link: links.resource }));
    const invoke = createStep("invoke-retained-item-delete-compensators", resources.callback(async (ids: typeof InventoryItemDeletionInput.Type, context) => {
      await restoreItems([...ids], context); await restoreLinks({ inventory: { inventory_item_id: [...ids] } }, context); return null;
    }));
    const workflow = createWorkflow("probe-retained-item-delete-compensation", (input: WorkflowData<typeof InventoryItemDeletionInput.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, operationScheduling: "queued", revision: "d".repeat(64), subscribers,
      workflow: { name: "probeRetainedItemDeleteCompensation", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: InventoryItemDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLinkDelete = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      inventory_item_links: { module: links.inventory.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    }, true, { link: links.resource }));
    const invoke = createStep("invoke-genuine-item-link-delete", resources.callback(async (ids: typeof InventoryItemDeletionInput.Type, context) => {
      await deleteLinkCallback({ inventory: { inventory_item_id: [...ids] } }, context); return null;
    }));
    const workflow = createWorkflow("seed-predeleted-item-links", (input: WorkflowData<typeof InventoryItemDeletionInput.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { inventory_item_links: modules.inventory_item_links },
      operationScheduling: "queued", revision: "3".repeat(64), subscribers,
      workflow: { name: "seedPredeletedItemLinks", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: InventoryItemDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const levelDeletion = await Effect.runPromise(makeLocalInventoryCommands("level-deletions"));
  const levelDeleter = await Effect.runPromise(prepareInventoryLevelDeletionWorkflow({ execution, revision: "4".repeat(64), subscribers,
    modules: { inventory: { module: levelDeletion.workflow, logicalStorage: inventoryInput.logicalStorage } } }));
  close(() => Effect.runPromise(levelDeleter.close));
  const stock = await Effect.runPromise(makeLocalInventoryCommands("stock"));
  const locations = await Effect.runPromise(makeStockLocationCommands("create"));
  const stockModule = { module: stock.workflow, logicalStorage: inventoryInput.logicalStorage };
  const stocking = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution, revision: "e".repeat(64), subscribers,
    modules: { inventory: stockModule, stock_location: { module: locations.workflow, logicalStorage: common.creation.inventory.stockLocation.hostInput.logicalStorage } } }));
  const reservations = await Effect.runPromise(prepareCreateReservationWorkflow({ execution, inventory: stockModule, revision: "f".repeat(64), subscribers }));
  const adjust = await Effect.runPromise(prepareStockAdjustmentsWorkflow({ execution, inventory: stockModule, revision: "0".repeat(64), subscribers }));
  for (const host of [stocking, reservations, adjust]) close(() => Effect.runPromise(host.close));
  const update = await Effect.runPromise(makeLocalInventoryCommands("level-updates"));
  const updater = await Effect.runPromise(prepareInventoryLevelUpdateWorkflow({ execution, revision: "1".repeat(64), subscribers,
    modules: { inventory: { module: update.workflow, logicalStorage: inventoryInput.logicalStorage } } }));
  close(() => Effect.runPromise(updater.close));
  const seed = async (prefix: string, productCount = 1, quantity = 0, levelsPerItem = 2, maximumLinks = false) => {
    const products = await common.seed(prefix, productCount, 2, true);
    const items = Array.from({ length: productCount * 2 }, (_, index) => prefix + "-inventory-" + index);
    const locationIds = Array.from({ length: levelsPerItem }, (_, index) => prefix + "-location-" + index);
    await Effect.runPromise(stocking.run(stocking.newRequestKey(), { locations: locationIds.map(id => ({ id, name: id,
      address: { id: id + "-address", address_1: "Retained street", city: "Retained", country_code: "US" } })), inventory_levels: [] }));
    await common.seedStock(prefix, items, quantity, levelsPerItem);
    let outsideItems: string[] = [];
    if (maximumLinks) {
      const outside = await common.seed(prefix + "-outside", productCount, 2, true);
      outsideItems = Array.from({ length: productCount * 2 }, (_, index) => prefix + "-outside-inventory-" + index);
      const variants = outside.flatMap(product => product.variants);
      for (const [index, id] of items.entries()) {
        const variant = variants[index % variants.length]; if (variant === undefined) throw new Error("Missing actual outside Variant");
        await common.attachInventory(variant.id, id);
      }
    }
    return { products, items, outsideItems, locations: locationIds, pairs: items.map(inventory_item_id => ({ inventory_item_id, location_id: locationIds[0]! })) };
  };
  const preserved = async () => {
    const names = ["product", "product_variant", "product_option", "product_option_value", "product_variant_option", "product_image", "product_tag",
      "product_category", "price_set", "price", "price_rule", "price_list", "product_variant_price_set", "product_sales_channel", "product_shipping_profile",
      "stock_location", "stock_location_address"];
    const tables = await fixture.control.drizzle.select().from(fxControlTables).where(and(eq(fxControlTables.deploymentId, fixture.deploymentId), eq(fxControlTables.namespace, "medusa")));
    const selected = new Set(tables.filter(table => names.some(name => table.logicalName.endsWith("/" + name))).map(table => table.tableId));
    return (await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId)).filter(row => selected.has(row.tableId));
  };
  return { ...common, deletion, links, options, prepare, prepareRestore, prepareLinkDelete, levelDeleter, probe, preserved, seed, stocking, reservations, adjust, updater,
    nativeDelete: (ids: readonly string[]) => native.run(native.newRequestKey(), softDelete, { selector: [...ids], config: {} }),
    nativeRestore: (ids: readonly string[]) => native.run(native.newRequestKey(), restore, { selector: [...ids], config: {} }) };
}
