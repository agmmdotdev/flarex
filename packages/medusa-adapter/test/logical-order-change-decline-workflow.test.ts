import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { OrderModuleService } from "@medusajs/order/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareOrderChangeDeclineWorkflow } from "../src/workflows/order/decline-order-change";
import { prepareLogicalOrderChangeDecline, orderChangeDeclineIds, orderChangeDeclineRows,
  orderChangeDeclineStamp, type OrderInitialRow } from "./support/logical-order-change-decline-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalOrderChangeDecline>>, sharedCleanupCount = 0, ordinal = 0;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
const withoutUpdated = (row: JsonObject) => { const { updated_at: _updated, ...rest } = row; return rest; };
const unaffectedIds = () => orderChangeDeclineRows().filter(value => value.table !== "order_change").map(value => String(value.row.id));
function expectDeclinedRow(before: JsonObject, after: JsonObject, patch: { declined_by?: string; metadata?: Json } = {}) {
  expect(after.declined_at).toEqual(expect.any(String));
  if (typeof after.declined_at !== "string") throw new Error("Missing native declined_at");
  expect(new Date(after.declined_at).toISOString()).toBe(after.declined_at);
  expect(after.declined_at).not.toBe(before.declined_at);
  expect(after.updated_at).toEqual(expect.any(String)); expect(after.updated_at).not.toBe(before.updated_at);
  expect(after).toEqual({ ...before, ...patch, status: "declined", declined_at: after.declined_at, updated_at: after.updated_at });
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function expectNativeRefusal(exit: Exit.Exit<unknown, CommerceTransactionError>, type: string, message: string) {
  if (Exit.isSuccess(exit)) throw new Error("Expected genuine native Medusa refusal");
  const native = exit.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.reason === "adapterFailure");
  if (native === undefined || !Cause.isFailReason(native)) throw new Error("Missing typed native adapterFailure");
  expect(MedusaError.isMedusaError(native.error.cause)).toBe(true);
  expect(native.error.cause).toMatchObject({ type, message: expect.stringContaining(message) });
  expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(false);
}
function eventsSince(before: Inventory, after: Inventory) {
  return after.events.filter(event => !before.events.some(prior => prior.scopeUuid === event.scopeUuid &&
    prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
}
function eventVector(events: Inventory["events"]) {
  return events.map(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data) || typeof message.data.id !== "string")
      throw new Error("Missing native Order Change decline module event");
    expect(message.metadata).toMatchObject({ source: "order", object: "order_change", action: "updated" });
    return [event.envelope.contract, message.data.id];
  });
}
async function scenario(name: string, rows: readonly OrderInitialRow[] = orderChangeDeclineRows()) {
  const number = ++ordinal;
  return prepareLogicalOrderChangeDecline(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `order-change-decline-${name}-${number}`, projectId: "order-change-decline", uuidOffset: 20_000_000 + number * 10_000 } });
}
async function selected(local: Local, id: string = orderChangeDeclineIds[0]) {
  const row = (await local.readChanges()).find(value => value.id === id);
  if (row === undefined) throw new Error("Missing seeded existing Order Change");
  return row;
}
const retainedFields = ["id", "status", "declined_at", "declined_by"] as const;
const retainedFrom = (row: JsonObject, metadata: boolean) => ({ ...Object.fromEntries(retainedFields.map(key => [key, row[key]])),
  ...(metadata ? { metadata: row.metadata } : {}) });

