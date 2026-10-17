import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileInventoryLevelContracts } from "../src/modules/inventory/level-contracts";
import { inventoryLevelBatchEventPolicy } from "../src/modules/inventory/batch-level-events";
import { decodeInventoryLevelPhysicalDeletionIds } from "../src/modules/inventory/level-lifecycle";
import { inventoryQuantityProjection } from "../src/modules/inventory/quantity-repository";
import { captureExactNumericRow } from "../src/value/exact-numeric";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
let policy: ReturnType<typeof inventoryLevelBatchEventPolicy>;
const time = "2026-10-17T00:00:00.000Z";
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const event = (id: string, action: "created" | "updated" | "deleted" | "restored"): Json => ({
  name: `inventory.inventory-level.${action}`, metadata: { source: "inventory", object: "inventory_level", action }, data: { id },
});
const stored = (id: string, changes: JsonObject = {}) => Effect.runPromise(captureExactNumericRow({ id,
  inventory_item_id: "item-" + id, location_id: "location-" + id, stocked_quantity: 0, reserved_quantity: 0, incoming_quantity: 0,
  metadata: null, created_at: time, updated_at: time, deleted_at: null, ...changes }, contracts.numeric, true));
const call = (input: Json, result: Json, events: readonly Json[] = [], commandName = "inventoryLevelPhysicalDeleteForWorkflow"): Call => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const physical = (rows: readonly JsonObject[]): Activity => ({ ...empty(), observedRows: rows.map(row => ({ table: "inventory_level", row })),
  mutations: rows.map((row, ordinal) => ({ ordinal, table: "inventory_level", operation: "delete", before: row, after: null })) });
const refused = async (receipt: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata()), table = metadata.frame.tables.find(table => table.name === "inventory_level");
  if (table === undefined) throw new Error("Missing InventoryLevel DML");
  contracts = Result.getOrThrow(compileInventoryLevelContracts(table)); policy = inventoryLevelBatchEventPolicy(contracts);
});

