import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { compilePriceListPriceRemovalContracts } from "../src/modules/pricing/price-list-price-removal-input";
import { prepareRemovePriceListPricesWorkflow } from "../src/workflows/pricing/remove-price-list-prices";
import { prepareLogicalPriceListPriceRemoval } from "./support/logical-price-list-price-removal-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListPriceRemoval>>;
let contracts: Result.Result.Success<ReturnType<typeof compilePriceListPriceRemovalContracts>>;
let protectedRows: Awaited<ReturnType<typeof connected.read>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
type Rows = Awaited<ReturnType<typeof connected.readRows>>;
type SeedInput = Parameters<typeof connected.seedLists>[0];
type SeedPrice = NonNullable<SeedInput["price_lists_data"][number]["prices"]>[number];
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const text = Schema.decodeUnknownSync(Schema.String);
const id = (row: Rows[number]["row"]) => text(row.id);
const children = (row: Rows[number]["row"], key: string) => objects(row[key]);
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const decodeMessage = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ object: Schema.String, action: Schema.String }), data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = decodeMessage(event.envelope.message);
  return (Array.isArray(message.data.id) ? message.data.id : [message.data.id]).map(id => [message.metadata.object, id, message.metadata.action]);
});
const graph = (rows: Rows, selected: readonly string[]) => {
  const prices = rows.filter(entry => entry.table === "price" && selected.includes(id(entry.row))).sort((left, right) => id(left.row).localeCompare(id(right.row)));
  return [...prices, ...prices.flatMap(price => rows.filter(entry => entry.table === "price_rule" && entry.row.price_id === price.row.id)
    .sort((left, right) => id(left.row).localeCompare(id(right.row))))];
};
const stable = (rows: Rows) => rows.map(entry => ({ table: entry.table,
  row: Object.fromEntries(Object.entries(entry.row).filter(([key]) => key !== "updated_at" && key !== "deleted_at")) }));
const expectedEvents = (rows: Rows) => rows.map(entry => [entry.table, id(entry.row), entry.row.deleted_at === null ? "deleted" : "updated"]);
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};
function measure<Value, Failure, Requirements>(phase: string, work: Effect.Effect<Value, Failure, Requirements>) {
  let calls = 0;
  return work.pipe(Effect.provideService(ExecutionDiagnostics, { observe: (name, observed) => {
    if (name === "BoundedRequest.enter") calls++; return observed;
  } }), Effect.onExit(exit => Effect.sync(() => console.info("Price removal default64 capacity", {
    driver, phase, calls, outcome: exit._tag, ...(exit._tag === "Failure" ? { reasons: reasons(exit.cause) } : {}),
  }))), Effect.tap(() => Effect.sync(() => expect(calls).toBeLessThanOrEqual(64))));
}
const run = async (ids: string[]) => { const host = await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), { ids })); };
const seed = async (suffix: string, prices: readonly SeedPrice[] = []) => {
  const lists = await connected.seedLists({ price_lists_data: [{ title: "native157-" + suffix, description: suffix, prices }] });
  if (!lists[0]) throw new Error("Missing genuine native List seed");
  return lists[0];
};
const price = (variant = 0, rules: Record<string, string> = { first157: "original", second157: "retained" }) => ({
  variant_id: connected.variantIds[variant]!, currency_code: "USD", amount: 40, rules,
});
const maximum = async (suffix: string) => {
  const lists = await connected.seedLists({ price_lists_data: Array.from({ length: 4 }, (_, index) => ({
    title: `maximum157-${suffix}-${index}`, description: suffix, prices: [price(index), { ...price((index + 1) % 4), currency_code: "EUR" }],
  })) });
  const selected = lists.flatMap(list => children(list, "prices").map(id));
  expect(selected).toHaveLength(8);
  expect(lists.flatMap(list => children(list, "prices").flatMap(row => children(row, "price_rules")))).toHaveLength(16);
  return selected.sort();
};

