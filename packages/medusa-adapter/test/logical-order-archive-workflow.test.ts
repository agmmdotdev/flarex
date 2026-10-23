import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { OrderModuleService } from "@medusajs/order/services";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeOrderArchiveStatuses } from "../src/modules/order/input";
import { prepareLogicalOrderArchive, orderArchiveIds, orderArchiveRows, orderArchiveStamp,
  type OrderInitialRow } from "./support/logical-order-archive-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalOrderArchive>>, sharedCleanupCount = 0, ordinal = 0;
type Local = typeof connected;
type Inventory = Awaited<ReturnType<Local["snapshot"]>>;
type Statuses = Result.Result.Success<ReturnType<typeof decodeOrderArchiveStatuses>>;
let reusedConnected = false, initialStatuses: Statuses;
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
const withoutUpdated = (row: JsonObject) => { const { updated_at: _updated, ...rest } = row; return rest; };
const decodeAddressReference = Schema.decodeUnknownSync(Schema.Union([Schema.String, Schema.Null]));
/** Independently characterized against the pinned native Postgres repository:
 * null FK keys disappear, while nonnull keys and ID-only references remain. */
function nativeOrderRow(row: JsonObject) {
  const { shipping_address_id: shippingInput, billing_address_id: billingInput, ...scalars } = row;
  const shipping = decodeAddressReference(shippingInput), billing = decodeAddressReference(billingInput);
  return { ...scalars, shipping_address: shipping === null ? null : { id: shipping },
    billing_address: billing === null ? null : { id: billing },
    ...(shipping === null ? {} : { shipping_address_id: shipping }), ...(billing === null ? {} : { billing_address_id: billing }) };
}
const nativeArchivedRow = (row: JsonObject) => nativeOrderRow({ ...row, status: "archived" });
const eventsSince = (before: Inventory, after: Inventory) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
function eventVector(events: Inventory["events"]) {
  return events.flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing complete native Order event");
    return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id])
      .map(id => [event.envelope.contract, id]);
  });
}
async function scenario(name: string, rows?: readonly OrderInitialRow[]) {
  // Ordinary cases reuse one installed native model closure. The verified
  // retained callback restores its initial statuses after each test. Distinct
  // seeded/historical states and the scope-isolation peer keep separate scopes.
  if (rows === undefined) { reusedConnected = true; return connected; }
  const number = ++ordinal;
  return prepareLogicalOrderArchive(driver, close => cleanup.push(close), rows, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: `order-archive-${name}-${number}`, projectId: "order-archive-173", uuidOffset: 12_000_000 + number * 10_000 } });
}
const input = () => ({ orderIds: [...orderArchiveIds] });

