import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { Link } from "@medusajs/modules-sdk/link";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { workflowMethodDefinition } from "../src/workflow/module";
import { prepareStockLocationDeletionWorkflow } from "../src/workflows/stock-location/delete";
import { prepareLogicalStockLocationDeletion } from "./support/logical-stock-location-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStockLocationDeletion>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const facts = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const snapshot = async () => ({ rows: await rows(), facts: await facts(), commits: await commits(), events: await events() });
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}
const idsIn = (messages: Awaited<ReturnType<typeof events>>) => messages.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing lifecycle event identity");
  return Array.isArray(message.data.id) ? message.data.id : [message.data.id];
});
const deleted = "stock_location.stock-location.deleted", restored = "stock.stock-location.restored";
function linkEvent(kind: "softDeleteMethod" | "restoreMethod") {
  const method = connected.links.nativeServices.location[kind];
  const definition = method === undefined ? undefined : workflowMethodDefinition(method);
  const name = definition?.moduleEvents[0];
  if (name === undefined || definition?.moduleEvents.length !== 1) throw new Error("Missing authenticated Link event");
  return name;
}

describe("native Stock Location deletion on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalStockLocationDeletion(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains real empty module/Link calls and rejects malformed input before callbacks", async () => {
    const host = await connected.prepare(), stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await snapshot();
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }])
        // @ts-expect-error Deliberately invalid public boundary inputs.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(stock).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(stock).toHaveBeenCalledTimes(1); expect(stock.mock.calls[0]?.[0]).toEqual([]);
      expect(await stock.mock.results[0]?.value).toEqual({});
      expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: {} });
      expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
      expect((await commits()).length - before.commits.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull(); expect(await snapshot()).toEqual(committed);
      expect(stock).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { stock.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("deletes four Locations and eight pivots while retaining Addresses, Channels, stock, reservations and Store default", async () => {
    const graph = await connected.seed("stock-delete-maximum", 4, 2), first = graph.locations[0];
    if (first === undefined) throw new Error("Missing maximum seed");
    expect(await connected.seedProtectedInventory(first)).toMatchObject([{ location_id: first, quantity: 2 }]);
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64)), ids = [...graph.locations].reverse();
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations"), link = vi.spyOn(Link.prototype, "delete");
    const addresses = await connected.readAddresses(graph.locations.map(id => id + "-address")), channels = await connected.readChannels(graph.channels);
    const original = await connected.readLocations(graph.locations), pivots = await connected.readLinks(graph.locations);
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
      expect(await connected.readLocations(ids)).toEqual([]); expect(await connected.readLinks(ids)).toEqual([]);
      const actual = [...ids].sort();
      expect(await stock.mock.results[0]?.value).toEqual({ stock_location_id: actual, location_id: actual });
      expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: { stock_location_id: actual, location_id: actual } });
      const remaining = await connected.readLocations(ids, true), removedPivots = await connected.readLinks(ids, true);
      expect(remaining).toHaveLength(4); expect(removedPivots).toHaveLength(8);
      expect(remaining.map(row => row.id)).toEqual(ids);
      for (const row of original) expect(remaining.find(value => value.id === row.id))
        .toEqual({ ...row, deleted_at: expect.any(String), updated_at: expect.any(String) });
      expect(removedPivots.map(row => row.id).sort()).toEqual(pivots.map(row => row.id).sort());
      expect(removedPivots.every(row => typeof row.deleted_at === "string")).toBe(true);
      expect(await connected.readAddresses(graph.locations.map(id => id + "-address"))).toEqual(addresses);
      expect(await connected.readChannels(graph.channels)).toEqual(channels);
      const emitted = (await events()).slice(before.events.length), changedFacts = (await facts()).slice(before.facts.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...actual.map(() => deleted), linkEvent("softDeleteMethod")]);
      expect(idsIn(emitted.filter(event => event.envelope.contract === deleted))).toEqual(actual);
      expect(idsIn(emitted.filter(event => event.envelope.contract === linkEvent("softDeleteMethod"))).sort()).toEqual(pivots.map(row => row.id).sort());
      expect(emitted.every(event => event.envelope.internal)).toBe(true); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(changedFacts).toHaveLength(12); expect((await commits()).length - before.commits.length).toBe(1);
      // All other installed rows, including the seeded Inventory item, level,
      // reservation and Store default, retain their exact committed pointers.
      const changedRows = new Set(changedFacts.map(fact => `${fact.tableId}:${Buffer.from(fact.rowId).toString("hex")}`));
      const protectedRows = before.rows.filter(row => !changedRows.has(`${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      const current = await rows();
      expect(current).toHaveLength(before.rows.length);
      expect(current.filter(row => !changedRows.has(`${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`))).toEqual(protectedRows);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(stock).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ids: [...ids].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
    } finally { stock.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("uses actual membership and leaves new pivots on an already-deleted Location when it is requested again", async () => {
    const graph = await connected.seed("stock-delete-membership"), id = graph.locations[0];
    if (id === undefined) throw new Error("Missing membership seed");
    const host = await connected.prepare(), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: ["missing-native-location", id, id] }))).toBeNull();
      expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: { stock_location_id: [id], location_id: [id] } });
      expect((await facts()).length - before.facts.length).toBe(2);
      const other = await connected.seed("stock-delete-later-channel", 0, 1);
      await connected.attach(id, other.channels);
      expect(await connected.readLinks([id])).toHaveLength(1);
      const deletedState = await snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id, "missing-native-location"] }))).toBeNull();
      expect(link.mock.calls[1]?.[0]).toEqual({ stock_location: {} });
      expect(await connected.readLinks([id])).toHaveLength(1);
      expect(await rows()).toEqual(deletedState.rows); expect(await facts()).toEqual(deletedState.facts); expect(await events()).toEqual(deletedState.events);
      expect((await commits()).length - deletedState.commits.length).toBe(1);
    } finally { link.mockRestore(); }
  }, 120_000);

  it("keeps native Link errors as data but rolls back the root after a ninth-pivot refusal", async () => {
    const graph = await connected.seed("stock-delete-overflow", 1, 9), host = await connected.prepare();
    const original = Link.prototype.delete; let tuple: unknown;
    const native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args); tuple = result; return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      if (Result.isSuccess(result)) throw new Error("Ninth pivot was admitted");
      expect(failurePath(result.failure)).toContain("limitExceeded");
      expect(tuple).toEqual([expect.any(Array), expect.any(Object)]);
      expect(await snapshot()).toEqual(before);
      expect(await connected.readLocations(graph.locations)).toHaveLength(1); expect(await connected.readLinks(graph.locations)).toHaveLength(9);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("deletes the live pivot within eight identities while retaining nine already-deleted pivots", async () => {
    const graph = await connected.seed("stock-delete-history", 1, 9), id = graph.locations[0];
    if (id === undefined) throw new Error("Missing history Location");
    await connected.detach(id, graph.channels);
    const history = await connected.readLinks([id], true);
    expect(history).toHaveLength(9); expect(history.every(row => typeof row.deleted_at === "string")).toBe(true);
    const added = await connected.seed("stock-delete-history-live", 0, 1); await connected.attach(id, added.channels);
    const active = await connected.readLinks([id]); expect(active).toHaveLength(1);
    const host = await connected.prepare(undefined, 8), before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id] }))).toBeNull();
    expect(await connected.readLinks([id])).toEqual([]);
    const after = await connected.readLinks([id], true);
    expect(after).toHaveLength(10);
    for (const row of history) expect(after.find(value => value.id === row.id)).toEqual(row);
    expect((await facts()).length - before.facts.length).toBe(2);
    const emitted = (await events()).slice(before.events.length);
    expect(emitted.map(event => event.envelope.contract)).toEqual([deleted, linkEvent("softDeleteMethod")]);
    expect(idsIn(emitted)).toEqual([id, active[0]?.id]);
  }, 180_000);

  it("rolls back after late Link failure and after malformed complete native alias results", async () => {
    const graph = await connected.seed("stock-delete-late", 2), host = await connected.prepare();
    const original = Link.prototype.delete; let completed = false;
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); completed = true; throw new Error("Late native Stock Location Link failure");
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      if (Result.isSuccess(result)) throw new Error("Late Link failure committed");
      expect(completed).toBe(true); expect(failurePath(result.failure)).toContain("Late native Stock Location Link failure");
      expect(await snapshot()).toEqual(before);
    } finally { link.mockRestore(); }
    const originalStock = StockLocationModuleService.prototype.softDeleteStockLocations;
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(originalStock, this, args); return { ...result, location_id: ["invented-native-alias"] };
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { stock.mockRestore(); }
  }, 120_000);

  it("poisons caught sibling mutations and revokes a captured native callback after completion", async () => {
    const graph = await connected.seed("stock-delete-poison"), host = await connected.prepare();
    const original = StockLocationModuleService.prototype.softDeleteStockLocations;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      escaped = () => Reflect.apply(original, this, args);
      try { await this.deleteStockLocations(graph.locations); } catch { caught = true; }
      return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      expect(caught).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native callback was not captured");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { stock.mockRestore(); }
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: graph.locations }))).toBeNull();
  }, 120_000);

  it("executes native retained compensators, including active restore events and truthy empty Link maps", async () => {
    const graph = await connected.seed("stock-delete-restore", 2), host = await connected.prepare(), restore = await connected.prepareRestore();
    const addresses = await connected.readAddresses(graph.locations.map(id => id + "-address"));
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: graph.locations }))).toBeNull();
    const stock = vi.spyOn(StockLocationModuleService.prototype, "restoreStockLocations"), link = vi.spyOn(Link.prototype, "restore");
    try {
      for (const alreadyActive of [false, true]) {
        const before = await snapshot();
        expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: graph.locations }))).toBeNull();
        expect(await connected.readLocations(graph.locations)).toHaveLength(2); expect(await connected.readLinks(graph.locations)).toHaveLength(2);
        expect(await connected.readAddresses(graph.locations.map(id => id + "-address"))).toEqual(addresses);
        const emitted = (await events()).slice(before.events.length);
        expect(emitted.map(event => event.envelope.contract)).toEqual([restored, restored, linkEvent("restoreMethod")]);
        expect(emitted.every(event => event.envelope.internal)).toBe(true);
        expect((await facts()).length - before.facts.length).toBe(alreadyActive ? 0 : 4);
      }
      stock.mockClear(); link.mockClear(); const before = await snapshot();
      expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: [] }))).toBeNull();
      expect(stock).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: {} });
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
    } finally { stock.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("rolls back native work on cancellation and refuses the revoked continuation", async () => {
    const graph = await connected.seed("stock-delete-cancel"), host = await connected.prepare(), reached = await Effect.runPromise(Deferred.make<void>());
    const original = StockLocationModuleService.prototype.softDeleteStockLocations;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.locations }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing revoked native continuation");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); stock.mockRestore(); }
  }, 120_000);

  it("refuses mismatched module identities before preparing the native root", async () => {
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(prepareStockLocationDeletionWorkflow({ ...connected.options,
      modules: { ...connected.options.modules,
        // @ts-expect-error Deliberately forge a structurally wrong installed module at the runtime authority boundary.
        stock_location: { ...connected.options.modules.stock_location, module: connected.links.location.workflow } },
    })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await snapshot()).toEqual(before);
  });

  it("isolates identical Locations, Links and request keys across two genuine scopes", async () => {
    const other = await prepareLogicalStockLocationDeletion(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "stock_location_delete_shop_b", projectId: "stock_location_delete_shop_b", uuidOffset: 190_000 } });
    const first = await connected.seed("stock-delete-scope"), second = await other.seed("stock-delete-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    expect(second).toEqual(first);
    expect(await Effect.runPromise(left.run(key, { ids: first.locations }))).toBeNull();
    expect(await other.readLocations(second.locations)).toHaveLength(1); expect(await other.readLinks(second.locations)).toHaveLength(1);
    expect(await Effect.runPromise(right.run(key, { ids: second.locations }))).toBeNull();
    expect(await connected.readLocations(first.locations)).toEqual([]); expect(await other.readLocations(second.locations)).toEqual([]);
    const committed = await snapshot();
    expect(await Effect.runPromise(left.run(key, { ids: first.locations }))).toBeNull();
    expect(await Effect.runPromise(right.run(key, { ids: second.locations }))).toBeNull(); expect(await snapshot()).toEqual(committed);
  }, 240_000);
});