describe(`approved portable original Price List Price removal - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalPriceListPriceRemoval(driver, close => cleanup.push(close));
    contracts = Result.getOrThrow(compilePriceListPriceRemovalContracts((await Effect.runPromise(capturePricingMetadata())).frame));
    protectedRows = await connected.read(connected.protectedIds);
  }, 240_000);
  afterEach(async () => {
    await connected.closeCaseHosts(); vi.restoreAllMocks();
    expect(await connected.read(connected.protectedIds)).toEqual(protectedRows);
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps empty forward and retained inverse free of Pricing calls, including replay", async () => {
    const before = await connected.snapshot(), list = vi.spyOn(PricingModuleService.prototype, "listPrices"),
      remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices"), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    expect(connected.native.nodes.filter(node => node.kind === "step").map(node => node.name)).toEqual(["remove-price-list-prices"]);
    const host = await connected.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { ids: [] }))).toEqual([]);
    const committed = await connected.snapshot();
    expect(await Effect.runPromise(host.run(key, { ids: [] }))).toEqual([]); expect(await connected.snapshot()).toEqual(committed);
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [] }));
    expect(retained).toEqual({ output: [], compensation: [] });
    const inverse = await connected.prepareInverse(true); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation))).toBeNull();
    expect(list).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    noMutation(before, await connected.snapshot());
  });

  it("passes raw empty/duplicate/missing/List selectors and still deletes an empty actual cohort", async () => {
    const before = await connected.snapshot(), entries: unknown[] = [], original = PricingModuleService.prototype.listPrices;
    const list = vi.spyOn(PricingModuleService.prototype, "listPrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      entries.push(structuredClone(args.slice(0, 2))); return Reflect.apply(original, this, args);
    }), remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices");
    const ids = ["", "missing157", connected.historicalRootId, "missing157"];
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids }));
    expect(retained).toEqual({ output: [], compensation: [] }); expect(list).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([[{ id: ids }, { relations: ["price_list"] }]]);
    // The executing generated native list method supplies its default order
    // by mutating the config after entry; the original callback omitted it.
    expect(list.mock.calls[0]?.[1]).toEqual({ relations: ["price_list"], order: { id: "ASC" } });
    expect(remove.mock.calls[0]?.[0]).toEqual([]); noMutation(before, await connected.snapshot());
  });

  it("selects actual Price IDs across Lists in ID order and retains only selected identities", async () => {
    const first = await seed("cross-a", [price(0)]), second = await seed("cross-b", [price(1)]);
    const selected = [id(children(first, "prices")[0]!), id(children(second, "prices")[0]!)].sort();
    const before = await connected.readRows(), list = vi.spyOn(PricingModuleService.prototype, "listPrices"), remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices");
    const raw = [selected[1]!, "", selected[0]!, selected[1]!, id(first), "missing157"];
    const host = await connected.prepareForward(), result = await Effect.runPromise(host.run(host.newRequestKey(), { ids: raw }));
    expect(result).toEqual({ output: selected, compensation: selected }); expect(list.mock.calls[0]?.[0]).toEqual({ id: raw }); expect(remove.mock.calls[0]?.[0]).toEqual(selected);
    const selectedGraph = graph(before, selected), after = await connected.readRows();
    expect(stable(graph(after, selected))).toEqual(stable(selectedGraph));
    expect(graph(after, selected).every(entry => typeof entry.row.deleted_at === "string")).toBe(true);
    const selectedKeys = new Set(selectedGraph.map(entry => entry.table + "/" + entry.row.id));
    expect(after.filter(entry => !selectedKeys.has(entry.table + "/" + entry.row.id))).toEqual(before.filter(entry => !selectedKeys.has(entry.table + "/" + entry.row.id)));
  });

  it("finishes all eight Prices and sixteen Rules under default64 with complete ordered events and replay", async () => {
    const selected = await maximum("forward"), beforeRows = await connected.readRows(), expected = graph(beforeRows, selected), before = await connected.snapshot();
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices"), host = await connected.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(measure("maximum root", host.run(key, { ids: [...selected].reverse() })))).toEqual(selected);
    expect(remove).toHaveBeenCalledTimes(1);
    const map = Result.getOrThrow(contracts.decodeOutput(await remove.mock.results[0]?.value));
    expect(map).toMatchObject({ price_id: selected, price_rule_id: expected.filter(entry => entry.table === "price_rule").map(entry => id(entry.row)) });
    const afterRows = await connected.readRows(), after = await connected.snapshot();
    expect(graph(afterRows, selected)).toHaveLength(24); expect(graph(afterRows, selected).every(entry => typeof entry.row.deleted_at === "string")).toBe(true);
    expect(stable(graph(afterRows, selected))).toEqual(stable(expected));
    expect(eventVector(eventsSince(before, after))).toEqual(expectedEvents(expected));
    expect(eventsSince(before, after)).toHaveLength(24); expect(after.physicalFacts).toEqual(before.physicalFacts);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 24);
    const touched = new Set(expected.map(entry => entry.table + "/" + entry.row.id));
    expect(afterRows.filter(entry => !touched.has(entry.table + "/" + entry.row.id))).toEqual(beforeRows.filter(entry => !touched.has(entry.table + "/" + entry.row.id)));
    expect(await Effect.runPromise(host.run(key, { ids: [...selected].reverse() }))).toEqual(selected);
    expect(remove).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
  });

  it("orders Rules by parent then child rather than globally and qualifies same-ID preimages by table", async () => {
    const selected = ["price157-order-a", "price157-order-z"], beforeRows = await connected.readRows(), closure = graph(beforeRows, selected), before = await connected.snapshot();
    const expected = [
      ["price", "price157-order-a", "deleted"], ["price", "price157-order-z", "deleted"],
      ["price_rule", "prule157-order-y", "deleted"], ["price_rule", "prule157-order-z", "deleted"],
      ["price_rule", "price157-order-a", "updated"], ["price_rule", "prule157-order-b", "deleted"],
    ];
    expect(expectedEvents(closure)).toEqual(expected);
    const forward = await connected.prepareForward(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [...selected].reverse() }));
    expect(result).toEqual({ output: selected, compensation: selected });
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual(expected);
    expect(stable(graph(await connected.readRows(), selected))).toEqual(stable(closure));
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(graph(await connected.readRows(), selected).every(entry => entry.row.deleted_at === null)).toBe(true);
  });

  it("runs the complete original retained inverse and two independently committed cycles", async () => {
    const selected = await maximum("cycles"), original = graph(await connected.readRows(), selected), forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    for (const cycle of [0, 1]) {
      const retained = await Effect.runPromise(measure("maximum retained forward " + cycle, forward.run(forward.newRequestKey(), { ids: [...selected].reverse() })));
      expect(retained).toEqual({ output: selected, compensation: selected });
      const before = await connected.snapshot(), key = inverse.newRequestKey();
      expect(await Effect.runPromise(measure("maximum original inverse " + cycle, inverse.run(key, retained.compensation)))).toBeNull();
      expect(restore).toHaveBeenCalledTimes(cycle + 1); expect(restore.mock.calls[cycle]?.[0]).toEqual(selected);
      const restored = graph(await connected.readRows(), selected); expect(stable(restored)).toEqual(stable(original));
      expect(restored.every(entry => entry.row.deleted_at === null)).toBe(true);
      const after = await connected.snapshot(); expect(eventsSince(before, after)).toEqual([]); expect(after.physicalFacts).toEqual(before.physicalFacts);
      expect(await Effect.runPromise(inverse.run(key, retained.compensation))).toBeNull(); expect(await connected.snapshot()).toEqual(after);
      expect(restore).toHaveBeenCalledTimes(cycle + 1);
    }
  });

  it("restamps complete historical Rules as updates while keeping stored historical List identities", async () => {
    const selected = ["price152-comparison-0", "price152-comparison-2"], beforeRows = await connected.readRows(), closure = graph(beforeRows, selected), before = await connected.snapshot();
    expect(closure.filter(entry => entry.table === "price_rule" && entry.row.deleted_at !== null)).toHaveLength(2);
    const read = objects(await connected.listPrices([...selected].reverse())); expect(read.map(id)).toEqual(selected);
    for (const row of read) expect(row).toMatchObject({ price_list: null, price_list_id: null, price_set: { id: connected.setIds[0] } });
    const forward = await connected.prepareForward(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: selected }));
    expect(result.compensation).toEqual(selected);
    const afterRows = await connected.readRows(); expect(stable(graph(afterRows, selected))).toEqual(stable(closure));
    expect(graph(afterRows, selected).every(entry => entry.row.price_list_id === undefined || entry.row.price_list_id === connected.historicalRootId)).toBe(true);
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual(expectedEvents(closure));
    for (const old of closure.filter(entry => entry.row.deleted_at !== null)) {
      const current = afterRows.find(entry => entry.table === old.table && entry.row.id === old.row.id);
      expect(current?.row.deleted_at).not.toBe(old.row.deleted_at); expect(current?.row.updated_at).toBe(current?.row.deleted_at);
    }
    const deleted = await connected.snapshot(), inverse = await connected.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(graph(await connected.readRows(), selected).every(entry => entry.row.deleted_at === null)).toBe(true);
    expect(eventsSince(deleted, await connected.snapshot())).toEqual([]);
  });

  it("requires the active Set inner join and leaves a hidden active Price untouched", async () => {
    const hidden = await connected.read([connected.hiddenSetId, connected.hiddenPriceId]), before = await connected.snapshot();
    expect(hidden.find(row => row.id === connected.hiddenPriceId)?.deleted_at).toBeNull();
    expect(await connected.listPrices([connected.hiddenPriceId])).toEqual([]); expect(await run([connected.hiddenPriceId])).toEqual([]);
    expect(await connected.read([connected.hiddenSetId, connected.hiddenPriceId])).toEqual(hidden); noMutation(before, await connected.snapshot());
  });

  it("accepts a base Price without expanding Lists or touching adjacent Price graphs", async () => {
    const selected = connected.basePriceId, before = await connected.readRows();
    const list = objects(await connected.listPrices([selected])); expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: selected, price_list: null, price_list_id: null });
    const forward = await connected.prepareForward(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    expect(result).toEqual({ output: [selected], compensation: [selected] });
    expect((await connected.read([selected]))[0]?.deleted_at).toEqual(expect.any(String));
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(stable(await connected.readRows())).toEqual(stable(before));
  });

  it("preserves outside scalar edits and restores the current late Rule graph without recreating a removed child", async () => {
    const list = await seed("current-graph", [price()]), old = children(list, "prices")[0]!, selected = id(old);
    const oldRules = children(old, "price_rules").map(id), forward = await connected.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    await connected.restorePrices([selected]);
    const updated = await connected.outsideUpdate({ data: [{ id: id(list), prices: [{ id: selected, ...price(0, { late157: "outside" }), amount: 77 }] }] });
    expect(updated.map(id)).toEqual([selected]);
    const current = graph(await connected.readRows(), [selected]), newRules = current.filter(entry => entry.table === "price_rule");
    expect(newRules).toHaveLength(1); expect(oldRules).not.toContain(id(newRules[0]!.row));
    expect((await connected.read(oldRules))).toEqual([]);
    // The genuine parent cascade makes this newly added Rule historical.
    // The frozen native witness separately proves Rule-specific soft deletion.
    await connected.softDeletePrices([selected]);
    const lateHistory = graph(await connected.readRows(), [selected]).filter(entry => entry.table === "price_rule");
    expect(lateHistory).toHaveLength(1); expect(lateHistory[0]?.row.deleted_at).toEqual(expect.any(String));
    expect(oldRules).not.toContain(id(lateHistory[0]!.row));
    const before = await connected.snapshot(), inverse = await connected.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation));
    const restored = graph(await connected.readRows(), [selected]); expect(stable(restored)).toEqual(stable(current));
    expect(restored.every(entry => entry.row.deleted_at === null)).toBe(true); expect((await connected.read([selected]))[0]?.amount).toBe("77.000000000000000000");
    expect(await connected.read(oldRules)).toEqual([]); expect(eventsSince(before, await connected.snapshot())).toEqual([]);
  });

  it("creates a late active Rule through native156 under a historical Price and restores the genuine current graph", async () => {
    const list = await seed("late-active", [price(0, { original157: "before" })]), old = children(list, "prices")[0]!, selected = id(old);
    const originalIds = children(old, "price_rules").map(id), forward = await connected.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    const deletedGraph = graph(await connected.readRows(), [selected]);
    const update = vi.spyOn(PricingModuleService.prototype, "updatePriceListPrices");
    await connected.outsideUpdate({ data: [{ id: id(list), prices: [{ id: selected, ...price(0, { lateActive157: "after" }), amount: 88 }] }] });
    expect(update).toHaveBeenCalledTimes(1);
    const current = graph(await connected.readRows(), [selected]), currentRoot = current.find(entry => entry.table === "price"),
      lateRule = current.find(entry => entry.table === "price_rule");
    if (currentRoot === undefined || lateRule === undefined) throw new Error("Missing genuine native156 late active Rule graph");
    expect(currentRoot.row.deleted_at).toBe(deletedGraph.find(entry => entry.table === "price")?.row.deleted_at);
    expect(currentRoot.row.amount).toBe("88.000000000000000000");
    expect(lateRule.row).toMatchObject({ price_id: selected, attribute: "lateActive157", value: "after", deleted_at: null });
    expect(current.filter(entry => entry.table === "price_rule")).toHaveLength(1);
    expect(await connected.read(originalIds)).toEqual([]);
    const before = await connected.snapshot();
    const inverse = await connected.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation));
    const restored = graph(await connected.readRows(), [selected]); expect(stable(restored)).toEqual(stable(current));
    expect(restored.every(entry => entry.row.deleted_at === null)).toBe(true);
    expect(restored.find(entry => entry.table === "price_rule")?.row).toEqual(lateRule.row);
    expect(eventsSince(before, await connected.snapshot())).toEqual([]);
  });

  it("restores a canonical initial mixed-history graph while preserving the already-active Rule row clock", async () => {
    const selected = connected.mixedHistoryPriceId, original = graph(await connected.readRows(), [selected]);
    const originalRules = original.filter(entry => entry.table === "price_rule"), active = originalRules.find(entry => entry.row.deleted_at === null);
    expect(original.find(entry => entry.table === "price")?.row.deleted_at).toEqual(expect.any(String));
    expect(originalRules).toHaveLength(2); expect(originalRules.filter(entry => entry.row.deleted_at !== null)).toHaveLength(1);
    if (!active) throw new Error("Missing canonical initially active Rule");
    // This comparison starts as imported mixed history, independently of the
    // genuine late native156 mutation exercised above.
    const before = await connected.snapshot(), inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [selected]))).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1); expect(restore.mock.calls[0]?.[0]).toEqual([selected]);
    expect(Result.getOrThrow(contracts.decodeOutput(await restore.mock.results[0]?.value))).toEqual({
      price_id: [selected], price_rule_id: originalRules.map(entry => id(entry.row)),
    });
    const restored = graph(await connected.readRows(), [selected]);
    expect(restored.map(entry => [entry.table, id(entry.row)])).toEqual(original.map(entry => [entry.table, id(entry.row)]));
    expect(stable(restored)).toEqual(stable(original)); expect(restored.every(entry => entry.row.deleted_at === null)).toBe(true);
    expect(restored.find(entry => entry.table === "price_rule" && entry.row.id === active.row.id)?.row).toEqual(active.row);
    const after = await connected.snapshot(); expect(eventsSince(before, after)).toEqual([]); expect(after.physicalFacts).toEqual(before.physicalFacts);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 2);
  });

  it("keeps a physically removed retained root and its Rules absent", async () => {
    const list = await seed("physical-missing", [price()]), old = children(list, "prices")[0]!, selected = id(old), ids = [selected, ...children(old, "price_rules").map(id)];
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    const physical = await connected.preparePhysicalDeletion(); await Effect.runPromise(physical.run(physical.newRequestKey(), [selected]));
    expect(await connected.read(ids)).toEqual([]);
    const before = await connected.snapshot(), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices"), inverse = await connected.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained.compensation))).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1); expect(await restore.mock.results[0]?.value).toEqual({});
    expect(await connected.read(ids)).toEqual([]); noMutation(before, await connected.snapshot());
  });

  it("retains historical/active Rule twins and rolls a conflicting original inverse back completely", async () => {
    const selected = connected.collisionId, forward = await connected.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    const before = await connected.snapshot(), stored = graph(await connected.readRows(), [selected]), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    expect(stored.filter(entry => entry.table === "price_rule")).toHaveLength(2);
    const inverse = await connected.prepareInverse(), failed = await Effect.runPromise(Effect.exit(inverse.run(inverse.newRequestKey(), retained.compensation)));
    expect(failed._tag).toBe("Failure"); expect(restore).toHaveBeenCalledTimes(1);
    expect(graph(await connected.readRows(), [selected])).toEqual(stored); expect(await connected.snapshot()).toEqual(before);
  });

  it("returns native active restore maps without dirty row clocks, row publication or events", async () => {
    const list = await seed("active-restore", [price()]), old = children(list, "prices")[0]!, selected = id(old);
    const beforeRows = await connected.readRows(), before = await connected.snapshot(), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    const result = await connected.restorePrices([selected]);
    expect(result).toMatchObject({ price_id: [selected], price_rule_id: children(old, "price_rules").map(id).sort() });
    expect(restore).toHaveBeenCalledTimes(1); expect(await connected.readRows()).toEqual(beforeRows);
    const after = await connected.snapshot(); noMutation(before, after);
    // A fresh committed call records its durable outcome even though native
    // dirty detection preserves every managed row clock and mutation family.
    expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
  });

  it("repeats the real retained inverse but replays its durable request without calling native restore again", async () => {
    const list = await seed("repeat-inverse", [price()]), selected = id(children(list, "prices")[0]!), forward = await connected.prepareForward();
    const retained = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: [selected] }));
    const before = await connected.snapshot(), inverse = await connected.prepareInverse(true), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices"), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, retained.compensation))).toBeNull();
    expect(restore).toHaveBeenCalledTimes(2); expect(restore.mock.calls.map(call => call[0])).toEqual([[selected], [selected]]);
    const restored = await connected.snapshot(); expect(eventsSince(before, restored)).toEqual([]);
    expect(await Effect.runPromise(inverse.run(key, retained.compensation))).toBeNull();
    expect(restore).toHaveBeenCalledTimes(2); expect(await connected.snapshot()).toEqual(restored);
  });

  it("rolls the complete maximum graph back after genuine forward success and a late parent failure", async () => {
    const selected = await maximum("late-parent"), before = await connected.snapshot(), host = await connected.prepareWrapped({ lateFailure: true });
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices"), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
    const failed = await Effect.runPromise(Effect.exit(measure("maximum late parent", host.run(host.newRequestKey(), { ids: [...selected].reverse() }))));
    expect(failed._tag).toBe("Failure"); if (failed._tag !== "Failure") throw new Error("Late parent unexpectedly committed");
    expect(reasons(failed.cause).join(" -> ")).toContain("Late parent failure after genuine Price removal");
    expect(remove).toHaveBeenCalledTimes(1); expect(await remove.mock.results[0]?.value).toMatchObject({ price_id: selected,
      price_rule_id: expect.arrayContaining(graph(await connected.readRows(), selected).filter(entry => entry.table === "price_rule").map(entry => id(entry.row))) });
    expect(restore).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
  });

  it("keeps caught refusal sticky and exposes only Pricing plus SDK EventBus authority", async () => {
    const list = await seed("authority", [price()]), selected = id(children(list, "prices")[0]!), before = await connected.snapshot();
    const refused = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(refused.run(refused.newRequestKey(), { ids: [selected] }))).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: value => {
      expect(Object.keys(Object(value)).sort()).toEqual(["event_bus", "pricing"]);
      expect(Object.keys(Object(Reflect.get(Object(value), "pricing"))).sort()).toEqual(["listPrices", "restorePrices", "softDeletePrices"]);
    }, escape: work => { escaped = work; } });
    await Effect.runPromise(host.run(host.newRequestKey(), { ids: [selected] })); if (!escaped) throw new Error("Missing escaped method");
    const committed = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); expect(await connected.snapshot()).toEqual(committed);
  });

  it("captures selectors before native execution and rejects malformed/accessor inputs without calling getters", async () => {
    const list = await seed("capture", [price(0), price(1)]), selected = children(list, "prices").map(id), input = { ids: [selected[0]!] };
    const original = PricingModuleService.prototype.listPrices;
    const listSpy = vi.spyOn(PricingModuleService.prototype, "listPrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      input.ids.push(selected[1]!); return Reflect.apply(original, this, args);
    });
    expect(await run(input.ids)).toEqual([selected[0]]); expect(listSpy.mock.calls[0]?.[0]).toEqual({ id: [selected[0]] });
    expect((await connected.read([selected[1]!]))[0]?.deleted_at).toBeNull(); expect(input.ids).toEqual(selected);
    listSpy.mockRestore();
    const host = await connected.prepare(), before = await connected.snapshot(), getter = vi.fn(() => selected), accessor = Object.defineProperty({}, "ids", { enumerable: true, get: getter });
    for (const value of [accessor, { ids: selected, managed: true }, { ids: Array(9).fill(selected[0]) }, { ids: ["x".repeat(257)] }, { ids: [1] }, selected])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), value]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    const other = await Effect.runPromise(makeLocalPricingCommands("price-list-price-creations"));
    await expect(Effect.runPromise(prepareRemovePriceListPricesWorkflow({ ...connected.options, pricing: { ...connected.options.pricing, module: other.workflow } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
  });

  it("recovers lost acknowledgement and refuses changed durable replay identity", async () => {
    const list = await seed("uncertain", [price()]), ids = [id(children(list, "prices")[0]!)], fixture = connected.fixture; let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price removal acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareRemovePriceListPricesWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
    } }));
    const changed = await Effect.runPromise(prepareRemovePriceListPricesWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices");
    try {
      const key = host.newRequestKey(); expect(await Effect.runPromise(host.run(key, { ids }))).toEqual(ids); expect(lose).toBe(false); expect(remove).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, { ids }))).toEqual(ids); expect(remove).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels genuine staged lifecycle work, fences late completion and permits a fresh committed retry", async () => {
    const list = await seed("cancel", [price()]), ids = [id(children(list, "prices")[0]!)];
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>(), original = PricingModuleService.prototype.softDeletePrices;
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
        await Effect.runPromise(Deferred.await(release)); return result; }
      finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), restore = vi.spyOn(PricingModuleService.prototype, "restorePrices");
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); yield* Fiber.interrupt(fiber); })));
      expect(remove).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      await Effect.runPromise(Deferred.succeed(release, undefined)); await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000)));
      expect(await connected.snapshot()).toEqual(before); remove.mockRestore();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toEqual(ids);
      expect((await connected.read(ids))[0]?.deleted_at).toEqual(expect.any(String));
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  });
});
