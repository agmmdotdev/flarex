import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity, defineCommerceCommand, type CommerceCommand,
  type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { makePriceListPriceBatchCommands } from "../src/modules/pricing/price-list-price-batch-service";
import { commerceRelationReadQuery } from "../src/query/relations";

type Call = Parameters<LogicalCommerceCallValidation>[0];
type Activity = Parameters<LogicalCommerceCallValidation>[1];
let batch: Effect.Success<ReturnType<typeof makePriceListPriceBatchCommands>>;
let creation: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let update: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
const activity: Activity = { observedRows: [], mutations: [], lifecycle: [], relationalReads: [], setNull: [], referenceReplacements: [] };
function logical() {
  const policy = workflowModuleDefinition(batch.workflow)?.logical;
  if (policy === undefined) throw new Error("Missing combined Pricing logical policy");
  return policy;
}
function methodCommand(name: keyof typeof batch.workflow.methods) {
  const method = batch.workflow.methods[name], definition = method === undefined ? undefined : workflowMethodDefinition(method);
  if (definition === undefined) throw new Error("Missing authentic Pricing method: " + name);
  return definition.command;
}
function call(command: CommerceCommand, input: Json, result: Json): Call {
  const identity = commerceCommandIdentity(command);
  if (identity === undefined) throw new Error("Missing command issuer");
  return { commandName: identity.name, mode: identity.mode, input, result, events: [],
    fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
}
const refusal = async (work: Effect.Effect<unknown, CommerceTransactionError>, reason: string) =>
  expect(await Effect.runPromise(Effect.result(work))).toMatchObject({ _tag: "Failure", failure: { reason } });

beforeAll(async () => {
  batch = await Effect.runPromise(makePriceListPriceBatchCommands());
  creation = await Effect.runPromise(makeLocalPricingCommands("price-list-price-creations"));
  update = await Effect.runPromise(makeLocalPricingCommands("price-list-price-updates"));
});

describe("native Price List Price batch command composition", () => {
  it("selects nine distinct authentic methods and commands under one empty-graph Pricing participant", () => {
    expectTypeOf<keyof typeof batch.workflow.methods>().toEqualTypeOf<"listPriceLists" | "addPriceListPrices" | "removePrices" |
      "snapshotPriceListPricesForUpdate" | "updatePriceListPrices" | "restorePriceListPrices" | "listPrices" | "softDeletePrices" | "restorePrices">();
    expectTypeOf<typeof batch.workflow.methods.listPriceLists>().toEqualTypeOf<NonNullable<typeof creation.workflow.methods.listPriceLists>>();
    expectTypeOf<typeof batch.workflow.methods.updatePriceListPrices>().toEqualTypeOf<NonNullable<typeof update.workflow.methods.updatePriceListPrices>>();
    const names: ReadonlyArray<keyof typeof batch.workflow.methods> = ["listPriceLists", "addPriceListPrices", "removePrices", "snapshotPriceListPricesForUpdate",
      "updatePriceListPrices", "restorePriceListPrices", "listPrices", "softDeletePrices", "restorePrices"];
    expect(batch.workflow.name).toBe("pricing");
    expect(Object.keys(batch.workflow.methods)).toEqual(names);
    expect(new Set(Object.values(batch.workflow.methods)).size).toBe(9);
    expect(batch.commands).toHaveLength(9);
    expect(new Set(batch.commands).size).toBe(9);
    expect(names.map(methodCommand)).toEqual(batch.commands);
    expect(batch.commands.map(command => commerceCommandIdentity(command))).toEqual([
      { name: "pricingPriceListPriceRead", mode: "read" }, { name: "pricingAddPriceListPrices", mode: "write" },
      { name: "pricingRemovePriceListPrices", mode: "write" }, { name: "pricingListPriceSnapshot", mode: "read" },
      { name: "pricingListPriceUpdate", mode: "write" }, { name: "pricingListPriceRestore", mode: "write" },
      { name: "pricingListPricesForRemovalWorkflow", mode: "read" }, { name: "pricingPriceSoftDeleteForRemovalWorkflow", mode: "write" },
      { name: "pricingPriceRestoreForRemovalWorkflow", mode: "write" },
    ]);
    expect(workflowModuleDefinition(batch.workflow)).toMatchObject({
      source: { name: "flarex-pricing-local", profile: "pricing-price-list-price-batch" }, graph: { aliases: [], reads: [] },
    });
    expect(logical()).not.toHaveProperty("validateLogical");
    expect(logical()).not.toHaveProperty("allowActiveRestoreUpdate");
  });

  it("rejects unknown, reconstructed and freshly minted same-name command objects", async () => {
    const selected = methodCommand("removePrices"), receipt = call(selected, [], null);
    await Effect.runPromise(logical().validateLogicalCall(receipt, activity, selected));
    const unknown = defineCommerceCommand("unknownBatchPricingCommand", "write", () => Effect.succeed(null));
    const reconstructed = { ...selected };
    const reissued = defineCommerceCommand(receipt.commandName, "write", () => Effect.succeed(null));
    for (const unowned of [unknown, reconstructed, reissued])
      await refusal(logical().validateLogicalCall(receipt, activity, unowned), "invalidAuthority");
    await refusal(logical().validateLogicalCall({ ...receipt, commandName: "pricingListPriceRestore" }, activity, selected), "invalidAuthority");
    await refusal(logical().validateLogicalCall({ ...receipt, mode: "read" }, activity, selected), "invalidAuthority");
  });

  it("preserves original module issuer checks across combined and wrong-child policies", async () => {
    const originalCreation = workflowModuleDefinition(creation.workflow)?.logical;
    const originalUpdate = workflowModuleDefinition(update.workflow)?.logical;
    if (originalCreation === undefined || originalUpdate === undefined) throw new Error("Missing original child policies");
    const original = creation.removeListPrices, combined = methodCommand("removePrices");
    const receipt = call(original, [], null);
    await Effect.runPromise(originalCreation.validateLogicalCall(receipt, activity, original));
    await refusal(originalUpdate.validateLogicalCall(receipt, activity, original), "invalidAuthority");
    await refusal(logical().validateLogicalCall(receipt, activity, original), "invalidAuthority");
    await refusal(originalCreation.validateLogicalCall(call(combined, [], null), activity, combined), "invalidAuthority");
  });

  it("serves both original List validators through the creation ABI without deduplicating repeated calls", async () => {
    const method = batch.workflow.methods.listPriceLists, definition = method === undefined ? undefined : workflowMethodDefinition(method);
    if (definition === undefined) throw new Error("Missing shared native List validator method");
    const input = Result.getOrThrow(definition.input([{ id: [] }]));
    expect(input).toEqual({ filters: { id: [] }, config: {} });
    expect(Result.getOrThrow(definition.input([{ id: [] }, {}]))).toEqual(input);
    const receipt = call(definition.command, input, []);
    const read: Activity = { ...activity, relationalReads: [{ table: "price_list", total: 0, returned: 0, orderedIdentities: [],
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
        { kind: "in", column: "id", values: [] }, { kind: "isNull", column: "deleted_at" }] }, "id", { includeIdentities: true }) }] };
    await Effect.runPromise(logical().validateLogicalCall(receipt, read, definition.command));
    await Effect.runPromise(logical().validateLogicalCall(receipt, read, definition.command));
  });

  it("routes retained inverses to their own native result and receipt contracts", async () => {
    const physical = methodCommand("removePrices"), replay = methodCommand("restorePriceListPrices"), currentGraph = methodCommand("restorePrices");
    await Effect.runPromise(logical().validateLogicalCall(call(physical, [], null), activity, physical));
    await Effect.runPromise(logical().validateLogicalCall(call(replay, { before: [], createdPriceIds: [] }, null), activity, replay));
    await Effect.runPromise(logical().validateLogicalCall(call(currentGraph, [], {}), activity, currentGraph));
    await refusal(logical().validateLogicalCall(call(physical, [], {}), activity, physical), "receiptMismatch");
    await refusal(logical().validateLogicalCall(call(currentGraph, [], null), activity, currentGraph), "receiptMismatch");
  });

  it("unions required core permissions without admitting replay-shaped creation attempts", async () => {
    expect(logical()).toMatchObject({ allowStorageInsertionOrder: true, allowRecordedRowReplay: true,
      allowPreservingDeletionUpsert: "preserveTimestamps" });
    const selected = methodCommand("removePrices"), receipt = call(selected, [], null);
    const stamp = "2026-10-21T00:00:00.000Z";
    const row = { id: "price-batch158-unselected", deleted_at: stamp, updated_at: stamp };
    const replay: Activity = { ...activity, observedRows: [{ table: "price", row }], mutations: [
      { ordinal: 0, table: "price", operation: "replace", before: row, after: { ...row, deleted_at: null } },
    ] };
    await refusal(logical().validateLogicalCall(receipt, replay, selected), "receiptMismatch");
    await refusal(logical().validateLogicalCall(receipt, { ...activity, lifecycle: [{ table: "price", operation: "restore",
      key: { id: row.id }, beforeDeletedAt: stamp, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: row }] }, selected), "receiptMismatch");
  });

  it("uses the original creation event grammar for the combined event families", async () => {
    for (const [object, action] of [["price", "created"], ["price", "updated"], ["price_rule", "deleted"]] as const) {
      const event = { name: "pricing." + object.replaceAll("_", "-") + "." + action,
        metadata: { source: "pricing", object, action }, data: { id: "row158" } };
      expect(await Effect.runPromise(logical().capture(event))).toEqual(event);
    }
    await refusal(logical().capture({ name: "pricing.price.restored", metadata: { source: "pricing", object: "price", action: "restored" },
      data: { id: "row158" } }), "unadmittedEvent");
  });
});
