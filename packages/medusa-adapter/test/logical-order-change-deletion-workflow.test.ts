import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { OrderModuleService } from "@medusajs/order/services";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareOrderChangeDeletionWorkflow } from "../src/workflows/order/delete-order-change";
import { prepareLogicalOrderChangeDeletion, orderChangeDeletionGraph, orderChangeDeletionStamp } from "./support/logical-order-change-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalOrderChangeDeletion>>, sharedCleanupCount = 0;
const graph = {
  maximum: orderChangeDeletionGraph("change-delete-maximum", 4, 2),
  membership: orderChangeDeletionGraph("change-delete-membership"),
  history: orderChangeDeletionGraph("change-delete-history", 2, 2, { actions: 1 }),
  historicalRoots: orderChangeDeletionGraph("change-delete-historical-roots", 1, 2, { changes: true, actions: 1 }),
  historicalParent: orderChangeDeletionGraph("change-delete-historical-parent", 1, 2, { orders: true, actions: 1 }),
  restoreHistoricalParent: orderChangeDeletionGraph("change-delete-restore-historical-parent", 1, 2, { orders: true, changes: true, actions: 2 }),
  restoreMembership: orderChangeDeletionGraph("change-delete-restore-membership", 1, 2, { changes: true, actions: 2 }),
  overflow: orderChangeDeletionGraph("change-delete-overflow", 1, 9, { actions: 8 }),
  restore: orderChangeDeletionGraph("change-delete-restore", 4, 2, { actions: 1 }),
  roundtrip: orderChangeDeletionGraph("change-delete-roundtrip", 1, 2, { actions: 1 }),
  late: orderChangeDeletionGraph("change-delete-late", 2, 2, { actions: 1 }),
  denied: orderChangeDeletionGraph("change-delete-denied"),
  scope: orderChangeDeletionGraph("change-delete-scope"),
  neighbor: orderChangeDeletionGraph("change-delete-neighbor"),
  corrupt: orderChangeDeletionGraph("change-delete-corrupt"),
};
type Graph = ReturnType<typeof orderChangeDeletionGraph>;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
const identities = (value: Graph) => [...value.changes, ...value.actions];
const allIdentities = (value: Graph) => [...value.orders, ...identities(value)];
const sorted = (values: readonly string[]) => [...values].sort();
const withoutManaged = (row: JsonObject) => { const { updated_at: _updated, deleted_at: _deleted, ...rest } = row; return rest; };
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function eventsSince(before: Inventory, after: Inventory) {
  return after.events.filter(event => !before.events.some(prior => prior.scopeUuid === event.scopeUuid &&
    prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
}
function expectEvents(events: Inventory["events"], selected: Graph, action: "deleted" | "restored") {
  expect(events).toHaveLength(identities(selected).length);
  for (const [object, ids] of [["order_change", selected.changes], ["order_change_action", selected.actions]] as const) {
    const family = events.filter(event => event.envelope.contract === `order.${object.replaceAll("_", "-")}.${action}`);
    expect(family).toHaveLength(ids.length);
    const actual = family.map(event => {
      const message = event.envelope.message;
      if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data) || typeof message.data.id !== "string")
        throw new Error("Missing native Order Change deletion event identity");
      expect(message.metadata).toMatchObject({ source: "order", object, action });
      expect(event.envelope.internal).toBe(true); return message.data.id;
    });
    expect(sorted(actual)).toEqual(sorted(ids));
  }
  expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
}
function expectOnlyManagedFields(before: readonly JsonObject[], after: readonly JsonObject[], deleted: boolean) {
  expect(after).toHaveLength(before.length);
  for (const row of before) {
    const current = after.find(value => value.id === row.id);
    if (current === undefined) throw new Error("Missing existing native lifecycle row");
    expect(withoutManaged(current)).toEqual(withoutManaged(row));
    expect(current.updated_at).toEqual(expect.any(String));
    expect(current.deleted_at).toEqual(deleted ? expect.any(String) : null);
  }
}