describe(`genuine native Order Change decline workflow - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalOrderChangeDecline(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => {
    vi.restoreAllMocks(); for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("declines one pending Change, preserves all other tables and inputs, and replays the void root once", async () => {
    const local = await scenario("root"), id = orderChangeDeclineIds[0], request = { id, declined_by: "native-actor" },
      owned = structuredClone(request), beforeRows = await local.readChanges(), beforeOther = await local.read(unaffectedIds()), before = await local.snapshot(),
      retrieve = vi.spyOn(OrderModuleService.prototype, "retrieveOrderChange"), decline = vi.spyOn(OrderModuleService.prototype, "declineOrderChange"),
      host = await local.prepare(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, request))).toBeNull();
    const afterRows = await local.readChanges(), changed = afterRows.find(row => row.id === id), after = await local.snapshot();
    const prior = beforeRows.find(row => row.id === id);
    if (changed === undefined || prior === undefined) throw new Error("Missing native decline transition");
    expect(request).toEqual(owned); expectDeclinedRow(prior, changed, { declined_by: request.declined_by });
    const actionIds = orderChangeDeclineRows().filter(value => value.table === "order_change_action").map(value => value.row.id);
    expect(actionIds).toHaveLength(4);
    expect(beforeOther.filter(row => actionIds.includes(row.id))).toHaveLength(actionIds.length);
    expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
    expect(await local.read(unaffectedIds())).toEqual(beforeOther); expect(after.rows).toHaveLength(before.rows.length);
    const additions = after.revisions.filter(row => !before.revisions.some(prior => prior.scopeUuid === row.scopeUuid &&
      prior.tableId === row.tableId && prior.commitSeq === row.commitSeq && Buffer.from(prior.rowId).equals(Buffer.from(row.rowId))));
    expect(additions).toHaveLength(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
    expect(eventVector(eventsSince(before, after))).toEqual([["order.order-change.updated", id]]);
    expect(retrieve).toHaveBeenCalledTimes(1); expect(decline).toHaveBeenCalledTimes(1);
    expect(await Effect.runPromise(host.run(key, request))).toBeNull();
    expect(retrieve).toHaveBeenCalledTimes(1); expect(decline).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(after);
    await expect(Effect.runPromise(host.run(key, { id, declined_by: "conflicting-actor" }))).rejects.toMatchObject({ reason: "requestConflict" });
  }, 240_000);

  it("retains and restores requested status and pre-existing decline scalars through the genuine inverse", async () => {
    const id = orderChangeDeclineIds[2], rows = orderChangeDeclineRows().map(value => value.table === "order_change" && value.row.id === id
      ? { ...value, row: { ...value.row, status: "requested" } } : value), local = await scenario("requested", rows),
      beforeRows = await local.readChanges(), prior = await selected(local, id),
      beforeOther = await local.read(unaffectedIds()), forward = await local.prepareForward(),
      result = await Effect.runPromise(forward.run(forward.newRequestKey(), { id, declined_by: "" }));
    expect(result.preimage).toEqual(retainedFrom(prior, false));
    expect(prior.declined_by).toBe("original-decliner"); expect(prior.declined_at).toBe(orderChangeDeclineStamp);
    expect(prior.declined_reason).toBe("original-reason-" + id);
    expectDeclinedRow(prior, await selected(local, id), { declined_by: "" });
    const inverse = await local.prepareInverse(), owned = structuredClone(result.preimage);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimage))).toBeNull();
    expect(result.preimage).toEqual(owned); expect((await local.readChanges()).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
    expect(await local.read(unaffectedIds())).toEqual(beforeOther);
  }, 240_000);

  it.each([
    { name: "merge", patch: { added: "new", ordinal: 17, nested: { replacement: true }, literal_empty: "" },
      expected: { ordinal: 17, nested: { replacement: true }, added: "new" } },
    { name: "null", patch: null, expected: null },
    { name: "empty", patch: {}, expected: {} },
    { name: "null-value", patch: { retained_null: null },
      expected: { ordinal: 0, nested: { unchanged: orderChangeDeclineIds[0] }, literal_empty: "", retained_null: null } },
  ])("preserves native forward metadata $name and exactly restores the detached retained JSON including literal empty strings", async ({ name, patch, expected }) => {
    const local = await scenario("metadata-" + name), id = orderChangeDeclineIds[0], prior = await selected(local),
      beforeOther = await local.read(unaffectedIds()), forward = await local.prepareForward(), request = { id, metadata: patch }, owned = structuredClone(request),
      result = await Effect.runPromise(forward.run(forward.newRequestKey(), request));
    expect(request).toEqual(owned); expect(result.preimage).toEqual(retainedFrom(prior, true));
    expectDeclinedRow(prior, await selected(local), { metadata: expected });
    const retained = structuredClone(result.preimage), inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimage));
    expect(result.preimage).toEqual(retained); expect(withoutUpdated(await selected(local))).toEqual(withoutUpdated(prior));
    const beforeRepeat = await local.snapshot(), beforeRepeatRow = await selected(local);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimage));
    expect(result.preimage).toEqual(retained); expect(withoutUpdated(await selected(local))).toEqual(withoutUpdated(prior));
    const repeated = await local.snapshot();
    expect(repeated.revisions.length - beforeRepeat.revisions.length).toBe(1);
    expect((await selected(local)).updated_at).not.toBe(beforeRepeatRow.updated_at);
    expect(eventVector(eventsSince(beforeRepeat, repeated))).toEqual([["order.order-change.updated", id]]);
    expect(await local.read(unaffectedIds())).toEqual(beforeOther);
  }, 240_000);

  it("executes genuine forward and exact inverse in one borrowed root without changing Actions or other Change fields", async () => {
    const local = await scenario("roundtrip"), beforeRows = await local.readChanges(), beforeOther = await local.read(unaffectedIds()),
      forward = await local.prepareForward(true), before = await local.snapshot();
    await Effect.runPromise(forward.run(forward.newRequestKey(), { id: orderChangeDeclineIds[0], metadata: { temporary: { key: "value" } } }));
    expect((await local.readChanges()).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
    expect(await local.read(unaffectedIds())).toEqual(beforeOther);
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([
      ["order.order-change.updated", orderChangeDeclineIds[0]], ["order.order-change.updated", orderChangeDeclineIds[0]],
    ]);
  }, 240_000);

  it("restores prior null metadata exactly rather than replacing it with an empty object", async () => {
    const rows = orderChangeDeclineRows().map(value => value.table === "order_change" && value.row.id === orderChangeDeclineIds[0]
      ? { ...value, row: { ...value.row, metadata: null } } : value), local = await scenario("prior-null", rows), prior = await selected(local),
      forward = await local.prepareForward(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), { id: orderChangeDeclineIds[0], metadata: { new: true } })),
      inverse = await local.prepareInverse();
    expect(result.preimage.metadata).toBeNull(); expectDeclinedRow(prior, await selected(local), { metadata: { new: true } });
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimage));
    expect(withoutUpdated(await selected(local))).toEqual(withoutUpdated(prior));
  }, 240_000);

  it("refuses native terminal and null statuses without changing rows, history, events or outcomes", async () => {
    const terminal = ["confirmed", "declined", "canceled", null], rows = orderChangeDeclineRows().map(value => {
      const index = orderChangeDeclineIds.findIndex(id => id === value.row.id);
      return value.table === "order_change" && index >= 0 ? { ...value, row: { ...value.row, status: terminal[index]! } } : value;
    }), local = await scenario("terminal", rows), host = await local.prepare();
    for (const id of orderChangeDeclineIds) {
      const before = await local.snapshot(), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id }));
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("Order Change cannot be modified");
      expectNativeRefusal(failed, MedusaError.Types.INVALID_DATA, `Order Change cannot be modified: ${id}.`);
      expect(await local.snapshot()).toEqual(before);
    }
  }, 240_000);

  it("refuses missing and historical Changes through the native service without persisting failed outcomes", async () => {
    const rows = orderChangeDeclineRows().map(value => value.table === "order_change" && value.row.id === orderChangeDeclineIds[0]
      ? { ...value, row: { ...value.row, deleted_at: orderChangeDeclineStamp } } : value), local = await scenario("missing", rows), host = await local.prepare();
    for (const id of ["ordch-missing", orderChangeDeclineIds[0]]) {
      const before = await local.snapshot(), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id }));
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain(id);
      expectNativeRefusal(failed, MedusaError.Types.NOT_FOUND, id);
      expect(await local.snapshot()).toEqual(before);
    }
  }, 240_000);

  it("exposes selected Change preimages and native guards but refuses full lookup beneath a historical Order", async () => {
    const id = orderChangeDeclineIds[0], rows = orderChangeDeclineRows(), change = rows.find(value => value.table === "order_change" && value.row.id === id);
    if (change === undefined || typeof change.row.order_id !== "string") throw new Error("Missing existing Change parent");
    const historical = rows.map(value => value.table === "order" && value.row.id === change.row.order_id
      ? { ...value, row: { ...value.row, deleted_at: orderChangeDeclineStamp } } : value),
      local = await scenario("historical-parent", historical), host = await local.prepare(), before = await local.snapshot(),
      retrieve = vi.spyOn(OrderModuleService.prototype, "retrieveOrderChange"), list = vi.spyOn(OrderModuleService.prototype, "listOrderChanges"),
      decline = vi.spyOn(OrderModuleService.prototype, "declineOrderChange"),
      failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id, metadata: { must_not_persist: true } }));
    expect(Exit.isFailure(failed)).toBe(true); expect(retrieve).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(1); expect(decline).toHaveBeenCalledTimes(1);
    expect(await retrieve.mock.results[0]?.value).toMatchObject({ id, status: "pending" });
    expect(await list.mock.results[0]?.value).toMatchObject([{ id, status: "pending" }]);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toContain(`OrderChange with id "${id}" not found`);
    expectNativeRefusal(failed, MedusaError.Types.NOT_FOUND, `OrderChange with id "${id}" not found`);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
  it("never recreates a missing Change while applying a genuine retained inverse", async () => {
    const local = await scenario("inverse-missing"), forward = await local.prepareForward(),
      result = await Effect.runPromise(forward.run(forward.newRequestKey(), { id: orderChangeDeclineIds[0], metadata: { temporary: true } })),
      inverse = await local.prepareInverse(), before = await local.snapshot(),
      failed = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), { ...result.preimage, id: "ordch-inverse-missing" }));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("ordch-inverse-missing");
    expectNativeRefusal(failed, MedusaError.Types.NOT_FOUND, "ordch-inverse-missing");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
  it("rolls back rows, indexes, facts, events and outcomes after a late native parent failure", async () => {
    const local = await scenario("late-parent"), host = await local.prepareLateFailure(), before = await local.snapshot(),
      decline = vi.spyOn(OrderModuleService.prototype, "declineOrderChange"), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(),
        { id: orderChangeDeclineIds[0], declined_by: "rollback-actor", metadata: { must_rollback: true } }));
    expect(Exit.isFailure(failed)).toBe(true); expect(decline).toHaveBeenCalledTimes(1);
    if (Exit.isFailure(failed)) {
      expect(reasons(failed.cause).join("\n")).toContain(local.lateFailure.message);
      expect(failed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === local.lateFailure)).toBe(true);
      expect(failed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "adapterFailure" &&
        reason.error.cause === local.lateFailure)).toBe(false);
    }
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rejects unsupported fields and plural input before any native execution", async () => {
    const local = await scenario("unsupported"), host = await local.prepare(), before = await local.snapshot(),
      retrieve = vi.spyOn(OrderModuleService.prototype, "retrieveOrderChange"), decline = vi.spyOn(OrderModuleService.prototype, "declineOrderChange");
    for (const extra of [{ status: "declined" }, { declined_at: orderChangeDeclineStamp }, { declined_by: null }, { metadata: [] },
      { declined_reason: "forged" }, { canceled_by: "forged" }, { canceled_at: orderChangeDeclineStamp },
      { order_id: "forged" }, { version: 99 }, { actions: [] }, { updated_at: orderChangeDeclineStamp }, { deleted_at: null }])
      expect(Exit.isFailure(await Effect.runPromiseExit(Reflect.apply(host.run, host, [host.newRequestKey(), { id: orderChangeDeclineIds[0], ...extra }]))), JSON.stringify(extra)).toBe(true);
    for (const value of [[], [{ id: orderChangeDeclineIds[0] }], { id: "" }])
      expect(Exit.isFailure(await Effect.runPromiseExit(Reflect.apply(host.run, host, [host.newRequestKey(), value])))).toBe(true);
    expect(retrieve).not.toHaveBeenCalled(); expect(decline).not.toHaveBeenCalled(); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("serializes concurrent retained child resource calls and publishes exactly two native events", async () => {
    const local = await scenario("concurrent-children"), ids: string[] = [orderChangeDeclineIds[0], orderChangeDeclineIds[1]],
      beforeRows = await local.readChanges(), beforeOther = await local.read(unaffectedIds()), before = await local.snapshot(),
      original = OrderModuleService.prototype.declineOrderChange;
    let active = 0, peak = 0;
    const decline = vi.spyOn(OrderModuleService.prototype, "declineOrderChange").mockImplementation(async function (this: OrderModuleService, ...args) {
      active++; peak = Math.max(peak, active);
      try { await Reflect.apply(original, this, args); } finally { active--; }
    });
    const host = await local.prepareConcurrent();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), ids.map(id => ({ id, declined_by: "concurrent-native-actor" }))))).toBeNull();
    expect(decline).toHaveBeenCalledTimes(2); expect(peak).toBe(1); expect(active).toBe(0);
    const afterRows = await local.readChanges(), after = await local.snapshot();
    expect(afterRows.filter(row => ids.includes(String(row.id))).map(row => [row.id, row.status, row.declined_by])).toEqual(
      [...ids].sort().map(id => [id, "declined", "concurrent-native-actor"]));
    for (const row of afterRows.filter(row => ids.includes(String(row.id)))) {
      const prior = beforeRows.find(value => value.id === row.id);
      if (prior === undefined) throw new Error("Missing concurrent decline preimage");
      expectDeclinedRow(prior, row, { declined_by: "concurrent-native-actor" });
    }
    expect(afterRows.filter(row => !ids.includes(String(row.id)))).toEqual(beforeRows.filter(row => !ids.includes(String(row.id))));
    expect(await local.read(unaffectedIds())).toEqual(beforeOther); expect(after.rows).toHaveLength(before.rows.length);
    expect(after.revisions.length - before.revisions.length).toBe(2); expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(eventVector(eventsSince(before, after))).toEqual(ids.map(id => ["order.order-change.updated", id]));
  }, 240_000);
  it("keeps a caught sibling refusal sticky and rejects escaped methods after settlement", async () => {
    const local = await scenario("authority"), host = await local.prepareDeniedSibling(), before = await local.snapshot(),
      failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id: orderChangeDeclineIds[0] }));
    expect(Exit.isFailure(failed)).toBe(true); expect(await local.snapshot()).toEqual(before);
    await expect(local.callEscaped()).rejects.toBeDefined(); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("confines identical Change and parent IDs to their project scope", async () => {
    const local = await scenario("scope-one"), peerRows = orderChangeDeclineRows().map(value => value.table === "order_change"
      ? { ...value, row: { ...value.row, metadata: { peer: true }, declined_by: "peer" } } : value),
      peer = await scenario("scope-two", peerRows), beforePeer = await peer.readChanges(), host = await local.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), { id: orderChangeDeclineIds[0], metadata: { local: true } }));
    expect(await peer.readChanges()).toEqual(beforePeer);
  }, 240_000);

  it("refuses corrupted durable void results on replay without invoking the native service again", async () => {
    const local = await scenario("corrupt-replay"), host = await local.prepare(), key = host.newRequestKey(), request = { id: orderChangeDeclineIds[0] },
      decline = vi.spyOn(OrderModuleService.prototype, "declineOrderChange");
    expect(await Effect.runPromise(host.run(key, request))).toBeNull();
    for (const damaged of [{ forged: true }, [], "undefined"]) await local.withStoredOrderResult(key, damaged, async () => {
      const before = await local.snapshot(), failed = await Effect.runPromiseExit(host.run(key, request));
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toContain("storedCorruption");
      expect(decline).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
    });
    expect(await Effect.runPromise(host.run(key, request))).toBeNull(); expect(decline).toHaveBeenCalledTimes(1);
  }, 240_000);

  it("rejects unadmitted workflow options before execution", async () => {
    const local = await scenario("construction"), before = await local.snapshot();
    for (const extra of [{ hooks: {} }, { logicalResources: {} }])
      expect(Exit.isFailure(await Effect.runPromiseExit(prepareOrderChangeDeclineWorkflow({ ...local.options, ...extra })))).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);
});
