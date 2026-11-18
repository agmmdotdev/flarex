import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";

it("prepares one named Inventory batch source with creation, empty Levels, computed reads and lifecycle", async () => {
  const runtime = await Effect.runPromise(makeLocalInventoryCommands("product-batches"));
  expect(workflowModuleDefinition(runtime.workflow)?.source).toMatchObject({ name: "flarex-inventory-local", profile: "inventory-product-batches" });
  expect(runtime.graph.reads[0]?.table.columns).toContain("reserved_quantity");
  const create = workflowMethodDefinition(runtime.workflow.methods.createInventoryItems!);
  const levels = workflowMethodDefinition(runtime.workflow.methods.createInventoryLevels!);
  const remove = workflowMethodDefinition(runtime.workflow.methods.softDeleteInventoryItems!);
  if (create === undefined || levels === undefined || remove === undefined) throw new Error("Missing authentic Inventory batch method");
  expect(Result.isSuccess(create.input([Array.from({ length: 4 }, (_, index) => ({ sku: "batch-" + index }))]))).toBe(true);
  expect(Result.isFailure(create.input([Array.from({ length: 5 }, () => ({ sku: "overflow" }))]))).toBe(true);
  expect(Result.isSuccess(create.input([[]]))).toBe(true);
  expect(Result.isSuccess(levels.input([[]]))).toBe(true);
  expect(Result.isFailure(levels.input([[{ inventory_item_id: "i", location_id: "l" }]]))).toBe(true);
  expect(Result.isSuccess(remove.input([Array.from({ length: 8 }, (_, index) => "i" + index)]))).toBe(true);
  expect(Result.isFailure(remove.input([Array.from({ length: 9 }, (_, index) => "i" + index)]))).toBe(true);
  expect(remove.moduleEvents).toEqual(["inventory.inventory-item.deleted", "inventory.inventory-level.deleted", "inventory.reservation-item.deleted"]);
  expect(create.moduleEvents).toEqual(["inventory.inventory-item.created"]);
  expect(levels.moduleEvents).toEqual([]);
});

it("keeps independent Inventory source identities and old graph/Level admissions unchanged", async () => {
  for (const [admission, profile] of [["items", "inventory-variant-items"], ["levels", "inventory-stock-levels"],
    ["stock", "inventory-stock-mutations"], ["product-deletions", "inventory-product-deletions"]] as const) {
    const runtime = await Effect.runPromise(makeLocalInventoryCommands(admission));
    expect(workflowModuleDefinition(runtime.workflow)?.source.profile).toBe(profile);
    expect(runtime.graph.reads[0]?.table.columns.includes("reserved_quantity")).toBe(admission === "product-deletions");
    expect(runtime.workflow.methods.softDeleteInventoryItems !== undefined).toBe(admission === "product-deletions");
  }
});
