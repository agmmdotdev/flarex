import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productCallReceipts } from "../src/modules/product/events/call-receipts";
import { ProductTypeCreateInput, ProductTypeIds, ProductTypeUpdateInput } from "../src/modules/product/type-input";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
let catalog: ProductRuntimeMetadata;
const timestamp = "2026-10-15T02:00:00.000Z";
const empty = (): Activity => ({ mutations: [], lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const receipt = (commandName: string, input: Json, result: Json, activity: Activity, events: readonly Json[] = []): Receipt => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: activity.mutations.length,
  fromLifecycle: 0, toLifecycle: activity.lifecycle.length,
});
const event = (action: "created" | "updated" | "deleted", id: string): Json => ({
  name: action === "created" ? catalog.type.createdEvent : action === "updated" ? catalog.type.updatedEvent : catalog.type.deletedEvent,
  metadata: { source: "product", object: catalog.type.eventObject, action }, data: { id },
});
const validate: LogicalCallReceiptValidation = (call, activity) => productCallReceipts(catalog).validateLogicalCall(call, activity);
const refused = async (call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(validate(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
function update(before: JsonObject, after: JsonObject): Activity {
  return { ...empty(), mutations: [{ ordinal: 0, table: catalog.type.table.name, operation: "patch", before, after }],
    observedRows: [{ table: catalog.type.table.name, row: after }] };
}
function deletion(): Activity {
  const before = { id: "type", value: "retained", metadata: null, deleted_at: null };
  const after = { ...before, deleted_at: timestamp };
  return { ...update(before, after), lifecycle: [{ table: catalog.type.table.name, key: { id: before.id }, operation: "softDelete",
    beforeDeletedAt: null, afterDeletedAt: timestamp, attemptOrdinal: 0, rowAtOperation: null }] };
}

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-type-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Product Type receipt boundaries", () => {
  it("retains finite array checks after native mutable decoding and admits empty selector updates", () => {
    for (const count of [0, 4, 5]) {
      expect(Schema.decodeUnknownResult(ProductTypeCreateInput)(Array.from({ length: count }, (_, index) => ({ value: String(index) })))._tag)
        .toBe(count <= 4 ? "Success" : "Failure");
      expect(Schema.decodeUnknownResult(ProductTypeIds)(Array.from({ length: count }, () => "same"))._tag)
        .toBe(count <= 4 ? "Success" : "Failure");
    }
    expect(Schema.decodeUnknownResult(ProductTypeUpdateInput)({ selector: {}, update: {} })._tag).toBe("Success");
    expect(Schema.decodeUnknownResult(ProductTypeUpdateInput)({ selector: { id: [] }, update: { metadata: null } })._tag).toBe("Success");
    expect(Schema.decodeUnknownResult(ProductTypeUpdateInput)({ selector: { id: Array.from({ length: 5 }, () => "same") }, update: {} })._tag).toBe("Failure");
  });

  it("binds Type creation results and native order while retaining authentic empty creation", async () => {
    const activity: Activity = { ...empty(), mutations: ["first", "second"].map((id, ordinal) => ({ ordinal,
      table: catalog.type.table.name, operation: "insert", before: null, after: { id, value: id, metadata: null, deleted_at: null } })) };
    const results = activity.mutations.map(mutation => mutation.after);
    const call = receipt("productCreateTypesForWorkflow", [{ value: "first" }, { value: "second" }], results, activity,
      [event("created", "first"), event("created", "second")]);
    await Effect.runPromise(validate(call, activity));
    await refused({ ...call, result: [...results].reverse() }, activity);
    await Effect.runPromise(validate(receipt("productCreateTypesForWorkflow", [], [], empty()), empty()));
  });

  it("authenticates native shallow metadata merge against the first mutation preimage", async () => {
    const before = { id: "type", value: "original", metadata: { kept: 1, removed: "old", nested: { old: true } }, deleted_at: null };
    const after = { ...before, metadata: { kept: 1, nested: { next: true }, added: 2 } };
    const input = { selector: { value: "original" }, update: { metadata: { removed: "", nested: { next: true }, added: 2 } } };
    const activity = update(before, after), call = receipt("productUpdateTypesBySelector", input, [after], activity, [event("updated", "type")]);
    await Effect.runPromise(validate(call, activity));
    const recursivelyMerged = { ...after, metadata: { ...after.metadata, nested: { old: true, next: true } } };
    await refused({ ...call, result: [recursivelyMerged] }, update(before, recursivelyMerged));
    const omittedPreservedKey = { ...after, metadata: { nested: { next: true }, added: 2 } };
    await refused({ ...call, result: [omittedPreservedKey] }, update(before, omittedPreservedKey));
  });

  it.each(["omitted", "null", "empty"] as const)("preserves native %s metadata update semantics", async mode => {
    const before = { id: "type", value: "original", metadata: { kept: true }, deleted_at: null };
    const data = mode === "omitted" ? {} : { metadata: mode === "null" ? null : {} };
    const after = { ...before, metadata: mode === "omitted" ? before.metadata : mode === "null" ? null : {} };
    const activity = update(before, after);
    await Effect.runPromise(validate(receipt("productUpdateTypesBySelector", { selector: {}, update: data }, [after], activity,
      [event("updated", "type")]), activity));
  });

  it("refuses a selector receipt that skips another observed active matching Type", async () => {
    const before = { id: "type", value: "original", metadata: null, deleted_at: null }, activity = update(before, before);
    const call = receipt("productUpdateTypesBySelector", { selector: {}, update: {} }, [before], activity, [event("updated", "type")]);
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.type.table.name, row: { ...before, id: "skipped" } }] });
    await refused({ ...call, input: { selector: { id: "outside" }, update: {} } }, activity);
  });

  it("admits missing selector updates while refusing invented returned roots", async () => {
    const activity = empty(), call = receipt("productUpdateTypesBySelector", { selector: { id: "missing" }, update: {} }, [], activity);
    await Effect.runPromise(validate(call, activity));
    await refused({ ...call, result: [{ id: "invented", value: "invented" }] }, activity);
  });

  it("coalesces missing and duplicate delete requests but requires exact active root coverage and native mapping", async () => {
    const activity = deletion(), call = receipt("productSoftDeleteTypesForWorkflow", ["type", "missing", "type"],
      { product_type_id: ["type"] }, activity, [event("deleted", "type")]);
    await Effect.runPromise(validate(call, activity));
    await refused({ ...call, result: {} }, activity);
    await refused({ ...call, result: { product_type_id: ["type", "type"] } }, activity);
    await refused(call, { ...activity, lifecycle: [] });
    await refused({ ...call, events: [] }, activity);
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.type.table.name, row: { id: "missing", value: "eligible", deleted_at: null } }] });
  });

  it("authenticates empty and already-deleted no-ops and refuses hidden reference effects", async () => {
    const activity: Activity = { ...empty(), observedRows: [{ table: catalog.type.table.name,
      row: { id: "deleted", value: "old", deleted_at: timestamp } }] };
    for (const ids of [[], ["missing"], ["deleted", "missing", "deleted"]])
      await Effect.runPromise(validate(receipt("productSoftDeleteTypesForWorkflow", ids, {}, activity), activity));
    const changed = deletion(), call = receipt("productSoftDeleteTypesForWorkflow", ["type"], { product_type_id: ["type"] }, changed,
      [event("deleted", "type")]);
    await refused(call, { ...changed, setNull: [{ sourceTable: catalog.product.table.name, sourceColumn: "type_id",
      targetTable: catalog.type.table.name, targetColumn: "id", targetKey: "type", managedUpdate: "advance" }] });
    await refused({ ...call, input: Array.from({ length: 5 }, () => "type") }, changed);
  });
});
