import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productCallReceipts } from "../src/modules/product/events/call-receipts";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
let catalog: ProductRuntimeMetadata;
const event = (id: string | string[]): Json => ({ name: catalog.type.updatedEvent,
  metadata: { source: "product", object: catalog.type.eventObject, action: "updated" }, data: { id } });
const validate: LogicalCallReceiptValidation = (call, activity) => productCallReceipts(catalog).validateLogicalCall(call, activity);
const refused = async (call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(validate(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

/** A fixed native transcript. Expected metadata is supplied explicitly rather
 * than reproducing the service's metadata normalization in the test harness. */
const nativeReceipt = (selector: JsonObject, order: readonly string[], update: JsonObject = {}, afterFields: JsonObject = {}) => {
  const before = order.map(id => ({ id, value: "Value " + id,
    metadata: { keep: "old", remove: "old", nested: { before: true } }, deleted_at: null }));
  const after = before.map(row => ({ ...row, ...afterFields, updated_at: "2026-10-17T01:00:00.000Z" }));
  const activity: Activity = { mutations: before.map((row, ordinal) => ({ ordinal, table: catalog.type.table.name,
    operation: "patch", before: row, after: after[ordinal] ?? null })), lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [],
  observedRows: after.map(row => ({ table: catalog.type.table.name, row })) };
  const call: Receipt = { commandName: "productUpdateTypesBySelector", mode: "write", input: { selector, update }, result: after,
    events: order.map(id => event(id)), fromAttempt: 0, toAttempt: activity.mutations.length, fromLifecycle: 0, toLifecycle: 0 };
  return { call, activity, before, after };
};

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-type-selector-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Type selector receipt order", () => {
  it("rejects selector-only reversal against fixed native mutations, results and events", async () => {
    const { call, activity } = nativeReceipt({ id: ["c", "a"] }, ["c", "a"]);
    await Effect.runPromise(validate(call, activity));
    await refused({ ...call, input: { selector: { id: ["a", "c"] }, update: {} } }, activity);
  });

  it("rejects coordinated native result, mutation and event reversal for a fixed selector", async () => {
    const { call, activity } = nativeReceipt({ id: ["c", "a"] }, ["a", "c"]);
    await refused(call, activity);
  });

  it("retains native unsorted ID-array order and first-occurrence duplicate ranking", async () => {
    for (const [selectorIds, order] of [
      [["d", "b", "c", "a"], ["d", "b", "c", "a"]],
      [["a", "c", "a"], ["a", "c"]],
      [["missing", "c", "a", "c"], ["c", "a"]],
    ] as const) {
      const native = nativeReceipt({ id: [...selectorIds] }, order);
      await Effect.runPromise(validate(native.call, native.activity));
      const reversed = nativeReceipt({ id: [...selectorIds] }, [...order].reverse());
      await refused(reversed.call, reversed.activity);
    }
  });

  it("uses native UTF-8 order for empty selectors and preserves scalar/value/missing selections", async () => {
    const order = ["\uE000", "\u{10000}"];
    const native = nativeReceipt({}, order);
    await Effect.runPromise(validate(native.call, native.activity));
    const reversed = nativeReceipt({}, [...order].reverse());
    await refused(reversed.call, reversed.activity);
    const selectors: JsonObject[] = [{ id: "a" }, { value: "Value a" }];
    for (const selector of selectors) {
      const selected = nativeReceipt(selector, ["a"]);
      await Effect.runPromise(validate(selected.call, selected.activity));
    }
    const emptySelectors: JsonObject[] = [{ id: "missing" }, { id: [] }, {}];
    for (const selector of emptySelectors) {
      const empty = nativeReceipt(selector, []);
      await Effect.runPromise(validate(empty.call, empty.activity));
    }
    const explicit = nativeReceipt({ id: [...order].reverse() }, [...order].reverse());
    await Effect.runPromise(validate(explicit.call, explicit.activity));
  });

  it("retains native metadata omission, shallow merge and empty/null replacement across ordered arrays", async () => {
    const order = ["d", "b", "c", "a"];
    const variants: ReadonlyArray<readonly [JsonObject, JsonObject]> = [
      [{}, {}],
      [{ metadata: {} }, { metadata: {} }],
      [{ metadata: null }, { metadata: null }],
      [{ metadata: { remove: "", nested: { next: true } } }, { metadata: { keep: "old", nested: { next: true } } }],
    ];
    for (const [update, after] of variants) {
      const native = nativeReceipt({ id: [...order] }, order, update, after);
      await Effect.runPromise(validate(native.call, native.activity));
    }
  });

  it("requires exact event ID order, coverage and uniqueness even when IDs share a message", async () => {
    const { call, activity } = nativeReceipt({ id: ["c", "a"] }, ["c", "a"]);
    await Effect.runPromise(validate({ ...call, events: [event(["c", "a"])] }, activity));
    for (const events of [
      [event("a"), event("c")], [event(["a", "c"])], [event(["c", "c", "a"])],
      [event(["c"])], [event("c"), event("a"), event("a")], [],
    ]) await refused({ ...call, events }, activity);
  });

  it("preserves complete selection proof and refuses independently reordered results or mutations", async () => {
    const { call, activity } = nativeReceipt({ id: ["c", "a"] }, ["c", "a"]);
    const skipped = { id: "other", value: "Value other", deleted_at: null };
    await refused({ ...call, input: { selector: {}, update: {} } }, { ...activity,
      observedRows: [...activity.observedRows, { table: catalog.type.table.name, row: skipped }] });
    await refused({ ...call, result: [...activity.mutations].reverse().map(mutation => mutation.after) }, activity);
    await refused(call, { ...activity, mutations: [...activity.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal })) });
  });
});
