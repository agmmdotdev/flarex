import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { inventoryCreateEventPolicy } from "../src/modules/inventory/events";

const time = "2026-10-17T00:00:00.000Z";
const row = (id: string): JsonObject => ({ id, sku: id, origin_country: null, hs_code: null, mid_code: null,
  material: null, weight: null, length: null, height: null, width: null, requires_shipping: true,
  description: null, title: null, thumbnail: null, metadata: null, created_at: time, updated_at: time, deleted_at: null });

/** This witness targets the preexisting shared receipt. The native Item→Level
 * transform uses returned ordinals, so reordered valid DTOs must refuse here. */
describe("shared Inventory Item create result authentication", () => {
  it("refuses reordered otherwise-valid native Item bodies before index-based Level association", async () => {
    const rows = [row("item-a"), row("item-b")];
    const call: Parameters<LogicalCallReceiptValidation>[0] = { commandName: "inventoryCreate", mode: "write",
      input: [{ sku: "item-a" }, { sku: "item-b" }], result: [...rows].reverse(),
      events: rows.map(value => ({ name: "inventory.inventory-item.created", metadata: { source: "inventory", object: "inventory_item", action: "created" }, data: { id: value.id ?? null } })),
      fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    const activity: Parameters<LogicalCallReceiptValidation>[1] = { observedRows: [], lifecycle: [], setNull: [], referenceReplacements: [],
      mutations: rows.map((after, ordinal) => ({ ordinal, table: "inventory_item", operation: "insert", before: null, after })) };
    expect(await Effect.runPromise(Effect.result(inventoryCreateEventPolicy().validateLogicalCall(call, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