describe("native Inventory Level batch receipts", () => {
  it("retains distinct eight-create/physical and four-update bounds", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => "l" + index), rows: JsonObject[] = [];
    for (const id of ids) {
      const dto = await Effect.runPromise(inventoryQuantityProjection(contracts.numeric)(await stored(id)));
      if (!isJsonObject(dto)) throw new Error("Expected Level DTO"); rows.push(dto);
    }
    expect(Result.isSuccess(contracts.decodeCreatedRows(rows))).toBe(true);
    expect(Result.isFailure(contracts.decodeRows(rows))).toBe(true);
    expect(Result.isFailure(contracts.decodeCreatedRows([...rows, rows[0]]))).toBe(true);
    expect(Result.getOrThrow(decodeInventoryLevelPhysicalDeletionIds(ids))).toEqual(ids);
    expect(Result.getOrThrow(decodeInventoryLevelPhysicalDeletionIds(["a", "a", "missing"]))).toEqual(["a", "a", "missing"]);
    for (const input of ["a", [""], [...ids, "overflow"], { id: ["a"] }])
      expect(Result.isFailure(decodeInventoryLevelPhysicalDeletionIds(input))).toBe(true);
  });

  it("authenticates eight physical removals and actual deleted events without inventing quantity guards", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => "l" + index), rows: JsonObject[] = [];
    for (const [index, id] of ids.entries()) rows.push(await stored(id, {
      stocked_quantity: 5.125, reserved_quantity: 3.25, incoming_quantity: 8.75, metadata: { keep: true }, deleted_at: index % 2 ? time : null,
    }));
    const receipt = call(ids, null, ids.map(id => event(id, "deleted"))), activity = physical(rows);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: ids }, activity);
    await refused({ ...receipt, events: receipt.events.slice(1) }, activity);
    await refused({ ...receipt, events: [...receipt.events].reverse() }, activity);
    await refused({ ...receipt, events: [...receipt.events, event("extra", "deleted")] }, activity);
    await refused({ ...receipt, events: ids.map(id => event(id, "restored")) }, activity);
    await refused(receipt, { ...activity, mutations: activity.mutations.slice(1) });
  });

  it("distinguishes physical removal from managed soft deletion even though both emit deleted", async () => {
    const before = await stored("l"), receipt = call(["l"], null, [event("l", "deleted")]), activity = physical([before]);
    const mutation = activity.mutations[0];
    if (mutation === undefined) throw new Error("Missing physical mutation");
    await refused(receipt, { ...activity, mutations: [{ ...mutation, operation: "patch", after: { ...before, deleted_at: time } }] });
    await refused(receipt, { ...activity, mutations: [{ ...mutation, before: null }] });
    await refused(receipt, { ...activity, mutations: [{ ...mutation, ordinal: 1 }] });
    await refused(receipt, { ...activity, lifecycle: [{ table: "inventory_level", operation: "softDelete", key: { id: "l" },
      beforeDeletedAt: null, afterDeletedAt: time, attemptOrdinal: 0, rowAtOperation: null }] });
    await refused({ ...receipt, commandName: "inventoryLevelSoftDeleteForWorkflow" }, activity);
    await refused({ ...receipt, commandName: "inventoryPhysicalDeleteItems" }, activity);
    await refused({ ...receipt, mode: "read" }, activity);
  });

  it("refuses invented deletion identities, foreign effects and incomplete numeric companions", async () => {
    const before = await stored("l"), receipt = call(["l", "missing", "l"], null, [event("l", "deleted")]), activity = physical([before]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, input: ["outside"] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "inventory_item", row: before }] });
    await refused(receipt, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, table: "reservation_item" })) });
    const incomplete = { ...before }; delete incomplete.raw_incoming_quantity;
    await refused(receipt, physical([incomplete]));
    await refused(receipt, physical([{ ...before, raw_reserved_quantity: { value: "9", precision: 20 } }]));
    await refused(receipt, physical([{ ...before, unknown: true }]));
    await refused(receipt, { ...activity, mutations: [...activity.mutations, { ordinal: 1, table: "inventory_level", operation: "delete", before, after: null }] });
  });

  it("retains missing and empty physical inverses without invented result IDs or events", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([], null), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"], null), empty()));
    await refused(call(["missing"], null, [event("missing", "deleted")]), empty());
    await refused(call([], []), empty());
    const before = await stored("not-deleted");
    await refused(call(["not-deleted"], null), { ...empty(), observedRows: [{ table: "inventory_level", row: before }] });
  });

  it("authenticates full create DTOs in native order and exact generated quantity defaults", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => "new" + index), rows: JsonObject[] = [], results: JsonObject[] = [], inputs: JsonObject[] = [];
    for (const [index, id] of ids.entries()) {
      const input = { inventory_item_id: "item-" + id, location_id: "unregistered-location-" + id,
        ...(index % 2 ? {} : { stocked_quantity: -1.25, incoming_quantity: 2.125 }) };
      inputs.push(input);
      const row = await stored(id, input); rows.push(row);
      const dto = await Effect.runPromise(inventoryQuantityProjection(contracts.numeric)(row));
      if (!isJsonObject(dto)) throw new Error("Expected complete created DTO"); results.push(dto);
    }
    const receipt = call(inputs, results, ids.map(id => event(id, "created")), "inventoryCreateLevels");
    const activity: Activity = { ...empty(), mutations: rows.map((after, ordinal) => ({ ordinal, table: "inventory_level", operation: "insert", before: null, after })) };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [...results].reverse() }, activity);
    const result = results[0], mutation = activity.mutations[0];
    if (result === undefined || mutation === undefined || mutation.after === null) throw new Error("Missing create fixture");
    for (const changes of [{ stocked_quantity: 77 }, { available_quantity: 77 }, { metadata: { forged: true } }, { unknown: true }])
      await refused({ ...receipt, result: [{ ...result, ...changes }, ...results.slice(1)] }, activity);
    const incomplete = { ...result }; delete incomplete.location_id;
    await refused({ ...receipt, result: [incomplete, ...results.slice(1)] }, activity);
    await refused(receipt, { ...activity, mutations: [{ ...mutation, after: { ...mutation.after, metadata: { forged: true } } }, ...activity.mutations.slice(1)] });
    await Effect.runPromise(policy.validateLogicalCall(call([], [], [], "inventoryCreateLevels"), empty()));
  });
});
