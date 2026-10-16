import { Effect, Schema } from "effect";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryLevelUpdateCommandInput } from "../../src/modules/inventory/update-level-input";
import { InventoryLevelInput, InventoryLevelsOutput } from "../../src/modules/inventory/level-input";
import { prepareInventoryLevelUpdateWorkflow } from "../../src/workflows/inventory/update-levels";
import { prepareStockAdjustmentsWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareProductCreateWorkflow } from "../../src/workflows/product/create";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareInventoryCreateHost } from "./logical-inventory-fixture";
import { prepareLogicalInventoryMaintenance, type LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const Row = Schema.StructWithRest(Schema.Struct({ id: Schema.String, inventory_item_id: Schema.String, location_id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const decodeCreatedLevels = Schema.decodeUnknownEffect(InventoryLevelsOutput);
const probeInput = Schema.decodeUnknownEffect(Schema.Array(Schema.String).check(Schema.isMaxLength(8)));
const probeCommand = defineCommerceCommand("inventoryLevelMaintenanceProbe", "read", Effect.fn(function* (ctx, input) {
  const ids = yield* probeInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  return [...yield* (yield* ctx.table("inventory_level")).find(ctx.manager, { order: { column: "id", direction: "asc" }, take: 8,
    predicate: { kind: "in", column: "inventory_item_id", values: ids } })];
}));

/** Shared native seeds and the dedicated absolute-Level owner. Raw quantity
 * probes observe genuine stored companions; they implement no update logic. */
export async function prepareLogicalInventoryLevelUpdate(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryMaintenance(driver, registerCleanup, shared);
  const { fixture, members, execution } = common;
  const update = await Effect.runPromise(makeLocalInventoryCommands("level-updates"));
  const rawReader = await Effect.runPromise(makeCommerceHost({ ...members.inventory.hostInput, commands: [probeCommand] }));
  registerCleanup(() => Effect.runPromise(rawReader.close));
  const probe = (ids: readonly string[]) => rawReader.read(probeCommand, [...ids]).pipe(Effect.flatMap(decodeRows));
  const subscribers = [{ id: "inventory-level-update-test", revision: "8".repeat(64) }];
  const options: Parameters<typeof prepareInventoryLevelUpdateWorkflow>[0] = { execution,
    modules: { inventory: { module: update.workflow, logicalStorage: members.inventory.hostInput.logicalStorage } }, revision: "9".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryLevelUpdateWorkflow({ ...options, revision })); registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const adjust = await Effect.runPromise(prepareStockAdjustmentsWorkflow({ execution, inventory: common.inventory, revision: "a".repeat(64), subscribers }));
  registerCleanup(() => Effect.runPromise(adjust.close));
  const policy = update.logicalEventPolicy(), participant = defineAtomicCommerceParticipant("inventory");
  const eventName = "inventory.inventory-level.updated";
  const contract = defineCommerceEventContract({ name: eventName, revision: "b".repeat(64), internal: true, decode: policy.capture });
  const nativeRoot = defineAtomicCommerceCommand("nativeInventoryLevelUpdateAssertion", (ctx, input) => ctx.call(participant, update.update, input));
  const native = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: members.inventory.hostInput.logicalStorage, commands: update.commands,
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: [contract], select: message => isJsonObject(message) && message.name === eventName
        ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }], commands: [nativeRoot],
    events: { producerRevision: "b".repeat(64), contracts: [contract], subscribers,
      validate: emitted => emitted.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  registerCleanup(() => Effect.runPromise(native.close));
  let product: Awaited<ReturnType<typeof prepareLogicalProductHost>> | undefined;
  const seed = async (prefix: string, count = 1, connected = false) => {
    const items = await common.seed(prefix, count, connected), location = prefix + "-location";
    if (!connected) await Effect.runPromise(common.stocking.run(common.stocking.newRequestKey(), {
      locations: [{ id: location, name: location }], inventory_levels: items.map(inventory_item_id => ({ inventory_item_id, location_index: 0, stocked_quantity: 10 })) }));
    if (connected) {
      if (product === undefined) {
        const preparedProduct = await prepareLogicalProductHost(fixture); product = preparedProduct;
        registerCleanup(() => Effect.runPromise(preparedProduct.host.close));
        await Effect.runPromise(preparedProduct.host.initialize([]));
      }
      const creator = await Effect.runPromise(prepareProductCreateWorkflow({ execution, modules: {
        product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } }, revision: "c".repeat(64), subscribers }));
      try { await Effect.runPromise(creator.run(creator.newRequestKey(), { products: [{ id: prefix + "-product", title: prefix,
        options: [{ title: "Size", values: items.map((_, index) => String(index)) }],
        variants: items.map((_, index) => ({ id: prefix + "-unresolved-native-variant-" + index, title: prefix + index, options: { Size: String(index) } })) }] })); }
      finally { await Effect.runPromise(creator.close); }
    }
    return { items, location, levels: await Effect.runPromise(probe(items)), pairs: items.map(inventory_item_id => ({ inventory_item_id, location_id: location })) };
  };
  const seedCohort = async (prefix: string) => {
    const items: string[] = [], levels: Array<(typeof InventoryLevelsOutput.Type)[number]> = [], location = prefix + "-location";
    for (let batch = 0; batch < 3; batch++) {
      const selected = await common.seed(prefix + "-batch-" + batch, 4);
      items.push(...selected);
      const result = await Effect.runPromise(common.stocking.run(common.stocking.newRequestKey(), batch === 0
        ? { locations: [{ id: location, name: location }], inventory_levels: selected.map(inventory_item_id => ({ inventory_item_id, location_index: 0, stocked_quantity: 10 })) }
        : { locations: [], inventory_levels: selected.map(inventory_item_id => ({ inventory_item_id, location_id: location, stocked_quantity: 10 })) }));
      levels.push(...result.inventory_levels);
    }
    return { items, levels, location, pairs: items.map(inventory_item_id => ({ inventory_item_id, location_id: location })) };
  };
  const probeCohort = async (items: readonly string[]) => {
    const rows: Array<typeof Row.Type> = [];
    for (let offset = 0; offset < items.length; offset += 4) rows.push(...await Effect.runPromise(probe(items.slice(offset, offset + 4))));
    return rows;
  };
  const nativeUpdate = (input: typeof InventoryLevelUpdateCommandInput.Type) => native.run(native.newRequestKey(), nativeRoot, input);
  // Retained native test setup alone adapts the existing admitted ARRAY create
  // command and checks its single-row result. UPDATE calls preserve native ABI.
  const nativeCreateLevel = async (input: typeof InventoryLevelInput.Type) => {
    const creator = await prepareInventoryCreateHost(fixture, members.inventory, "levels");
    try {
      const rows = await Effect.runPromise(creator.host.run(creator.host.newRequestKey(), creator.create, [input])
        .pipe(Effect.flatMap(decodeCreatedLevels)));
      const level = rows[0]; if (rows.length !== 1 || level === undefined) throw new Error("Missing native single-level seed result");
      return level;
    } finally { await Effect.runPromise(creator.host.close); }
  };
  const preserved = async () => ({
    product: await common.preserved(["product", "product_variant", "product_option", "product_option_value", "product_variant_option"]),
    items: await common.preserved(["inventory_item"]), locations: await common.preserved(["stock_location", "stock_location_address"]),
    links: await common.preserved(["product_variant_inventory_item"]), reservations: await common.preserved(["reservation_item"]),
  });
  return { ...common, update, options, prepare, seed, probe, seedCohort, probeCohort, adjust, nativeUpdate, nativeCreateLevel, preserved };
}
