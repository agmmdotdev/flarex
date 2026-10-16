import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileInventoryLevelContracts } from "../src/modules/inventory/level-contracts";
import { inventoryLevelDeletionEventPolicy } from "../src/modules/inventory/delete-level-events";
import { decodeInventoryLevelDeletionIds, decodeInventoryLevelDeletionReadInput, decodeInventoryLevelDeletionResult } from "../src/modules/inventory/delete-level-input";
import { inventoryQuantityProjection } from "../src/modules/inventory/quantity-repository";
import { captureExactNumericRow } from "../src/value/exact-numeric";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
let policy: ReturnType<typeof inventoryLevelDeletionEventPolicy>;
const time = "2026-10-16T00:00:00.000Z", later = "2026-10-16T00:01:00.000Z";
const row = (id: string, changes: JsonObject = {}) => Effect.runPromise(captureExactNumericRow({ id,
  inventory_item_id: "item-" + id, location_id: "location-" + id, stocked_quantity: 0, reserved_quantity: 0, incoming_quantity: 1.25,
  metadata: { keep: true }, created_at: time, updated_at: time, deleted_at: null, ...changes }, contracts.numeric, true));
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string, action: "deleted" | "restored"): Json => ({ name: `inventory.inventory-level.${action}`,
  metadata: { source: "inventory", object: "inventory_level", action }, data: { id } });
const call = (input: Json, result: Json, events: readonly Json[] = [], restore = false): Call => ({
  commandName: restore ? "inventoryLevelRestoreForWorkflow" : "inventoryLevelSoftDeleteForWorkflow", mode: "write", input, result, events,
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const deletion = async (ids: readonly string[]): Promise<Activity> => {
  const before = await Promise.all(ids.map(id => row(id))), after = before.map(value => ({ ...value, deleted_at: later, updated_at: later }));
  return { ...empty(), observedRows: after.map(row => ({ table: "inventory_level", row })),
    mutations: after.map((row, ordinal) => ({ ordinal, table: "inventory_level", operation: "patch", before: before[ordinal] ?? null, after: row })),
    lifecycle: ids.map((id, attemptOrdinal) => ({ table: "inventory_level", operation: "softDelete", key: { id }, beforeDeletedAt: null,
      afterDeletedAt: later, attemptOrdinal, rowAtOperation: null })) };
};
const refused = async (receipt: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata()), table = metadata.frame.tables.find(table => table.name === "inventory_level");
  if (table === undefined) throw new Error("Missing InventoryLevel DML");
  contracts = Result.getOrThrow(compileInventoryLevelContracts(table)); policy = inventoryLevelDeletionEventPolicy(contracts);
});

