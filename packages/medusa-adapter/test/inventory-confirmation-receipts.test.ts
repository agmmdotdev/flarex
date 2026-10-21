import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { makeInventoryConfirmationCommands } from "../src/modules/inventory/confirmation-service";
import { workflowModuleDefinition } from "../src/workflow/module";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let runtime: Effect.Success<ReturnType<typeof makeInventoryConfirmationCommands>>;
const time = "2026-10-22T00:00:00.000Z";
const item = (): JsonObject => ({ ...runtime.contracts.itemContracts.creationDefaults,
  id: "item", created_at: time, updated_at: time, deleted_at: null });
const level = (id: string, location: string, stocked: string, reserved: string): JsonObject => ({
  id, inventory_item_id: "item", location_id: location, stocked_quantity: stocked, reserved_quantity: reserved, incoming_quantity: "0",
  raw_stocked_quantity: { value: stocked, precision: 20 }, raw_reserved_quantity: { value: reserved, precision: 20 },
  raw_incoming_quantity: { value: "0", precision: 20 }, metadata: null, created_at: time, updated_at: time, deleted_at: null,
});
const call = (locations: readonly string[] = ["a", "b"], quantity = "3", result = true): Call => ({
  commandName: "inventoryConfirmForWorkflow", mode: "read", input: { inventory_item_id: "item", location_ids: locations, quantity }, result, events: [],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const evidence = (rows: readonly JsonObject[] = [level("level_a", "a", "3", "1"), level("level_b", "b", "2", "1")]): Activity => ({ ...empty(),
  observedRows: [{ table: "inventory_item", row: { ...item(), _id: "item-incarnation", _creationTime: 1 } },
    ...rows.map(row => ({ table: "inventory_level", row: { ...row, _id: "private-" + row.id, _creationTime: 1 } }))],
  relationalReads: [
    { table: "inventory_item", query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "id", values: ["item"] }] },
        { kind: "isNull", column: "deleted_at" }] } }, total: 1, returned: 1 },
    { table: "inventory_level", query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" }, includeIdentities: true,
      predicate: { kind: "and", children: [{ kind: "in", column: "location_id", values: ["a", "b"] },
        { kind: "in", column: "inventory_item_id", values: ["item"] }, { kind: "isNull", column: "deleted_at" }] } },
      total: rows.length, returned: rows.length, orderedIdentities: rows.map(row => ({ id: String(row.id) })) },
  ],
});
const validate = (receipt: Call, activity: Activity, command: CommerceCommand = runtime.confirm) => {
  const policy = workflowModuleDefinition(runtime.workflow)?.logical;
  if (policy === undefined) throw new Error("Missing native confirmation policy");
  return policy.validateLogicalCall(receipt, activity, command);
};
const refused = async (receipt: Call, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(validate(receipt, activity)))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => { runtime = await Effect.runPromise(makeInventoryConfirmationCommands()); });

describe("native Inventory confirmation receipts", () => {
  it("binds aggregate availability and both boolean results to selected exact quantities", async () => {
    await Effect.runPromise(validate(call(), evidence()));
    await Effect.runPromise(validate(call(["a", "b", "a"], "3", true), evidence()));
    await Effect.runPromise(validate(call(["a", "b"], "3.0001", false), evidence()));
    await Effect.runPromise(validate(call(["a", "b"], "3", true), { ...evidence(), observedRows: [...evidence().observedRows].reverse() }));
    await refused(call(["a", "b"], "3", false), evidence());
    await refused(call(["a", "b"], "3.0001", true), evidence());
    await refused({ ...call(), result: "true" }, evidence());
    await Effect.runPromise(validate(call(["a", "b"], "0", true), evidence([])));
    await Effect.runPromise(validate(call(["a", "b"], "0.1", false), evidence([])));
  });

  it("retains zero reads for the genuine empty-Location branch, even with a missing Item", async () => {
    for (const [quantity, result] of [["-1", true], ["0", true], ["0.1", false]] as const) {
      const receipt = { ...call([], quantity, result), input: { inventory_item_id: "missing", location_ids: [], quantity } };
      await Effect.runPromise(validate(receipt, empty()));
      await refused(receipt, evidence());
      await refused({ ...receipt, result: !result }, empty());
    }
    await refused(call(), empty());
  });

  it("requires complete Item and Level membership, active rows, exact raw pairs and selected IDs", async () => {
    const original = evidence(), first = original.relationalReads[0], selected = original.relationalReads[1];
    if (first === undefined || selected === undefined) throw new Error("Missing native Item/Level read");
    await refused(call(), { ...original, observedRows: original.observedRows.slice(1) });
    await refused(call(), { ...original, observedRows: original.observedRows.slice(0, -1) });
    await refused(call(), { ...original, observedRows: [...original.observedRows, ...original.observedRows] });
    for (const change of [{ inventory_item_id: "outside" }, { location_id: "outside" }, { deleted_at: time },
      { raw_stocked_quantity: { value: "99", precision: 20 } }, { extra: true }]) {
      const rows = [level("level_a", "a", "3", "1"), { ...level("level_b", "b", "2", "1"), ...change }];
      await refused(call(), evidence(rows));
    }
    for (const change of [{ total: 3 }, { returned: 1 }, { orderedIdentities: [{ id: "level_b" }, { id: "level_a" }] },
      { orderedIdentities: [{ id: "level_a" }, { id: "outside" }] }, { query: {} }, { table: "reservation_item" }])
      await refused(call(), { ...original, relationalReads: [first, { ...selected, ...change }] });
    await refused(call(), { ...original, relationalReads: [...original.relationalReads, selected] });
    const incomplete = { ...item() }; delete incomplete.title;
    await refused(call(), { ...original, observedRows: [{ table: "inventory_item", row: incomplete }, ...original.observedRows.slice(1)] });
  });

  it("refuses forged command identity, widened selection and all writes or events", async () => {
    const lookalike = defineCommerceCommand("inventoryConfirmForWorkflow", "read", () => Effect.succeed(true));
    expect(await Effect.runPromise(Effect.result(validate(call(), evidence(), lookalike))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    await refused({ ...call(), events: [{ forged: true }] }, evidence());
    await refused({ ...call(), input: { inventory_item_id: "outside", location_ids: ["a", "b"], quantity: "3" } }, evidence());
    await refused({ ...call(), input: { inventory_item_id: "item", location_ids: ["a"], quantity: "3" } }, evidence());
    await refused(call(), { ...evidence(), mutations: [{ ordinal: 0, table: "inventory_level", operation: "patch", before: null, after: null }] });
    await refused(call(), { ...evidence(), lifecycle: [{ table: "inventory_item", operation: "restore", key: { id: "item" },
      beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: item() }] });
    await refused(call(), { ...evidence(), setNull: [{ sourceTable: "inventory_level", sourceColumn: "inventory_item_id", targetTable: "inventory_item", targetColumn: "id", targetKey: "item", managedUpdate: "advance" }] });
    await refused(call(), { ...evidence(), referenceReplacements: [{ sourceTable: "inventory_level", sourceColumn: "inventory_item_id", targetTable: "inventory_item", targetColumn: "id", targetKey: "item", desiredKeys: [] }] });
  });
});
