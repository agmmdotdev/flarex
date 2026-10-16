import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileInventoryItemUpdateContracts, decodeInventoryItemUpdates } from "../src/modules/inventory/update-input";
import { inventoryItemUpdateEventPolicy } from "../src/modules/inventory/update-events";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof inventoryItemUpdateEventPolicy>;
let contracts: Result.Result.Success<ReturnType<typeof compileInventoryItemUpdateContracts>>;
const time = "2026-10-16T00:00:00.000Z", later = "2026-10-16T00:01:00.000Z";
const row = (id: string, changes: JsonObject = {}): JsonObject => ({ id, sku: id, origin_country: null, hs_code: null, mid_code: null,
  material: null, weight: null, length: null, height: null, width: null, requires_shipping: true, description: null,
  title: "Original", thumbnail: null, metadata: { keep: true, remove: true, nested: { old: true } },
  created_at: time, updated_at: time, deleted_at: null, ...changes });
const event = (id: string): Json => ({ name: "inventory.inventory-item.updated",
  metadata: { source: "inventory", object: "inventory_item", action: "updated" }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const call = (input: Json, result: Json, events: readonly Json[] = [], read = false): Call => ({
  commandName: read ? "inventoryItemListForUpdate" : "inventoryItemUpdateForWorkflow", mode: read ? "read" : "write", input, result, events,
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const evidence = (pairs: readonly Readonly<{ before: JsonObject; after: JsonObject }>[], unchanged: readonly JsonObject[] = []): Activity => ({
  ...empty(), observedRows: [...pairs.map(pair => pair.after), ...unchanged].map(row => ({ table: "inventory_item", row })),
  mutations: pairs.map((pair, ordinal) => ({ ordinal, table: "inventory_item", operation: "patch", ...pair })),
});
const refused = async (receipt: Call, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata()), table = metadata.frame.tables.find(table => table.name === "inventory_item");
  if (table === undefined) throw new Error("Missing InventoryItem DML");
  contracts = Result.getOrThrow(compileInventoryItemUpdateContracts(table)); policy = inventoryItemUpdateEventPolicy(contracts);
});

describe("native InventoryItem attribute update receipts", () => {
  it("retains raw duplicate entries and zero-four bounds while refusing relations, computed and managed fields", () => {
    for (const input of [[], [{ id: "a" }], [{ id: "b", title: "first" }, { id: "a", sku: null }, { id: "b", metadata: {} }]])
      expect(Result.getOrThrow(decodeInventoryItemUpdates(input))).toEqual(input);
    for (const input of [[{ id: "" }], [{ title: "missing id" }], [{ id: "a", created_at: time }], [{ id: "a", deleted_at: null }],
      [{ id: "a", location_levels: [] }], [{ id: "a", reservation_items: [] }], [{ id: "a", stocked_quantity: 1 }],
      [{ id: "a", requires_shipping: null }], [{ id: "a", metadata: [] }], Array.from({ length: 5 }, (_, index) => ({ id: String(index) }))])
      expect(Result.isFailure(decodeInventoryItemUpdates(input)), JSON.stringify(input)).toBe(true);
  });

  it("requires complete checked native rows including finite dimension representations", () => {
    for (const dimensions of [{ weight: null }, { weight: 0, width: -2, height: 5 }, { weight: 1.5 }])
      expect(Result.isSuccess(contracts.decodeRow(row("a", dimensions)))).toBe(true);
    for (const changes of [{ weight: "1" }, { weight: Infinity }, { weight: NaN }, { requires_shipping: "true" }, { metadata: [] }, { extra: true }])
      expect(Result.isFailure(contracts.decodeRow(row("a", changes)))).toBe(true);
    const incomplete: Record<string, Json> = { ...row("a") }; delete incomplete.height;
    expect(Result.isFailure(contracts.decodeRows([incomplete]))).toBe(true);
  });

  it("authenticates native duplicate final patches, selection order and per-row metadata merging", async () => {
    const a = row("a"), b = row("b");
    const afterA = { ...a, title: "A", updated_at: later }, afterB = { ...b, metadata: { keep: true, nested: { new: true } }, updated_at: later };
    const activity = evidence([{ before: a, after: afterA }, { before: b, after: afterB }]);
    const input = [{ id: "b", title: "Discarded" }, { id: "a", title: "A" }, { id: "b", metadata: { remove: "", nested: { new: true } } }];
    const receipt = call(input, [afterA, afterB], [event("a"), event("b")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [afterB, afterA] }, activity);
    await refused({ ...receipt, events: [event("b"), event("a")] }, activity);
    await refused({ ...receipt, result: [afterA, { ...afterB, title: "Discarded" }] }, activity);
    await refused(receipt, evidence([{ before: a, after: afterA }, { before: b, after: { ...afterB, title: "Discarded" } }]));
    await refused(receipt, { ...activity, mutations: [...activity.mutations].reverse() });
  });

  it("retains ID-only no-ops and writes explicit empty or null metadata according to native semantics", async () => {
    const a = row("a"), b = row("b"), after = { ...b, metadata: {}, updated_at: later };
    const activity = evidence([{ before: b, after }], [a]);
    const receipt = call([{ id: "a" }, { id: "b", metadata: {} }], [a, after], [event("b")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, events: [event("a"), event("b")] }, activity);
    await refused({ ...receipt, result: [{ ...a, updated_at: later }, after] }, activity);
    const nullRow = { ...a, metadata: null, updated_at: later };
    await Effect.runPromise(policy.validateLogicalCall(call([{ id: "a", metadata: null }], [nullRow], [event("a")]), evidence([{ before: a, after: nullRow }])));
    await Effect.runPromise(policy.validateLogicalCall(call([], []), empty()));
  });

  it("authenticates full preimage results in native membership order with no read-side mutations or events", async () => {
    const a = row("a"), b = row("b"), deleted = row("deleted", { deleted_at: time });
    const activity: Activity = { ...empty(), observedRows: [a, b, deleted].map(row => ({ table: "inventory_item", row })) };
    const receipt = call({ filters: { id: ["b", "a", "b", "deleted"] }, config: {} }, [b, a], [], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [a, b] }, activity);
    await refused({ ...receipt, events: [event("a")] }, activity);
    await refused({ ...receipt, result: [b] }, activity);
    await refused({ ...receipt, commandName: "inventoryCount" }, activity);
  });

  it("refuses missing selected IDs, incomplete native rows, forged scalars and sibling activity", async () => {
    const before = row("a"), after = { ...before, title: "New", updated_at: later };
    const activity = evidence([{ before, after }]), receipt = call([{ id: "a", title: "New" }], [after], [event("a")]);
    for (const change of [{ sku: "other" }, { requires_shipping: false }, { created_at: later }, { deleted_at: time }])
      await refused(receipt, evidence([{ before, after: { ...after, ...change } }]));
    await refused({ ...receipt, input: [{ id: "a", title: "New" }, { id: "missing" }] }, activity);
    const mutation = activity.mutations[0];
    if (mutation === undefined) throw new Error("Missing patch fixture");
    await refused(receipt, { ...activity, mutations: [{ ...mutation, table: "inventory_level" }] });
    await refused(receipt, { ...activity, mutations: [{ ...mutation, operation: "insert", before: null }] });
    await refused({ ...receipt, result: [{ ...after, stocked_quantity: 0 }] }, activity);
    await refused({ ...receipt, events: [] }, activity);
  });
});
