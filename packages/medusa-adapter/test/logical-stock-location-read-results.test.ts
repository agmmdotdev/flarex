import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeGraphCount } from "../src/local-graph/query";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareInventoryStockingWorkflow } from "../src/workflows/inventory/stock";
import { prepareLogicalInventoryItemCreation } from "./support/logical-inventory-item-create-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryItemCreation>>;
const orderedIds = (prefix: string) => [prefix + "-z", prefix + "-\uE000", prefix + "-😀"];

/** Exercise each actual command/policy over the installed Location source.
 * Recording the owner's immutable call activity does not reproduce selection. */
async function prepareCountProbe(admission: "read" | "create") {
  const runtime = admission === "read" ? connected.locations : connected.members.stockLocation.runtime;
  const policy = workflowModuleDefinition(runtime.workflow)?.logical;
  if (policy === undefined) throw new Error("Missing genuine Stock Location logical policy");
  const participant = defineAtomicCommerceParticipant("stock_location");
  const command = defineAtomicCommerceCommand("stockLocationReadPagination", (ctx, input) => ctx.call(participant, runtime.count, input));
  const observations: Parameters<LogicalCommerceCallValidation>[1][] = [];
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("StockLocationReadProof.validate")(function* (call, activity, executed) {
    observations.push(activity);
    yield* policy.validateLogicalCall(call, activity, executed);
  });
  const host = await Effect.runPromise(connected.execution.prepare({ identityAndAccessPolicy: connected.execution.identityAndAccessPolicy,
    participants: [{ participant, logicalStorage: connected.members.stockLocation.hostInput.logicalStorage,
      commands: [runtime.count], validateLogicalCall }], commands: [command] }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { observations, read: (input: Json) => host.run(host.newRequestKey(), command, input)
    .pipe(Effect.flatMap(value => Effect.fromResult(decodeGraphCount(value)))) };
}

describe("Stock Location read-result receipts over actual logical selections", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalInventoryItemCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it.each(["read", "create"] as const)("authenticates the %s profile's complete count before pagination and UTF-8 order", async admission => {
    const ids = orderedIds("stock-read-" + admission), [first, middle, last] = ids;
    if (first === undefined || middle === undefined || last === undefined) throw new Error("Missing fixed Unicode Location IDs");
    // Deliberately insert in a different order from both native UTF-8 order
    // and UTF-16 order, which places the supplementary character before E000.
    await Effect.runPromise(connected.stocking.run(connected.stocking.newRequestKey(), {
      locations: [last, first, middle].map(id => ({ id, name: id })), inventory_levels: [],
    }));
    const probe = await prepareCountProbe(admission), before = await logicalCurrencyInventory(connected.fixture);
    const [page, count] = await Effect.runPromise(probe.read({ filters: { id: [last, first, middle] },
      config: { select: ["id", "name"], order: { id: "DESC" }, skip: 1, take: 1 } }));
    expect(page).toEqual([{ id: middle, name: middle }]); expect(count).toBe(3);
    expect(new Set(probe.observations.at(-1)?.observedRows.map(entry => entry.row.id))).toEqual(new Set(ids));
    expect(probe.observations.at(-1)?.mutations).toEqual([]);

    expect(await Effect.runPromise(probe.read({ filters: { id: ids },
      config: { select: ["id"], order: { id: "ASC" }, take: 3 } }))).toEqual([ids.map(id => ({ id })), 3]);
    expect(new Set(probe.observations.at(-1)?.observedRows.map(entry => entry.row.id))).toEqual(new Set(ids));
    expect(await Effect.runPromise(probe.read({ filters: { id: ids },
      config: { select: ["id"], order: { id: "DESC" }, skip: 1, take: 0 } }))).toEqual([[], 3]);
    expect(new Set(probe.observations.at(-1)?.observedRows.map(entry => entry.row.id))).toEqual(new Set(ids));
    expect(await Effect.runPromise(probe.read({ filters: { id: [] },
      config: { select: ["id"], take: 0 } }))).toEqual([[], 0]);
    expect(probe.observations.at(-1)?.observedRows).toEqual([]);
    const after = await logicalCurrencyInventory(connected.fixture);
    expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
  }, 180_000);

  it("authenticates paginated and zero-size reads of native Locations still pending in their creation root", async () => {
    const ids = orderedIds("stock-read-pending"), [first, middle, last] = ids;
    if (first === undefined || middle === undefined || last === undefined) throw new Error("Missing fixed Unicode Location IDs");
    let callbacks = 0;
    const host = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution: connected.execution,
      revision: "c".repeat(64), subscribers: [{ id: "stock-location-read-pending", revision: "d".repeat(64) }],
      modules: { inventory: { module: connected.members.inventory.runtime.workflow, logicalStorage: connected.members.inventory.hostInput.logicalStorage },
        stock_location: { module: connected.members.stockLocation.runtime.workflow, logicalStorage: connected.members.stockLocation.hostInput.logicalStorage } },
      hooks: { stockLocationsCreated: async ({ stockLocations }, { resources }) => {
        callbacks++;
        expect(stockLocations.map(row => row.id)).toEqual([last, first, middle]);
        const filters = { id: stockLocations.map(row => row.id) };
        expect(await resources.query.graph({ entity: "stock_location", fields: ["id", "name"], filters,
          pagination: { order: { id: "DESC" }, skip: 1, take: 1 } })).toEqual({
          data: [{ id: middle, name: middle }], metadata: { count: 3, skip: 1, take: 1 },
        });
        expect(await resources.query.graph({ entity: "stock_location", fields: ["id"], filters,
          pagination: { take: 0 } })).toEqual({ data: [], metadata: { count: 3, skip: 0, take: 0 } });
        expect(await resources.query.graph({ entity: "stock_location", fields: ["id"], filters,
          pagination: { take: 3 } })).toEqual({ data: ids.map(id => ({ id })), metadata: { count: 3, skip: 0, take: 3 } });
      } } }));
    cleanup.push(() => Effect.runPromise(host.close));
    const before = await logicalCurrencyInventory(connected.fixture), key = host.newRequestKey();
    const input = { locations: [last, first, middle].map(id => ({ id, name: id })), inventory_levels: [] };
    const result = await Effect.runPromise(host.run(key, input));
    expect(result.locations.map(row => row.id)).toEqual([last, first, middle]); expect(result.inventory_levels).toEqual([]); expect(callbacks).toBe(1);
    const after = await logicalCurrencyInventory(connected.fixture);
    expect(after.rows.length - before.rows.length).toBe(3); expect(after.rowChanges.length - before.rowChanges.length).toBe(3);
    expect(after.events.length - before.events.length).toBe(3); expect(after.commits.length - before.commits.length).toBe(1);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(callbacks).toBe(1);
    expect(await logicalCurrencyInventory(connected.fixture)).toEqual(after);
  }, 180_000);
});