describe(`genuine native Delete Order Change workflow - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    const rows = Object.values(graph).flatMap(value => value.rows);
    const ordered = ["order", "order_change", "order_change_action"].flatMap(table => rows.filter(value => value.table === table));
    connected = await prepareLogicalOrderChangeDeletion(driver, close => cleanup.push(close), ordered); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
    await connected?.closeCaseHosts();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains the genuine empty native call and durably replays its void root as null", async () => {
    const host = await connected.prepare(), native = vi.spyOn(OrderModuleService.prototype, "softDeleteOrderChanges"),
      before = await connected.snapshot(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
    expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual([]);
    expect(await native.mock.results[0]?.value).toEqual({});
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
    expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
    expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
    expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
  }, 120_000);

  it("cascades four Changes and eight Actions through the actual native module, preserves whole business rows, parents and neighbors", async () => {
    const selected = graph.maximum, ids = [...selected.changes].reverse(), request = { ids }, owned = structuredClone(request),
      beforeRows = await connected.read(identities(selected)), beforeParents = await connected.read(selected.orders),
      beforeNeighbor = await connected.read(allIdentities(graph.neighbor)), before = await connected.snapshot(),
      native = vi.spyOn(OrderModuleService.prototype, "softDeleteOrderChanges"), host = await connected.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, request))).toBeNull(); expect(request).toEqual(owned);
    expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual(ids);
    expect(await native.mock.results[0]?.value).toEqual({ order_change_id: selected.changes, OrderChangeAction: await connected.read(selected.actions) });
    expectOnlyManagedFields(beforeRows, await connected.read(identities(selected)), true);
    expect(await connected.read(selected.orders)).toEqual(beforeParents);
    expect(await connected.read(allIdentities(graph.neighbor))).toEqual(beforeNeighbor);
    const after = await connected.snapshot(); expect(after.rows).toHaveLength(before.rows.length);
    expect(after.revisions).toHaveLength(before.revisions.length + 12); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 12);
    expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expectEvents(eventsSince(before, after), selected, "deleted");
    expect(await Effect.runPromise(host.run(key, request))).toBeNull(); expect(native).toHaveBeenCalledTimes(1);
    expect(await connected.snapshot()).toEqual(after);
    await expect(Effect.runPromise(host.run(key, { ids: [...ids].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("keeps raw missing, duplicate and empty IDs in the genuine step preimage while the native map uses actual live members", async () => {
    const selected = graph.membership, id = selected.changes[0];
    if (id === undefined) throw new Error("Missing membership Change");
    const host = await connected.prepareForward(), ids = ["", id, "missing-order-change", id], owned = [...ids],
      native = vi.spyOn(OrderModuleService.prototype, "softDeleteOrderChanges"), before = await connected.snapshot(),
      result = await Effect.runPromise(host.run(host.newRequestKey(), { ids }));
    expect(result).toEqual({ output: { order_change_id: [id], OrderChangeAction: await connected.read(selected.actions) }, retainedIds: ids });
    expect(ids).toEqual(owned); expect(native.mock.calls[0]?.[0]).toEqual(ids);
    const after = await connected.snapshot(); expectEvents(eventsSince(before, after), selected, "deleted");
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
    const repeated = await Effect.runPromise(host.run(host.newRequestKey(), { ids }));
    expect(repeated).toEqual({ output: {}, retainedIds: ids });
    const again = await connected.snapshot();
    expect(again.rows).toEqual(after.rows); expect(again.rowChanges).toEqual(after.rowChanges); expect(again.events).toEqual(after.events);
  }, 120_000);

  it("rewrites complete historical Action descendants and emits their native delete events", async () => {
    const selected = graph.history, beforeRows = await connected.read(identities(selected)), parents = await connected.read(selected.orders),
      host = await connected.prepare(), before = await connected.snapshot();
    expect(beforeRows.filter(row => row.deleted_at === orderChangeDeletionStamp)).toHaveLength(2);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: selected.changes }))).toBeNull();
    const afterRows = await connected.read(identities(selected)), after = await connected.snapshot();
    expectOnlyManagedFields(beforeRows, afterRows, true);
    expect(afterRows.every(row => row.deleted_at !== orderChangeDeletionStamp)).toBe(true);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 6); expectEvents(eventsSince(before, after), selected, "deleted");
    expect(await connected.read(selected.orders)).toEqual(parents);
  }, 120_000);

  it("excludes historical roots from soft deletion and therefore leaves their Actions untouched", async () => {
    const selected = graph.historicalRoots, beforeRows = await connected.read(allIdentities(selected)), before = await connected.snapshot(),
      forward = await connected.prepareForward(), ids = [...selected.changes, "missing-order-change"];
    expect(await Effect.runPromise(forward.run(forward.newRequestKey(), { ids }))).toEqual({ output: {}, retainedIds: ids });
    expect(await connected.read(allIdentities(selected))).toEqual(beforeRows);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
    expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
  }, 120_000);

  it("refuses a ninth historical Action before any root or child transition", async () => {
    const selected = graph.overflow, host = await connected.prepare(), before = await connected.snapshot(),
      failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: selected.changes }));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toContain("limitExceeded");
    expect(await connected.snapshot()).toEqual(before);
    const rows = await connected.read(identities(selected)); expect(rows).toHaveLength(10);
    expect(rows.filter(row => row.deleted_at === orderChangeDeletionStamp)).toHaveLength(8);
  }, 120_000);

  it("excludes live Changes beneath historical Orders from native forward deletion", async () => {
    const selected = graph.historicalParent, beforeRows = await connected.read(allIdentities(selected)), before = await connected.snapshot(),
      forward = await connected.prepareForward();
    expect(await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: selected.changes })))
      .toEqual({ output: {}, retainedIds: selected.changes });
    expect(await connected.read(allIdentities(selected))).toEqual(beforeRows);
    const after = await connected.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
    expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
  }, 120_000);

  it("restores selected historical Changes and Actions beneath historical Orders while retaining the parent history", async () => {
    const selected = graph.restoreHistoricalParent, beforeRows = await connected.read(identities(selected)),
      beforeParents = await connected.read(selected.orders), before = await connected.snapshot(), restore = await connected.prepareRestore();
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: selected.changes }))).toBeNull();
    expectOnlyManagedFields(beforeRows, await connected.read(identities(selected)), false);
    expect(await connected.read(selected.orders)).toEqual(beforeParents);
    const after = await connected.snapshot(); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
    expectEvents(eventsSince(before, after), selected, "restored");
  }, 120_000);

  it("runs the genuine retained inverse, clearing historical Action deletion state while preserving every business field", async () => {
    const selected = graph.restore, beforeRows = await connected.read(identities(selected)), parents = await connected.read(selected.orders),
      host = await connected.prepare(), restore = await connected.prepareRestore(), ids = [...selected.changes].reverse();
    expect(beforeRows.filter(row => row.deleted_at === orderChangeDeletionStamp)).toHaveLength(4);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
    const native = vi.spyOn(OrderModuleService.prototype, "restoreOrderChanges"), before = await connected.snapshot();
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids }))).toBeNull();
    expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual(ids);
    expect(await native.mock.results[0]?.value).toEqual({ order_change_id: selected.changes, OrderChangeAction: await connected.read(selected.actions) });
    const afterRows = await connected.read(identities(selected)), after = await connected.snapshot();
    expectOnlyManagedFields(beforeRows, afterRows, false);
    expect(afterRows.every(row => row.deleted_at === null)).toBe(true);
    expect(await connected.read(selected.orders)).toEqual(parents);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 12); expectEvents(eventsSince(before, after), selected, "restored");
    const repeatBefore = await connected.snapshot();
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids }))).toBeNull();
    const repeated = await connected.snapshot();
    expect(await connected.read(identities(selected))).toEqual(afterRows);
    expect(repeated.rowChanges).toEqual(repeatBefore.rowChanges); expect(repeated.revisions).toEqual(repeatBefore.revisions);
    expectEvents(eventsSince(repeatBefore, repeated), selected, "restored");
  }, 240_000);

  it("retains the inverse's truthy empty array dispatch without creating row transitions or events", async () => {
    const restore = await connected.prepareRestore(), native = vi.spyOn(OrderModuleService.prototype, "restoreOrderChanges"),
      before = await connected.snapshot();
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: [] }))).toBeNull();
    expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual([]); expect(await native.mock.results[0]?.value).toEqual({});
    const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
    expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
  }, 120_000);

  it("forwards raw duplicate, missing and empty inverse IDs without recreating absent Changes", async () => {
    const selected = graph.restoreMembership, id = selected.changes[0];
    if (id === undefined) throw new Error("Missing retained inverse Change");
    const ids = ["", id, "missing-inverse-change", id], owned = [...ids], beforeRows = await connected.read(identities(selected)),
      before = await connected.snapshot(), restore = await connected.prepareRestore(), native = vi.spyOn(OrderModuleService.prototype, "restoreOrderChanges");
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids }))).toBeNull();
    expect(ids).toEqual(owned); expect(native.mock.calls[0]?.[0]).toEqual(ids);
    expect(await native.mock.results[0]?.value).toEqual({ order_change_id: selected.changes, OrderChangeAction: await connected.read(selected.actions) });
    expectOnlyManagedFields(beforeRows, await connected.read(identities(selected)), false);
    const after = await connected.snapshot(); expect(after.rows).toHaveLength(before.rows.length);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3); expectEvents(eventsSince(before, after), selected, "restored");
    expect(await connected.read(["", "missing-inverse-change"])).toEqual([]);
  }, 120_000);

  it("executes real forward and retained inverse in one root and preserves native historical-child restoration behavior", async () => {
    const selected = graph.roundtrip, beforeRows = await connected.read(identities(selected)), before = await connected.snapshot(),
      forward = await connected.prepareForward(true), result = await Effect.runPromise(forward.run(forward.newRequestKey(), { ids: selected.changes }));
    const deletedActions = selected.actions.map(id => {
      const row = beforeRows.find(value => value.id === id);
      if (row === undefined) throw new Error("Missing complete native Action preimage");
      return { ...row, updated_at: expect.any(String), deleted_at: expect.any(String) };
    });
    expect(result).toEqual({ output: { order_change_id: selected.changes, OrderChangeAction: deletedActions }, retainedIds: selected.changes });
    expectOnlyManagedFields(beforeRows, await connected.read(identities(selected)), false);
    const after = await connected.snapshot(), emitted = eventsSince(before, after);
    expectEvents(emitted.filter(event => event.envelope.contract.endsWith(".deleted")), selected, "deleted");
    expectEvents(emitted.filter(event => event.envelope.contract.endsWith(".restored")), selected, "restored");
    expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
  }, 120_000);

  it("rolls back the complete historical cascade, indexes, facts, events and outcomes after late parent failure", async () => {
    const host = await connected.prepareLateFailure(), native = vi.spyOn(OrderModuleService.prototype, "softDeleteOrderChanges"),
      before = await connected.snapshot(), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: graph.late.changes }));
    expect(native).toHaveBeenCalledTimes(1); expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(failed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === connected.lateFailure)).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 120_000);

  it("refuses malformed, oversized and extra-field root input before native execution", async () => {
    const host = await connected.prepare(), native = vi.spyOn(OrderModuleService.prototype, "softDeleteOrderChanges"), before = await connected.snapshot();
    for (const input of [{}, { ids: "scalar" }, { ids: [null] }, { ids: [17] }, { ids: ["x".repeat(257)] },
      { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }, [], { id: graph.neighbor.changes[0] }])
      expect(Exit.isFailure(await Effect.runPromiseExit(Reflect.apply(host.run, host, [host.newRequestKey(), input]))), JSON.stringify(input)).toBe(true);
    expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
  }, 120_000);

  it("keeps a caught foreign-module refusal sticky and rejects an escaped resource method after settlement", async () => {
    const host = await connected.prepareDeniedSibling(), before = await connected.snapshot(),
      failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { ids: graph.denied.changes }));
    expect(Exit.isFailure(failed)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    await expect(connected.callEscaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
  }, 120_000);

  it("confines identical Order, Change and Action identities and a shared request key to independent project scopes", async () => {
    const peer = await prepareLogicalOrderChangeDeletion(driver, close => cleanup.push(close), graph.scope.rows, {
      resource: connected.fixture.resource, fixtureIdentity: { deploymentId: "order-change-deletion-peer", projectId: "order-change-deletion-peer", uuidOffset: 29_000_000 },
    }), host = await connected.prepare(), other = await peer.prepare(), key = host.newRequestKey(),
      peerBefore = await peer.read(allIdentities(graph.scope));
    expect(await Effect.runPromise(host.run(key, { ids: graph.scope.changes }))).toBeNull();
    expect(await peer.read(allIdentities(graph.scope))).toEqual(peerBefore);
    expect(await Effect.runPromise(other.run(key, { ids: graph.scope.changes }))).toBeNull();
    expectOnlyManagedFields(peerBefore.filter(row => identities(graph.scope).includes(String(row.id))), await peer.read(identities(graph.scope)), true);
    const beforeReplay = await peer.snapshot(); expect(await Effect.runPromise(other.run(key, { ids: graph.scope.changes }))).toBeNull();
    expect(await peer.snapshot()).toEqual(beforeReplay);
  }, 240_000);

  it("refuses corrupted durable void replay without invoking the native module again", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), request = { ids: graph.corrupt.changes },
      native = vi.spyOn(OrderModuleService.prototype, "softDeleteOrderChanges");
    expect(await Effect.runPromise(host.run(key, request))).toBeNull();
    for (const damaged of [{ forged: true }, [], "undefined"]) await connected.withStoredOrderResult(key, damaged, async () => {
      const before = await connected.snapshot(), failed = await Effect.runPromiseExit(host.run(key, request));
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toContain("storedCorruption");
      expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    });
    expect(await Effect.runPromise(host.run(key, request))).toBeNull(); expect(native).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("refuses unadmitted workflow options before executing a native operation", async () => {
    const before = await connected.snapshot();
    for (const extra of [{ hooks: {} }, { logicalResources: {} }])
      expect(Exit.isFailure(await Effect.runPromiseExit(prepareOrderChangeDeletionWorkflow({ ...connected.options, ...extra })))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 120_000);
});
