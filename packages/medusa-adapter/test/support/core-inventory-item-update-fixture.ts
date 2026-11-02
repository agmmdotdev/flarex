import { Effect, Schema } from "effect";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { openCoreProductReadHost } from "./core-product-creation-fixture";
import { prepareInventoryItemUpdateWorkflow } from "../../src/workflows/inventory/update-items";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryItemUpdateCommandInput } from "../../src/modules/inventory/update-input";
import { prepareCoreInventoryMaintenance, type CoreInventoryMaintenanceShared } from "./core-inventory-maintenance-fixture";

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));

/** Item updates select their authentic command/policy and reuse the common
 * native maintenance seed owner without constructing a Level update host. */
export async function prepareCoreInventoryItemUpdate(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: CoreInventoryMaintenanceShared) {
  const common = await prepareCoreInventoryMaintenance(driver, registerCleanup, { ...shared, includeGraph: true });
  const { fixture, members, execution } = common;
  const update = await Effect.runPromise(makeLocalInventoryCommands("item-updates"));
  const reader = await openCoreProductReadHost(fixture, "inventory", update.commands);
  registerCleanup(() => Effect.runPromise(reader.close));
  const subscribers = [{ id: "inventory-item-update-test", revision: "5".repeat(64) }];
  // The exact registered module command preserves native scalar/array ABI;
  // the public workflow intentionally admits its array overload only.
  const nativePolicy = update.logicalEventPolicy(), participant = defineAtomicCommerceParticipant("inventory");
  const name = "inventory.inventory-item.updated";
  const contract = defineCommerceEventContract({ name, revision: "7".repeat(64), internal: true, decode: nativePolicy.capture });
  const nativeRoot = defineAtomicCommerceCommand("nativeInventoryItemUpdateAssertion", (ctx, input) => ctx.call(participant, update.update, input));
  const nativeHost = await Effect.runPromise(execution.prepare({ identityAndAccessPolicy: execution.identityAndAccessPolicy,
    participants: [{ participant, nativeStorage: members.inventory.source, commands: update.commands,
      validateLogicalCall: nativePolicy.validateLogicalCall, events: { contracts: [contract], select: message => isJsonObject(message) && message.name === name
        ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [nativeRoot], events: { producerRevision: "7".repeat(64), contracts: [contract], subscribers,
      validate: emitted => emitted.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  registerCleanup(() => Effect.runPromise(nativeHost.close));
  const nativeUpdate = (input: typeof InventoryItemUpdateCommandInput.Type) => nativeHost.run(nativeHost.newRequestKey(), nativeRoot, input);
  const options: Parameters<typeof prepareInventoryItemUpdateWorkflow>[0] = { execution,
    modules: { inventory: { module: update.workflow, nativeStorage: members.inventory.source } }, revision: "6".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryItemUpdateWorkflow({ ...options, revision })); registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const list = (ids: readonly string[]) => reader.read(update.list, { filters: { id: [...ids] }, config: {} }).pipe(Effect.flatMap(decodeRows));
  return { ...common, update, options, prepare, list, nativeUpdate,
    preserved: () => common.preserveTables(["inventory_level", "reservation_item", "product_variant_inventory_item"]) };
}
