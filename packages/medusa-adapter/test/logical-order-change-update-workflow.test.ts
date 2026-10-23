import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { OrderModuleService } from "@medusajs/order/services";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderChangeUpdateInput } from "../src/modules/order/change-update-input";
import { prepareOrderChangeUpdateWorkflow } from "../src/workflows/order/update-order-changes";
import { prepareLogicalOrderChangeUpdate, maximumOrderChangeUpdateInput, orderChangeUpdateIds, orderChangeUpdateRows,
  orderChangeUpdateStamp, OrderChangeUpdateLateInput, type OrderInitialRow } from "./support/logical-order-change-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalOrderChangeUpdate>>, sharedCleanupCount = 0, ordinal = 0, reusedConnected = false;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
let initialScalars: typeof OrderChangeUpdateInput.Type;
const fields = ["status", "description", "internal_note", "requested_by", "confirmed_by", "declined_by", "declined_reason", "canceled_by", "carry_over_promotions"] as const;
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
const withoutUpdated = (row: JsonObject) => { const { updated_at: _updated, ...rest } = row; return rest; };
const nativeChangeRow = (row: JsonObject) => ({ ...row, order: { id: row.order_id } });
const eventsSince = (before: Inventory, after: Inventory) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
function eventVector(events: Inventory["events"]) {
  return events.map(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data) || typeof message.data.id !== "string")
      throw new Error("Missing native Order Change module event");
    expect(message.metadata).toMatchObject({ source: "order", object: "order_change", action: "updated" });
    return [event.envelope.contract, message.data.id];
  });
}
const unaffectedIds = () => orderChangeUpdateRows().filter(value => value.table !== "order_change").map(value => String(value.row.id));
async function scenario(name: string, rows?: readonly OrderInitialRow[]) {
  if (rows === undefined) { reusedConnected = true; return connected; }
  const number = ++ordinal;
  return prepareLogicalOrderChangeUpdate(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `order-change-update-${name}-${number}`, projectId: "order-change-update", uuidOffset: 14_000_000 + number * 10_000 } });
}
const unchangedFamilies = ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const;

