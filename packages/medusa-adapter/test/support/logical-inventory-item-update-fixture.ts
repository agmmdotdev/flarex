import { Effect, Schema } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { prepareInventoryItemUpdateWorkflow } from "../../src/workflows/inventory/update-items";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryItemUpdateCommandInput } from "../../src/modules/inventory/update-input";
import { prepareLogicalInventoryMaintenance, type LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));

/** Item updates select their authentic command/policy and reuse the common
 * native maintenance seed owner without constructing a Level update host. */
export async function prepareLogicalInventoryItemUpdate(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryMaintenance(driver, registerCleanup, shared);
  const { fixture, members, execution } = common;
  const update = await Effect.runPromise(makeLocalInventoryCommands("item-updates"));
  const reader = await Effect.runPromise(makeCommerceHost({ ...members.inventory.hostInput, commands: update.commands }));
  registerCleanup(() => Effect.runPromise(reader.close));
  const subscribers = [{ id: "inventory-item-update-test", revision: "5".repeat(64) }];
  // The exact registered module command preserves native scalar/array ABI;
  // the public workflow intentionally admits its array overload only.
  const nativePolicy = update.logicalEventPolicy(), participant = defineAtomicCommerceParticipant("inventory");
  const name = "inventory.inventory-item.updated";
  const contract = defineCommerceEventContract({ name, revision: "7".repeat(64), internal: true, decode: nativePolicy.capture });
  const nativeRoot = defineAtomicCommerceCommand("nativeInventoryItemUpdateAssertion", (ctx, input) => ctx.call(participant, update.update, input));
  const nativeHost = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: members.inventory.hostInput.logicalStorage, commands: update.commands,
      validateLogicalCall: nativePolicy.validateLogicalCall, events: { contracts: [contract], select: message => isJsonObject(message) && message.name === name
        ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [nativeRoot], events: { producerRevision: "7".repeat(64), contracts: [contract], subscribers,
      validate: emitted => emitted.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  registerCleanup(() => Effect.runPromise(nativeHost.close));
  const nativeUpdate = (input: typeof InventoryItemUpdateCommandInput.Type) => nativeHost.run(nativeHost.newRequestKey(), nativeRoot, input);
  const options: Parameters<typeof prepareInventoryItemUpdateWorkflow>[0] = { execution,
    modules: { inventory: { module: update.workflow, logicalStorage: members.inventory.hostInput.logicalStorage } }, revision: "6".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryItemUpdateWorkflow({ ...options, revision })); registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const list = (ids: readonly string[]) => reader.read(update.list, { filters: { id: [...ids] }, config: {} }).pipe(Effect.flatMap(decodeRows));
  return { ...common, update, options, prepare, list, nativeUpdate,
    preserved: () => common.preserved(["inventory_level", "reservation_item", "product_variant_inventory_item"]) };
}