describe(`genuine native Order archive workflow - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalOrderArchive(driver, close => cleanup.push(close));
    initialStatuses = Result.getOrThrow(decodeOrderArchiveStatuses((await connected.read()).map(row => ({ id: row.id, status: row.status }))));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      if (reusedConnected) {
        try {
          const inverse = await connected.prepareInverse();
          await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...initialStatuses]));
        } finally { reusedConnected = false; await connected.closeCaseHosts(); }
      }
    } finally { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("archives four native roots, preserves complete serial/scalar values and replays without another invocation", async () => {
    const local = await scenario("maximum"), beforeRows = await local.read(), before = await local.snapshot(), host = await local.prepare(),
      archive = vi.spyOn(OrderModuleService.prototype, "archive"), list = vi.spyOn(OrderModuleService.prototype, "listOrders"),
      request = input(), owned = structuredClone(request), key = host.newRequestKey();
    const output = await Effect.runPromise(host.run(key, request));
    expect(output).toEqual(beforeRows.map(nativeArchivedRow));
    expect(output.map(row => row.id)).toEqual([...orderArchiveIds].sort());
    expect(request).toEqual(owned); expect(archive).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.slice(0, 2)).toEqual([{ id: request.orderIds }, { select: ["id", "status"], order: { id: "ASC" } }]);
    const afterRows = await local.read();
    expect(afterRows.map(withoutUpdated)).toEqual(beforeRows.map(row => withoutUpdated({ ...row, status: "archived" })));
    expect(afterRows.every(row => row.updated_at !== orderArchiveStamp)).toBe(true);
    const committed = await local.snapshot(), vector = eventVector(eventsSince(before, committed));
    expect(vector.filter(([name]) => name === "order.archived").map(([, id]) => id)).toEqual(request.orderIds);
    expect(vector.filter(([name]) => name === "order.order.updated").map(([, id]) => id)).toEqual([...orderArchiveIds].sort());
    expect(await Effect.runPromise(host.run(key, request))).toEqual(output);
    expect(archive).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(committed);
  }, 240_000);

  it("retains heterogeneous pre-archive statuses and invokes the genuine inverse after commit", async () => {
    const local = await scenario("retained-inverse"), prior = await local.read(), forward = await local.prepareForward(),
      update = vi.spyOn(OrderModuleService.prototype, "updateOrders");
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), input()));
    expect(result.statuses).toEqual(prior.map(row => ({ id: row.id, status: row.status })));
    expect(result.output).toEqual(prior.map(nativeArchivedRow));
    expect(update).not.toHaveBeenCalled();
    const inverse = await local.prepareInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...result.statuses]))).toBeNull();
    expect(update).toHaveBeenCalledTimes(1); expect(update.mock.calls[0]?.[0]).toEqual(result.statuses);
    const restored = await local.read();
    expect(restored.map(withoutUpdated)).toEqual(prior.map(withoutUpdated));
    expect(await update.mock.results[0]?.value).toEqual(restored.map(nativeOrderRow));
  }, 240_000);

  it("runs the retained native forward and inverse within one genuine borrowed root", async () => {
    const local = await scenario("same-root-roundtrip"), prior = await local.read(), host = await local.prepareForward(true),
      archive = vi.spyOn(OrderModuleService.prototype, "archive"), update = vi.spyOn(OrderModuleService.prototype, "updateOrders");
    const result = await Effect.runPromise(host.run(host.newRequestKey(), input()));
    expect(result.statuses).toEqual(prior.map(row => ({ id: row.id, status: row.status })));
    expect(archive).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    expect(archive.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0] ?? 0);
    expect((await local.read()).map(withoutUpdated)).toEqual(prior.map(withoutUpdated));
  }, 240_000);

  it("preserves pinned Drizzle repeated-inverse writes and module events under a new request key", async () => {
    // Both backing-driver lanes execute the selected portable fork's Drizzle
    // persistence contract, which writes each inverse patch and emits updates.
    const local = await scenario("repeated-inverse"), forward = await local.prepareForward(),
      result = await Effect.runPromise(forward.run(forward.newRequestKey(), input())), inverse = await local.prepareInverse(),
      update = vi.spyOn(OrderModuleService.prototype, "updateOrders");
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...result.statuses]));
    const beforeRows = await local.read(), before = await local.snapshot();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...result.statuses]));
    const afterRows = await local.read(), after = await local.snapshot();
    expect(update).toHaveBeenCalledTimes(2);
    expect(afterRows.map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated));
    expect(afterRows.every(row => row.updated_at !== beforeRows.find(prior => prior.id === row.id)?.updated_at)).toBe(true);
    expect(after.revisions.length - before.revisions.length).toBe(4);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(4);
    expect(eventVector(eventsSince(before, after))).toEqual([...orderArchiveIds].sort().map(id => ["order.order.updated", id]));
    expect(await update.mock.results[1]?.value).toEqual(afterRows.map(nativeOrderRow));
  }, 240_000);

  it("refuses canonically valid but malformed durable native DTOs on replay without another invocation", async () => {
    const local = await scenario("corrupt-replay"), host = await local.prepare(), key = host.newRequestKey(), request = input(),
      archive = vi.spyOn(OrderModuleService.prototype, "archive"), output = await Effect.runPromise(host.run(key, request));
    if (output[0] === undefined) throw new Error("Missing complete archived Order result");
    const damaged = [[{}], [{ ...output[0], display_id: "invalid-serial" }], [{ ...output[0],
      shipping_address_id: "ordaddr173-one", shipping_address: { id: "ordaddr173-another" } }]];
    for (const value of damaged) await local.withStoredOrderResult(key, value, async () => {
      const before = await local.snapshot(), replay = await Effect.runPromiseExit(host.run(key, request));
      expect(Exit.isFailure(replay)).toBe(true);
      if (Exit.isFailure(replay)) expect(reasons(replay.cause)).toContain("storedCorruption");
      expect(archive).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
    });
    expect(await Effect.runPromise(host.run(key, request))).toEqual(output);
    expect(archive).toHaveBeenCalledTimes(1);
  }, 240_000);

  it("rolls back all native rows, history, indexes, facts, events and outcomes after a late parent failure", async () => {
    const local = await scenario("late-parent"), host = await local.prepareLateFailure(), before = await local.snapshot(),
      archive = vi.spyOn(OrderModuleService.prototype, "archive");
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), input()));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain(local.lateFailure.message);
    expect(archive).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("keeps the empty native branch and skips the empty retained inverse", async () => {
    const local = await scenario("empty"), before = await local.snapshot(), host = await local.prepareForward(true),
      archive = vi.spyOn(OrderModuleService.prototype, "archive"), update = vi.spyOn(OrderModuleService.prototype, "updateOrders");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { orderIds: [] }))).toEqual({ output: [], statuses: [] });
    expect(archive).toHaveBeenCalledTimes(1); expect(update).not.toHaveBeenCalled();
    const after = await local.snapshot();
    for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
      expect(after[key], key).toEqual(before[key]);
  }, 180_000);

  it("preserves native duplicate selection while publishing every original workflow event ID", async () => {
    const local = await scenario("duplicates"), host = await local.prepare(), before = await local.snapshot(), id = orderArchiveIds[0],
      request = { orderIds: [id, id, id, id] };
    const output = await Effect.runPromise(host.run(host.newRequestKey(), request));
    expect(output).toHaveLength(1); expect(output[0]).toMatchObject({ id, status: "archived", display_id: 300 });
    const vector = eventVector(eventsSince(before, await local.snapshot()));
    expect(vector.filter(([name]) => name === "order.archived").map(([, value]) => value)).toEqual(request.orderIds);
    expect(vector.filter(([name]) => name === "order.order.updated")).toEqual([["order.order.updated", id]]);
  }, 240_000);

  it("retains native missing-ID failure and atomically rolls back the mixed request", async () => {
    const local = await scenario("missing"), host = await local.prepare(), before = await local.snapshot(),
      archive = vi.spyOn(OrderModuleService.prototype, "archive");
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { orderIds: [orderArchiveIds[0], "order173-missing"] }));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("order173-missing");
    expect(archive).toHaveBeenCalledTimes(1); expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it.each(["pending", "archived", "requires_action"])("preserves native %s refusal without writing another selected valid Order", async status => {
    const rows = orderArchiveRows().map((value, index) => index === 1 ? { ...value, row: { ...value.row, status } } : value),
      local = await scenario("invalid-" + status, rows), host = await local.prepare(), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), input()));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(reasons(failed.cause).join("\n")).toContain("cannot be archived");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("keeps a soft-deleted selected Order invisible and refuses the whole native update", async () => {
    const rows = orderArchiveRows().map((value, index) => index === 1 ? { ...value, row: { ...value.row, deleted_at: orderArchiveStamp } } : value),
      local = await scenario("historical", rows), host = await local.prepare(), before = await local.snapshot();
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), input()));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("rejects raw five-ID input before native service execution", async () => {
    const local = await scenario("raw-bound"), host = await local.prepare(), before = await local.snapshot(),
      archive = vi.spyOn(OrderModuleService.prototype, "archive");
    const failed = await Effect.runPromiseExit(host.run(host.newRequestKey(), { orderIds: [...orderArchiveIds, orderArchiveIds[0]] }));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(archive).not.toHaveBeenCalled(); expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("confines equal external Order IDs and preserves serial/scalar values in the other scope", async () => {
    const local = await scenario("scope-one"), peerRows = orderArchiveRows().map((value, index) => ({ ...value,
      row: { ...value.row, display_id: 1200 + index, metadata: { scope: "peer" } } })),
      peer = await scenario("scope-two", peerRows), beforePeer = await peer.read(), host = await local.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), input()));
    expect((await local.read()).every(row => row.status === "archived")).toBe(true);
    expect(await peer.read()).toEqual(beforePeer);
  }, 240_000);

  it("preserves live and historical Address ID-only references without hydrating or changing Address rows", async () => {
    const shipping = "ordaddr173-live", billing = "ordaddr173-historical";
    const addresses: OrderInitialRow[] = [shipping, billing].map((id, index) => ({ table: "order_address", row: {
      id, customer_id: "cus-existing", company: "Existing private company", first_name: "Native", last_name: "Address",
      address_1: "Private existing address", address_2: null, city: "Existing city", country_code: "us", province: null,
      postal_code: "10001", phone: null, metadata: { private: true, source: id }, created_at: orderArchiveStamp,
      updated_at: orderArchiveStamp, deleted_at: index === 1 ? orderArchiveStamp : null,
    } }));
    const roots = orderArchiveRows().map((value, index) => index === 0 ? { ...value,
      row: { ...value.row, shipping_address_id: shipping, billing_address_id: billing } } : value);
    const local = await scenario("address-references", [...addresses, ...roots]), beforeAddresses = await local.read([shipping, billing]),
      prior = await local.read([orderArchiveIds[0]]), host = await local.prepare();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), { orderIds: [orderArchiveIds[0]] }));
    expect(output).toEqual(prior.map(nativeArchivedRow));
    expect(output[0]).toMatchObject({ shipping_address: { id: shipping }, billing_address: { id: billing },
      shipping_address_id: shipping, billing_address_id: billing });
    expect(await local.read([shipping, billing])).toEqual(beforeAddresses);
    const statuses = Result.getOrThrow(decodeOrderArchiveStatuses(prior.map(row => ({ id: row.id, status: row.status })))),
      inverse = await local.prepareInverse(), update = vi.spyOn(OrderModuleService.prototype, "updateOrders");
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), [...statuses]));
    expect(update).toHaveBeenCalledTimes(1);
    expect(await update.mock.results[0]?.value).toEqual((await local.read([orderArchiveIds[0]])).map(nativeOrderRow));
    expect(await local.read([shipping, billing])).toEqual(beforeAddresses);
  }, 240_000);
});
