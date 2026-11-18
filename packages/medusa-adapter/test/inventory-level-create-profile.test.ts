import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import type { makeInventoryLevelCreationCommands } from "../src/modules/inventory/create-level-service";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileInventoryLevelContracts } from "../src/modules/inventory/level-contracts";
import { inventoryLevelCreationEventPolicy } from "../src/modules/inventory/level-creation-events";
import { inventoryLevelBatchEventPolicy } from "../src/modules/inventory/batch-level-events";
import { captureExactNumericRow } from "../src/value/exact-numeric";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

let prepared: Effect.Success<ReturnType<typeof makeInventoryLevelCreationCommands>>;
let policy: ReturnType<typeof inventoryLevelCreationEventPolicy>;
let contracts: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
const empty = (): Parameters<LogicalCallReceiptValidation>[1] => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (commandName: string): Parameters<LogicalCallReceiptValidation>[0] => ({ commandName, mode: "write", input: [], result: [], events: [],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });

describe("native standalone Level creation profile", () => {
  beforeAll(async () => {
    prepared = await Effect.runPromise(makeLocalInventoryCommands("level-creations"));
    const metadata = await Effect.runPromise(captureInventoryMetadata()), table = metadata.frame.tables.find(table => table.name === "inventory_level");
    if (table === undefined) throw new Error("Missing native Level model");
    contracts = Result.getOrThrow(compileInventoryLevelContracts(table));
    policy = inventoryLevelCreationEventPolicy(contracts);
  });

  it("exposes exactly creation and the retained physical inverse without Inventory graph reads", () => {
    const definition = workflowModuleDefinition(prepared.workflow);
    expect(definition?.source).toEqual({ name: "flarex-inventory-local", profile: "inventory-level-creations" });
    expect(definition?.graph).toEqual({ aliases: [], reads: [] });
    expect(Object.keys(prepared.workflow.methods)).toEqual(["createInventoryLevels", "deleteInventoryLevels"]);
    expect(prepared.commands.map(command => commerceCommandIdentity(command)?.name))
      .toEqual(["inventoryCreateLevels", "inventoryLevelPhysicalDeleteForWorkflow"]);
    const create = workflowMethodDefinition(prepared.workflow.methods.createInventoryLevels),
      remove = workflowMethodDefinition(prepared.workflow.methods.deleteInventoryLevels);
    expect(create?.moduleEvents).toEqual(["inventory.inventory-level.created"]);
    expect(remove?.moduleEvents).toEqual(["inventory.inventory-level.deleted"]);
  });

  it("retains eight existing-Item requests without imposing the Item creation workflow's two-Level nesting bound", () => {
    const create = workflowMethodDefinition(prepared.workflow.methods.createInventoryLevels),
      remove = workflowMethodDefinition(prepared.workflow.methods.deleteInventoryLevels);
    if (create === undefined || remove === undefined) throw new Error("Missing admitted Level methods");
    const rows = Array.from({ length: 8 }, (_, index) => ({ inventory_item_id: "existing-item", location_id: "existing-location" + index,
      stocked_quantity: -index - 0.125, incoming_quantity: index + 0.5 }));
    expect(Result.isSuccess(create.input([rows]))).toBe(true);
    expect(Result.isSuccess(remove.input([rows.map((_, index) => "level" + index)]))).toBe(true);
    for (const input of [[...rows, rows[0]], [{ inventory_item_id: "i", location_id: "l", reserved_quantity: 1 }],
      [{ inventory_item_id: "i", location_id: "l", raw_stocked_quantity: { value: "1", precision: 20 } }],
      [{ inventory_item_id: "i", location_id: "l", id: "unadmitted" }]])
      expect(Result.isFailure(create.input([input]))).toBe(true);
    expect(Result.isFailure(remove.input([Array.from({ length: 9 }, () => "duplicate")]))).toBe(true);
    expect(Result.isSuccess(remove.output(null))).toBe(true);
    expect(Result.isFailure(remove.output([]))).toBe(true);
  });

  it("preserves physical receipt action-mismatch reasons while keeping standalone publication narrow", async () => {
    const batch = inventoryLevelBatchEventPolicy(contracts), time = "2026-10-17T00:00:00.000Z";
    const before = await Effect.runPromise(captureExactNumericRow({ id: "level", inventory_item_id: "item", location_id: "location",
      stocked_quantity: 1, incoming_quantity: 2, reserved_quantity: 0, metadata: null,
      created_at: time, updated_at: time, deleted_at: null }, contracts.numeric, true));
    const activity: Parameters<LogicalCallReceiptValidation>[1] = { ...empty(),
      mutations: [{ ordinal: 0, table: "inventory_level", operation: "delete", before, after: null }] };
    for (const action of ["updated", "restored"] as const) {
      const event = { name: "inventory.inventory-level." + action,
        metadata: { source: "inventory", object: "inventory_level", action }, data: { id: "level" } };
      expect(Result.isSuccess(await Effect.runPromise(Effect.result(batch.capture(event))))).toBe(true);
      expect(await Effect.runPromise(Effect.result(policy.capture(event))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
      const receipt = { ...call("inventoryLevelPhysicalDeleteForWorkflow"), input: ["level"], result: null, events: [event] };
      for (const member of [batch, policy])
        expect(await Effect.runPromise(Effect.result(member.validateLogicalCall(receipt, activity))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
    const malformed = { name: "inventory.inventory-level.deleted",
      metadata: { source: "inventory", object: "inventory_level", action: "deleted" }, data: { id: 12 } };
    for (const member of [batch, policy])
      expect(await Effect.runPromise(Effect.result(member.validateLogicalCall({ ...call("inventoryLevelPhysicalDeleteForWorkflow"),
        input: ["level"], result: null, events: [malformed] }, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });

  it("admits only the two authoritative receipt commands and their two native event actions", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call("inventoryCreateLevels"), empty()));
    await Effect.runPromise(policy.validateLogicalCall({ ...call("inventoryLevelPhysicalDeleteForWorkflow"), result: null }, empty()));
    for (const command of ["inventoryCreate", "inventoryLevelUpdateForWorkflow", "inventoryLevelSoftDeleteForWorkflow", "inventoryLevelRestoreForWorkflow",
      "inventoryLevelListForUpdate", "inventoryLevelCountForDeletion", "inventoryReserve"])
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call(command), empty()))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    for (const action of ["updated", "restored"])
      expect(await Effect.runPromise(Effect.result(policy.capture({ name: "inventory.inventory-level." + action,
        metadata: { source: "inventory", object: "inventory_level", action }, data: { id: "level" } }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
    expect(await Effect.runPromise(Effect.result(policy.capture({ name: "inventory.inventory-item.created",
      metadata: { source: "inventory", object: "inventory_item", action: "created" }, data: { id: "item" } }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });
});
