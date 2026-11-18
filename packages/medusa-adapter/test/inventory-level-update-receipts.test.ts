import { compileInventoryLevelContracts } from "../src/modules/inventory/level-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { decodeInventoryLevelUpdates } from "../src/modules/inventory/update-level-input";
import { inventoryLevelUpdateEventPolicy } from "../src/modules/inventory/update-level-events";
import { inventoryQuantityProjection } from "../src/modules/inventory/quantity-repository";
import { captureExactNumericRow } from "../src/value/exact-numeric";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof inventoryLevelUpdateEventPolicy>;
let contracts: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
let project: ReturnType<typeof inventoryQuantityProjection>;
const time = "2026-10-16T00:00:00.000Z", later = "2026-10-16T00:01:00.000Z";
const tuple = (id: string) => ({ inventory_item_id: "item-" + id, location_id: "location-" + id });
const row = (id: string, changes: JsonObject = {}) => Effect.runPromise(captureExactNumericRow({ id, ...tuple(id),
  stocked_quantity: 5, reserved_quantity: 2, incoming_quantity: 0, metadata: { keep: true },
  created_at: time, updated_at: time, deleted_at: null, ...changes }, contracts.numeric, true));
const dto = async (row: JsonObject): Promise<JsonObject> => {
  const value = await Effect.runPromise(project(row));
  if (!isJsonObject(value)) throw new Error("Missing projected InventoryLevel DTO");
  return value;
};
const event = (id: string): Json => ({ name: "inventory.inventory-level.updated",
  metadata: { source: "inventory", object: "inventory_level", action: "updated" }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (input: Json, result: Json, events: readonly Json[] = [], read = false): Call => ({
  commandName: read ? "inventoryLevelListForUpdate" : "inventoryLevelUpdateForWorkflow", mode: read ? "read" : "write", input, result, events,
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const evidence = (pairs: readonly Readonly<{ before: JsonObject; after: JsonObject }>[], unchanged: readonly JsonObject[] = []): Activity => ({
  ...empty(), observedRows: [...pairs.map(pair => pair.after), ...unchanged].map(row => ({ table: "inventory_level", row })),
  mutations: pairs.map((pair, ordinal) => ({ ordinal, table: "inventory_level", operation: "patch", ...pair })),
});
const refused = async (receipt: Call, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata()), table = metadata.frame.tables.find(table => table.name === "inventory_level");
  if (table === undefined) throw new Error("Missing InventoryLevel DML");
  contracts = Result.getOrThrow(compileInventoryLevelContracts(table));
  policy = inventoryLevelUpdateEventPolicy(contracts); project = inventoryQuantityProjection(table.columns);
});

describe("native InventoryLevel absolute update receipts", () => {
  it("retains zero-four raw entries and finite quantities without granting reserved, metadata or managed fields", () => {
    for (const input of [[], [tuple("a")], [{ ...tuple("a"), id: "a", stocked_quantity: -1.25, incoming_quantity: 1e30 }],
      [{ ...tuple("b"), stocked_quantity: 0 }, tuple("a"), { ...tuple("b"), incoming_quantity: -2 }]])
      expect(Result.getOrThrow(decodeInventoryLevelUpdates(input))).toEqual(input);
    for (const input of [[{ inventory_item_id: "item" }], [{ ...tuple("a"), id: "" }], [{ ...tuple("a"), reserved_quantity: 0 }],
      [{ ...tuple("a"), metadata: {} }], [{ ...tuple("a"), stocked_quantity: "1" }], [{ ...tuple("a"), incoming_quantity: null }],
      [{ ...tuple("a"), stocked_quantity: NaN }], [{ ...tuple("a"), stocked_quantity: Infinity }],
      [{ ...tuple("a"), raw_stocked_quantity: { value: "1", precision: 20 } }], [{ ...tuple("a"), updated_at: later }],
      Array.from({ length: 5 }, (_, index) => tuple(String(index)))]) expect(Result.isFailure(decodeInventoryLevelUpdates(input))).toBe(true);
  });

  it("requires complete exact storage companions and authenticates full numeric DTOs with optional raw transport fields", async () => {
    const stored = await row("a"), output = await dto(stored);
    await Effect.runPromise(contracts.decodeStoredRow(stored));
    expect(await Effect.runPromise(contracts.matchesResult(stored, output))).toBe(true);
    const withoutRaw = Object.fromEntries(Object.entries(output).filter(([field]) => !field.startsWith("raw_")));
    expect(await Effect.runPromise(contracts.matchesResult(stored, withoutRaw))).toBe(true);
    const missing = { ...stored }; delete missing.raw_stocked_quantity;
    await expect(Effect.runPromise(contracts.decodeStoredRow(missing))).rejects.toMatchObject({ reason: "storedCorruption" });
    await expect(Effect.runPromise(contracts.decodeStoredRow({ ...stored, raw_stocked_quantity: { value: "6", precision: 20 } })))
      .rejects.toMatchObject({ reason: "storedCorruption" });
    expect(Result.isFailure(contracts.decodeRow({ ...withoutRaw, available_quantity: "3" }))).toBe(true);
    expect(await Effect.runPromise(contracts.matchesResult(stored, { ...withoutRaw, available_quantity: 4 }))).toBe(false);
    expect(await Effect.runPromise(contracts.matchesResult(stored, { ...withoutRaw, reserved_quantity: 0 }))).toBe(false);
  });

  it("authenticates pair-list preimages in native default ID order and refuses hidden rows or read effects", async () => {
    const a = await row("a"), b = await row("b"), receipt = call({ filters: { $or: [tuple("b"), tuple("a"), tuple("b")] }, config: {} },
      [await dto(a), await dto(b)], [], true);
    const activity: Activity = { ...empty(), observedRows: [b, a].map(row => ({ table: "inventory_level", row })) };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [await dto(b), await dto(a)] }, activity);
    await refused({ ...receipt, result: [await dto(a)] }, activity);
    await refused({ ...receipt, events: [event("a")] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "inventory_level", row: await row("foreign") }] });
    await Effect.runPromise(policy.validateLogicalCall(call({ filters: { $or: [] }, config: {} }, [], [], true), empty()));
  });

  it("requires a genuine tuple-only write and event, preserving direct scalar and array results", async () => {
    const before = await row("a"), after = { ...before, updated_at: later }, result = await dto(after);
    const activity = evidence([{ before, after }]), receipt = call([tuple("a")], [result], [event("a")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await Effect.runPromise(policy.validateLogicalCall(call({ ...tuple("a"), id: "a" }, result, [event("a")]), activity));
    await refused({ ...receipt, events: [] }, activity);
    await refused(receipt, evidence([], [before]));
    await refused({ ...receipt, result }, activity);
    await Effect.runPromise(policy.validateLogicalCall(call([], []), empty()));
  });

  it("authenticates native last-patch selection, requested order, negative availability and unchanged reservations", async () => {
    const a = await row("a"), b = await row("b"), afterA = await row("a", { stocked_quantity: 1.25, updated_at: later }),
      afterB = await row("b", { incoming_quantity: -2, updated_at: later });
    const input = [{ ...tuple("b"), stocked_quantity: 99 }, { ...tuple("a"), id: "a", stocked_quantity: 1.25 }, { ...tuple("b"), incoming_quantity: -2 }];
    const result = [await dto(afterA), await dto(afterB)], activity = evidence([{ before: a, after: afterA }, { before: b, after: afterB }]);
    const receipt = call(input, result, [event("a"), event("b")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    expect(result[0]).toMatchObject({ stocked_quantity: 1.25, reserved_quantity: 2, available_quantity: -0.75 });
    expect(result[1]).toMatchObject({ stocked_quantity: 5, incoming_quantity: -2, reserved_quantity: 2 });
    await refused({ ...receipt, result: [...result].reverse() }, activity);
    await refused({ ...receipt, events: [event("b"), event("a")] }, activity);
    await refused(receipt, evidence([{ before: a, after: afterA }, { before: b, after: await row("b", { stocked_quantity: 99, incoming_quantity: -2, updated_at: later }) }]));
    await refused(receipt, { ...activity, mutations: [...activity.mutations].reverse() });
  });

  it("requires pair validation before caller-ID selection and refuses missing or unrelated observations", async () => {
    const a = await row("a"), foreign = await row("foreign"), after = { ...a, updated_at: later }, activity = evidence([{ before: a, after }]);
    const receipt = call([{ ...tuple("a"), id: "a" }], [await dto(after)], [event("a")]);
    await refused({ ...receipt, input: [{ ...tuple("missing"), id: "a" }] }, activity);
    await refused({ ...receipt, input: [{ ...tuple("a"), id: "missing" }] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "inventory_level", row: foreign }] });
    const extra = await Promise.all(Array.from({ length: 9 }, (_, index) => row("extra-" + index)));
    await refused(receipt, { ...activity, observedRows: extra.map(row => ({ table: "inventory_level", row })) });
  });

  it("refuses forged preserved scalars, raw values, lifecycle and sibling-table changes", async () => {
    const before = await row("a"), after = await row("a", { stocked_quantity: -1.25, incoming_quantity: 1e30, updated_at: later });
    const activity = evidence([{ before, after }]), receipt = call([{ ...tuple("a"), stocked_quantity: -1.25, incoming_quantity: 1e30 }], [await dto(after)], [event("a")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    for (const change of [{ reserved_quantity: 3, raw_reserved_quantity: { value: "3", precision: 20 } }, { metadata: {} }, { created_at: later },
      { inventory_item_id: "other" }, { location_id: "other" }, { deleted_at: time }])
      await refused(receipt, evidence([{ before, after: { ...after, ...change } }]));
    const mutation = activity.mutations[0]; if (mutation === undefined) throw new Error("Missing Level patch fixture");
    await refused(receipt, { ...activity, mutations: [{ ...mutation, table: "inventory_item" }] });
    await refused(receipt, { ...activity, mutations: [{ ...mutation, operation: "insert", before: null }] });
    await refused({ ...receipt, events: [event("foreign")] }, activity);
    await refused({ ...receipt, result: [{ ...after, available_quantity: -3.25 }] }, activity);
  });
});