describe("native InventoryLevel deletion receipts", () => {
  it("bounds raw selectors and rejects unsupported filter/config grammar and invented map keys", () => {
    for (const filters of [{}, { id: [] }, { id: ["b", "a", "b", "missing"] }, { inventory_item_id: "item", location_id: ["a", "b"] },
      { $or: [{ inventory_item_id: "item", location_id: "location" }] }])
      expect(Result.getOrThrow(decodeInventoryLevelDeletionReadInput({ filters }))).toEqual({ filters });
    for (const filters of [{ id: ["a", "a", "a", "a", "a"] }, { reserved_quantity: 0 }, { id: { $in: ["a"] } },
      { $or: [{ id: "a" }] }, { $or: Array.from({ length: 5 }, () => ({ inventory_item_id: "item", location_id: "location" })) }])
      expect(Result.isFailure(decodeInventoryLevelDeletionReadInput({ filters }))).toBe(true);
    for (const config of [{ skip: 1 }, { order: { id: "DESC" } }, { select: ["stocked_quantity"] }, { relations: ["inventory_item"] }])
      expect(Result.isFailure(decodeInventoryLevelDeletionReadInput({ config }))).toBe(true);
    expect(Result.getOrThrow(decodeInventoryLevelDeletionIds(["b", "a", "a", "missing"]))).toEqual(["b", "a", "a", "missing"]);
    expect(Result.isFailure(decodeInventoryLevelDeletionIds(["a", "a", "a", "a", "a"]))).toBe(true);
    for (const input of [{ inventory_item_id: ["a"] }, { inventory_level_id: [] }, { inventory_level_id: ["a"], extra: [] }])
      expect(Result.isFailure(decodeInventoryLevelDeletionResult(input))).toBe(true);
  });

  it("authenticates native selected-field listAndCount rows with exact companion evidence and native ID ordering", async () => {
    const a = await row("a"), b = await row("b"), select = ["id", "stocked_quantity", "reserved_quantity", "location_id"];
    const project = inventoryQuantityProjection(contracts.numeric), output: JsonObject[] = [];
    for (const value of [b, a]) {
      const selected = Object.fromEntries(Object.entries(value).filter(([field]) => select.includes(field) || ["raw_stocked_quantity", "raw_reserved_quantity"].includes(field)));
      const projected = await Effect.runPromise(project(selected));
      if (!isJsonObject(projected)) throw new Error("Missing projected Level"); output.push(projected);
    }
    const receipt: Call = { ...call({ filters: { id: ["b", "a", "b"] }, config: { select, skip: 0, take: 256, order: { id: "ASC" }, relations: [] } }, [output, 2]),
      commandName: "inventoryLevelCountForDeletion", mode: "read" };
    const evidence: Activity = { ...empty(), observedRows: [a, b].map(row => ({ table: "inventory_level", row })) };
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    expect(output.every(value => value.incoming_quantity === undefined)).toBe(true);
    await refused({ ...receipt, result: [[...output].reverse(), 2] }, evidence);
    await refused({ ...receipt, result: [output, 1] }, evidence);
    await refused({ ...receipt, result: [output.slice(0, 1), 2] }, evidence);
    await refused({ ...receipt, events: [event("a", "deleted")] }, evidence);
    await refused(receipt, { ...evidence, observedRows: [...evidence.observedRows, { table: "inventory_level", row: await row("foreign") }] });
  });

  it("separates authenticated scalar candidates from the complete native AND selector", async () => {
    const a = await row("a"), b = await row("b"), project = inventoryQuantityProjection(contracts.numeric);
    const projected = await Effect.runPromise(project(a));
    if (!isJsonObject(projected)) throw new Error("Missing Level DTO");
    const receipt: Call = { ...call({ filters: { id: ["a", "b"], inventory_item_id: "item-a", location_id: "location-a" } }, [[projected], 1]),
      commandName: "inventoryLevelCountForDeletion", mode: "read" };
    const evidence: Activity = { ...empty(), observedRows: [a, b].map(row => ({ table: "inventory_level", row })) };
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    const other = await Effect.runPromise(project(b));
    if (!isJsonObject(other)) throw new Error("Missing nonmatching Level DTO");
    for (const result of [[[other], 1], [[projected, other], 2], [[], 0], [[projected], 2]])
      await refused({ ...receipt, result }, evidence);
    await refused(receipt, { ...evidence, observedRows: [...evidence.observedRows, { table: "inventory_level", row: await row("foreign") }] });
    await refused(receipt, { ...evidence, observedRows: [{ table: "reservation_item", row: b }, { table: "inventory_level", row: a }] });
    const corrupted = { ...b }; delete corrupted.raw_incoming_quantity;
    await refused(receipt, { ...evidence, observedRows: [{ table: "inventory_level", row: a }, { table: "inventory_level", row: corrupted }] });
    const excessive = await Promise.all(["a", "b", "c", "d", "e"].map(id => row(id)));
    await refused({ ...receipt, input: { filters: {} } }, { ...empty(), observedRows: excessive.map(row => ({ table: "inventory_level", row })) });
  });
  it("requires complete lifecycle facts, selected result maps and exact deleted events while preserving incoming quantities", async () => {
    const evidence = await deletion(["a", "b"]), receipt = call(["b", "a", "a", "missing"], { inventory_level_id: ["a", "b"] },
      [event("a", "deleted"), event("b", "deleted")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    for (const result of [{}, { inventory_level_id: ["b", "a"] }, { inventory_level_id: ["a", "b", "missing"] }]) await refused({ ...receipt, result }, evidence);
    await refused({ ...receipt, events: [event("a", "deleted")] }, evidence);
    await refused({ ...receipt, events: [event("b", "deleted"), event("a", "deleted")] }, evidence);
    await refused({ ...receipt, events: [event("a", "restored"), event("b", "restored")] }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.slice(0, 1) });
    const mutation = evidence.mutations[0]; if (mutation?.after === null || mutation?.after === undefined) throw new Error("Missing Level deletion fixture");
    for (const changes of [{ incoming_quantity: "2", raw_incoming_quantity: { value: "2", precision: 20 } }, { metadata: {} }, { location_id: "foreign" },
      { inventory_item_id: "foreign" }, { raw_stocked_quantity: { value: "9", precision: 20 } }, { extra: true }])
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...mutation.after, ...changes } }, ...evidence.mutations.slice(1)] });
    await refused(receipt, { ...evidence, observedRows: [{ table: "reservation_item", row: mutation.after }] });
  });

  it("retains native empty/missing/deleted maps and authenticates changed plus already-active restore facts", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([], {}), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"], {}), empty()));
    const deleted = await row("deleted", { deleted_at: time });
    await Effect.runPromise(policy.validateLogicalCall(call(["deleted"], {}), { ...empty(), observedRows: [{ table: "inventory_level", row: deleted }] }));
    const before = await row("a", { deleted_at: time }), after = { ...before, deleted_at: null, updated_at: later }, active = await row("b");
    const evidence: Activity = { ...empty(), observedRows: [{ table: "inventory_level", row: after }],
      mutations: [{ ordinal: 0, table: "inventory_level", operation: "patch", before, after }], lifecycle: [
        { table: "inventory_level", operation: "restore", key: { id: "a" }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
        { table: "inventory_level", operation: "restore", key: { id: "b" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
      ] };
    const receipt = call(["b", "a", "missing"], { inventory_level_id: ["a", "b"] }, [event("a", "restored"), event("b", "restored")], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
    await refused({ ...receipt, events: [event("a", "restored")] }, evidence);
  });
});