describe(`genuine native plural Order Change scalar update workflow - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalOrderChangeUpdate(driver, close => cleanup.push(close));
    initialScalars = Schema.decodeUnknownSync(OrderChangeUpdateInput)((await connected.readChanges()).map(row => ({ id: row.id,
      ...Object.fromEntries(fields.map(field => [field, row[field]])) })));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      if (reusedConnected) {
        try { const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), initialScalars)); }
        finally { reusedConnected = false; await connected.closeCaseHosts(); }
      }
    } finally { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("updates four native Changes, validates full DTOs, confines all other model writes and replays once", async () => {
    const local = await scenario("maximum"), request = maximumOrderChangeUpdateInput(), owned = structuredClone(request),
      beforeRows = await local.readChanges(), beforeOther = await local.read(unaffectedIds()), before = await local.snapshot(),
      list = vi.spyOn(OrderModuleService.prototype, "listOrderChanges"), update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges"),
      host = await local.prepare(), key = host.newRequestKey();
    const result = await Effect.runPromise(host.run(key, request)), afterRows = await local.readChanges();
    expect(result).toEqual(afterRows.map(nativeChangeRow)); expect(request).toEqual(owned);
    expect(result.map(row => row.id)).toEqual([...orderChangeUpdateIds].sort());
    expect(list).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.slice(0, 2)).toEqual([{ id: request.map(row => row.id) },
      { relations: [], select: ["id", ...fields], order: { id: "ASC" } }]);
    expect(afterRows.map(withoutUpdated)).toEqual(beforeRows.map(row => {
      const patch = request.find(value => value.id === row.id); return withoutUpdated({ ...row, ...patch });
    }));
    expect(afterRows.every(row => row.updated_at !== orderChangeUpdateStamp)).toBe(true);
    expect(await local.read(unaffectedIds())).toEqual(beforeOther);
    const committed = await local.snapshot();
    expect(committed.rows).toHaveLength(before.rows.length);
    const additions = committed.revisions.filter(row => !before.revisions.some(prior => prior.scopeUuid === row.scopeUuid &&
      prior.tableId === row.tableId && prior.commitSeq === row.commitSeq && Buffer.from(prior.rowId).equals(Buffer.from(row.rowId))));
    expect(additions).toHaveLength(4); expect(new Set(additions.map(row => row.tableId)).size).toBe(1);
    expect(committed.rowChanges.length - before.rowChanges.length).toBe(4);
    expect(eventVector(eventsSince(before, committed))).toEqual([...orderChangeUpdateIds].sort().map(id => ["order.order-change.updated", id]));
    expect(await Effect.runPromise(host.run(key, request))).toEqual(result);
    expect(list).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(committed);
    await expect(Effect.runPromise(host.run(key, [{ id: orderChangeUpdateIds[0], description: "conflict" }])))
      .rejects.toMatchObject({ reason: "requestConflict" });
  }, 240_000);

  it("retains the native selected preimages, including canceled and null statuses, and restores every scalar after commit", async () => {
    const local = await scenario("retained"), beforeRows = await local.readChanges(), beforeOther = await local.read(unaffectedIds()),
      forward = await local.prepareForward(), request = maximumOrderChangeUpdateInput(),
      result = await Effect.runPromise(forward.run(forward.newRequestKey(), request));
    expect(result.preimages).toEqual(beforeRows.map(row => ({ id: row.id, ...Object.fromEntries(fields.map(field => [field, row[field]])) })));
    expect(result.preimages.map(row => row.status)).toEqual([null, "requested", "canceled", "pending"]);
    const inverse = await local.prepareInverse(), update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges");
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimages))).toBeNull();
    expect(update).toHaveBeenCalledTimes(1); expect(update.mock.calls[0]?.[0]).toEqual(result.preimages);
    expect((await local.readChanges()).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
    expect(await update.mock.results[0]?.value).toEqual((await local.readChanges()).map(nativeChangeRow));
    expect(await local.read(unaffectedIds())).toEqual(beforeOther);
  }, 240_000);

  it("executes native forward and inverse in one borrowed root and preserves repeated-inverse writes", async () => {
    const local = await scenario("roundtrip"), prior = await local.readChanges(), forward = await local.prepareForward(true),
      update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges"), result = await Effect.runPromise(forward.run(forward.newRequestKey(), maximumOrderChangeUpdateInput()));
    expect(update).toHaveBeenCalledTimes(2);
    expect((await local.readChanges()).map(withoutUpdated)).toEqual(prior.map(withoutUpdated));
    const inverse = await local.prepareInverse(), beforeRows = await local.readChanges(), before = await local.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimages));
    const afterRows = await local.readChanges(), after = await local.snapshot();
    expect(afterRows.map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
    expect(afterRows.every(row => row.updated_at !== beforeRows.find(value => value.id === row.id)?.updated_at)).toBe(true);
    expect(after.revisions.length - before.revisions.length).toBe(4);
    expect(eventVector(eventsSince(before, after))).toEqual([...orderChangeUpdateIds].sort().map(id => ["order.order-change.updated", id]));
  }, 240_000);

  it("keeps empty roots free of native service calls and skips empty retained compensation", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), host = await local.prepare(), forward = await local.prepareForward(true),
      list = vi.spyOn(OrderModuleService.prototype, "listOrderChanges"), update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), []))).toEqual([]);
    expect(await Effect.runPromise(forward.run(forward.newRequestKey(), []))).toEqual({ output: [], preimages: [] });
    expect(list).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    const after = await local.snapshot(); for (const key of unchangedFamilies) expect(after[key], key).toEqual(before[key]);
  }, 180_000);

  it("keeps an ID-only native update unwritten and its selected retained inverse empty of mutations", async () => {
    const local = await scenario("id-only"), before = await local.snapshot(), prior = await local.readChanges(), forward = await local.prepareForward(true),
      request = [{ id: orderChangeUpdateIds[0] }], result = await Effect.runPromise(forward.run(forward.newRequestKey(), request));
    expect(result.preimages).toEqual(request); expect(result.output).toEqual(prior.filter(row => row.id === request[0]!.id).map(nativeChangeRow));
    const after = await local.snapshot(); for (const key of unchangedFamilies) expect(after[key], key).toEqual(before[key]);
  }, 180_000);

  it("keeps same-value scalar writes and their native module event", async () => {
    const local = await scenario("same-value"), prior = await local.readChanges(), selected = prior[0];
    if (selected === undefined) throw new Error("Missing selected existing Change");
    const request = Schema.decodeUnknownSync(OrderChangeUpdateInput)([{ id: selected.id, description: selected.description }]),
      host = await local.prepare(), before = await local.snapshot(), result = await Effect.runPromise(host.run(host.newRequestKey(), request)), after = await local.snapshot();
    expect(result).toEqual((await local.readChanges()).filter(row => row.id === selected.id).map(nativeChangeRow));
    expect(result[0]?.updated_at).not.toEqual(selected.updated_at); expect(after.revisions.length - before.revisions.length).toBe(1);
    expect(eventVector(eventsSince(before, after))).toEqual([["order.order-change.updated", selected.id]]);
  }, 180_000);

  it("preserves one Change scalar null, false and empty-string assignments without inventing actor guards", async () => {
    const local = await scenario("scalar-values"), host = await local.prepare(), request = [{ id: orderChangeUpdateIds[2], status: null,
      description: "", internal_note: null, requested_by: "", confirmed_by: null, declined_by: "", declined_reason: null,
      canceled_by: "a-different-native-actor", carry_over_promotions: false }], beforeOther = await local.read(unaffectedIds());
    const result = await Effect.runPromise(host.run(host.newRequestKey(), request));
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject(request[0]!);
    expect(await local.read(unaffectedIds())).toEqual(beforeOther);
  }, 180_000);

  it("retains native last-duplicate-patch semantics and unique result/event identities", async () => {
    const local = await scenario("duplicates"), id = orderChangeUpdateIds[0], prior = (await local.readChanges()).find(row => row.id === id),
      host = await local.prepare(), before = await local.snapshot(), request = [
        { id, description: "discarded duplicate patch", requested_by: "discarded actor" },
        { id, description: "final duplicate patch" },
      ], result = await Effect.runPromise(host.run(host.newRequestKey(), request));
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id, description: "final duplicate patch", requested_by: prior?.requested_by });
    expect(eventVector(eventsSince(before, await local.snapshot()))).toEqual([["order.order-change.updated", id]]);
  }, 180_000);

  it("discards an earlier duplicate scalar patch when the final duplicate is ID-only", async () => {
    const local = await scenario("duplicate-id-only"), id = orderChangeUpdateIds[0], prior = await local.readChanges(),
      forward = await local.prepareForward(), before = await local.snapshot(), request = [{ id, description: "discarded" }, { id }],
      result = await Effect.runPromise(forward.run(forward.newRequestKey(), request));
    expect(result.output).toEqual(prior.filter(row => row.id === id).map(nativeChangeRow));
    expect(result.preimages).toEqual(prior.filter(row => row.id === id).map(row => ({ id, description: row.description })));
    const after = await local.snapshot(); for (const key of unchangedFamilies) expect(after[key], key).toEqual(before[key]);
    // Native preimages retain the discarded field union. Its genuine inverse
    // therefore performs a same-value assignment even though forward was empty.
    const inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.preimages));
    const restored = await local.snapshot();
    expect(eventVector(eventsSince(after, restored))).toEqual([["order.order-change.updated", id]]);
    expect(restored.revisions.length - after.revisions.length).toBe(1);
    expect((await local.readChanges()).map(withoutUpdated)).toEqual(prior.map(withoutUpdated));
  }, 180_000);

  it("preserves native missing-ID failure and rolls back a mixed valid and missing request", async () => {
    const local = await scenario("missing"), before = await local.snapshot(), host = await local.prepare(),
      update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges"), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), Schema.decodeUnknownSync(OrderChangeUpdateInput)([
        { id: orderChangeUpdateIds[0], description: "must roll back" }, { id: "ordch-update-missing", status: "requested" },
      ])));
    expect(Exit.isFailure(failed)).toBe(true); expect(update).toHaveBeenCalledTimes(1);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("ordch-update-missing");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("keeps a historical Change invisible and refuses a mixed update atomically", async () => {
    const rows = orderChangeUpdateRows().map(value => value.table === "order_change" && value.row.id === orderChangeUpdateIds[1]
      ? { ...value, row: { ...value.row, deleted_at: orderChangeUpdateStamp } } : value), local = await scenario("historical-change", rows),
      host = await local.prepare(), before = await local.snapshot(), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumOrderChangeUpdateInput()));
    expect(Exit.isFailure(failed)).toBe(true); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("retains selected Change preimages but refuses native full lookup beneath a historical Order", async () => {
    const rows = orderChangeUpdateRows(), selected = rows.find(value => value.table === "order_change" && value.row.id === orderChangeUpdateIds[0]);
    if (selected === undefined || typeof selected.row.order_id !== "string") throw new Error("Missing existing Change parent");
    const historical = rows.map(value => value.table === "order" && value.row.id === selected.row.order_id
      ? { ...value, row: { ...value.row, deleted_at: orderChangeUpdateStamp } } : value),
      local = await scenario("historical-parent", historical), host = await local.prepareForward(), before = await local.snapshot(),
      list = vi.spyOn(OrderModuleService.prototype, "listOrderChanges"), update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges"),
      failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), [{ id: orderChangeUpdateIds[0], description: "must roll back" }]));
    expect(Exit.isFailure(failed)).toBe(true); expect(list).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    expect(await list.mock.results[0]?.value).toEqual([{ id: selected.row.id, description: selected.row.description }]);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain(String(selected.row.id));
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("restores rows, indexes, facts, events and outcomes after a late native parent failure", async () => {
    const local = await scenario("late-parent"), host = await local.prepareLateFailure(), before = await local.snapshot(),
      request = Schema.decodeUnknownSync(OrderChangeUpdateLateInput)(maximumOrderChangeUpdateInput().map(({ id, description }) => ({ id, description }))),
      update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges"), failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), request));
    expect(Exit.isFailure(failed)).toBe(true); expect(update).toHaveBeenCalledTimes(1);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain(local.lateFailure.message);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rejects unsupported metadata/date and managed-field updates before native execution", async () => {
    const local = await scenario("unsupported"), host = await local.prepare(), before = await local.snapshot(),
      list = vi.spyOn(OrderModuleService.prototype, "listOrderChanges"), update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges");
    for (const extra of [{ metadata: null }, { metadata: {} }, { requested_at: null }, { canceled_at: orderChangeUpdateStamp },
      { order_id: "foreign-order" }, { version: 999 }, { actions: [] }, { created_by: "forged" }, { updated_at: orderChangeUpdateStamp }, { deleted_at: null }]) {
      const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), [{ id: orderChangeUpdateIds[0], ...extra }]));
      expect(Exit.isFailure(failed), JSON.stringify(extra)).toBe(true);
    }
    const five = [...maximumOrderChangeUpdateInput(), { id: orderChangeUpdateIds[0] }];
    expect(Exit.isFailure(await Effect.runPromiseExit(host.run(host.newRequestKey(), five)))).toBe(true);
    expect(list).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("keeps caught sibling-resolution refusal sticky and rejects escaped methods after settlement", async () => {
    const local = await scenario("authority"), host = await local.prepareDeniedSibling(), before = await local.snapshot(),
      failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), maximumOrderChangeUpdateInput()));
    expect(Exit.isFailure(failed)).toBe(true); expect(await local.snapshot()).toEqual(before);
    await expect(local.callEscaped()).rejects.toBeDefined(); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("confines identical external IDs to their project scope", async () => {
    const local = await scenario("scope-one"), peerRows = orderChangeUpdateRows().map(value => value.table === "order_change"
      ? { ...value, row: { ...value.row, description: "Different peer scope", metadata: { peer: true } } } : value),
      peer = await scenario("scope-two", peerRows), beforePeer = await peer.readChanges(), host = await local.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), maximumOrderChangeUpdateInput()));
    expect(await peer.readChanges()).toEqual(beforePeer);
  }, 240_000);

  it("refuses malformed durable full DTOs on replay without invoking native services again", async () => {
    const local = await scenario("corrupt-replay"), host = await local.prepare(), key = host.newRequestKey(), request = maximumOrderChangeUpdateInput(),
      update = vi.spyOn(OrderModuleService.prototype, "updateOrderChanges"), result = await Effect.runPromise(host.run(key, request)), first = result[0];
    if (first === undefined) throw new Error("Missing full native Order Change result");
    for (const damaged of [[{}], [{ ...first, status: "foreign-status" }], [{ ...first, order: { id: "foreign-parent" } }], [{ ...first, version: "invalid" }]])
      await local.withStoredOrderResult(key, damaged, async () => {
        const before = await local.snapshot(), failed = await Effect.runPromiseExit(host.run(key, request));
        expect(Exit.isFailure(failed)).toBe(true);
        if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toContain("storedCorruption");
        expect(update).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
      });
    expect(await Effect.runPromise(host.run(key, request))).toEqual(result); expect(update).toHaveBeenCalledTimes(1);
  }, 240_000);

  it("rejects foreign module construction and unadmitted workflow options before execution", async () => {
    const local = await scenario("construction"), before = await local.snapshot();
    for (const extra of [{ hooks: {} }, { logicalResources: {} }]) {
      const failed = await Effect.runPromiseExit(prepareOrderChangeUpdateWorkflow({ ...local.options, ...extra }));
      expect(Exit.isFailure(failed)).toBe(true);
    }
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);
});
