import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileInventoryDeletionContracts } from "../src/modules/inventory/deletion-contracts";
import { inventoryDeletionEventPolicy } from "../src/modules/inventory/deletion-events";
import { decodeInventoryItemDeletionInput, decodeInventoryItemDeletionCommandInput, decodeInventoryItemDeletionResult } from "../src/modules/inventory/delete-item-input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof inventoryDeletionEventPolicy>;
const time = "2026-10-17T00:00:00.000Z", later = "2026-10-17T00:01:00.000Z";
const row = (id: string, changes: JsonObject = {}): JsonObject => ({ id, sku: id, origin_country: null, hs_code: null, mid_code: null,
  material: null, weight: 1.25, length: null, height: null, width: 4294967296, requires_shipping: true, description: null,
  title: "Original", thumbnail: null, metadata: { keep: true }, created_at: time, updated_at: time, deleted_at: null, ...changes });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const event = (id: string, action: "deleted" | "restored"): Json => ({ name: `inventory.inventory-item.${action}`,
  metadata: { source: "inventory", object: "inventory_item", action }, data: { id } });
const call = (ids: readonly string[], result: Json, events: readonly Json[] = [], restore = false): Call => ({
  commandName: restore ? "inventoryItemRestoreForWorkflow" : "inventoryItemSoftDeleteForWorkflow", mode: "write",
  input: { selector: [...ids], config: {} }, result, events, fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const refused = async (receipt: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata());
  policy = inventoryDeletionEventPolicy(Result.getOrThrow(compileInventoryDeletionContracts(metadata.frame.tables)), "item-deletions");
});

describe("native InventoryItem deletion receipts", () => {
  it("preserves four raw duplicate IDs and authenticates only declared complete maps", () => {
    expect(Result.getOrThrow(decodeInventoryItemDeletionInput(["b", "a", "a", "missing"]))).toEqual(["b", "a", "a", "missing"]);
    expect(Result.isFailure(decodeInventoryItemDeletionInput(["a", "a", "a", "a", "a"]))).toBe(true);
    expect(Result.isFailure(decodeInventoryItemDeletionCommandInput({ selector: ["a"], config: { returnLinkableKeys: ["foreign"] } }))).toBe(true);
    for (const input of [{ foreign: [] }, { inventory_item_id: ["a"], extra: [] }, { inventory_item_id: Array.from({ length: 5 }, () => "a") },
      { inventory_level_id: Array.from({ length: 9 }, () => "a") }, { reservation_item_id: Array.from({ length: 5 }, () => "a") }])
      expect(Result.isFailure(decodeInventoryItemDeletionResult(input))).toBe(true);
  });

  it("requires exact scalar preservation, full maps and deleted event coverage", async () => {
    const before = row("a"), after = row("a", { deleted_at: later, updated_at: later });
    const evidence: Activity = { ...empty(), observedRows: [{ table: "inventory_item", row: after }],
      mutations: [{ ordinal: 0, table: "inventory_item", operation: "patch", before, after }],
      lifecycle: [{ table: "inventory_item", operation: "softDelete", key: { id: "a" }, beforeDeletedAt: null,
        afterDeletedAt: later, attemptOrdinal: 0, rowAtOperation: null }] };
    const receipt = call(["missing", "a", "a"], { inventory_item_id: ["a"] }, [event("a", "deleted")]);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: {} }, evidence); await refused({ ...receipt, events: [] }, evidence);
    await refused({ ...receipt, events: [event("a", "restored")] }, evidence);
    const mutation = evidence.mutations[0];
    if (mutation === undefined) throw new Error("Missing deletion mutation fixture");
    for (const changes of [{ width: 1 }, { metadata: {} }, { sku: "changed" }, { extra: true }])
      await refused(receipt, { ...evidence, mutations: [{ ...mutation, after: { ...after, ...changes } }] });
  });

  it("authenticates deleted and already-active restores, with unchanged native observations", async () => {
    const before = row("a", { deleted_at: time }), after = row("a", { updated_at: later }), active = row("b");
    const evidence: Activity = { ...empty(), observedRows: [{ table: "inventory_item", row: after }],
      mutations: [{ ordinal: 0, table: "inventory_item", operation: "patch", before, after }], lifecycle: [
        { table: "inventory_item", operation: "restore", key: { id: "a" }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
        { table: "inventory_item", operation: "restore", key: { id: "b" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
      ] };
    const receipt = call(["b", "a", "missing"], { inventory_item_id: ["a", "b"] }, [event("a", "restored"), event("b", "restored")], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
    await refused({ ...receipt, events: [event("a", "restored")] }, evidence);
  });

  it("authenticates generated map order against issued lifecycle evidence without inventing a global sort", async () => {
    // Deliberately nonlexical issued order proves that array authentication
    // follows the real lifecycle, rather than sorting or comparing sets.
    const ids = ["z", "a"], before = ids.map(id => row(id)), after = ids.map(id => row(id, { deleted_at: later, updated_at: later }));
    const evidence: Activity = { ...empty(), observedRows: after.map(value => ({ table: "inventory_item", row: value })),
      mutations: ids.map((_, ordinal) => ({ ordinal, table: "inventory_item", operation: "patch", before: before[ordinal]!, after: after[ordinal]! })),
      lifecycle: ids.map((id, ordinal) => ({ table: "inventory_item", operation: "softDelete", key: { id }, beforeDeletedAt: null,
        afterDeletedAt: later, attemptOrdinal: ordinal, rowAtOperation: null })) };
    const receipt = call(ids, { inventory_item_id: ids }, ids.map(id => event(id, "deleted")));
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: { inventory_item_id: ["a", "z"] } }, evidence);
    await refused({ ...receipt, result: { inventory_item_id: ["z", "z"] } }, evidence);
    await refused({ ...receipt, result: { inventory_item_id: ["z"] } }, evidence);
  });

  it("retains empty, missing and already-deleted selection maps", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([], {}), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"], {}), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["deleted"], {}), { ...empty(), observedRows: [
      { table: "inventory_item", row: row("deleted", { deleted_at: time }) },
    ] }));
  });
});
