import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productCallReceipts } from "../src/modules/product/events/call-receipts";
import { ProductCollectionCreateInput, ProductCollectionIds, decodeProductCollectionUpdateInput } from "../src/modules/product/collection-input";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
let catalog: ProductRuntimeMetadata;
const empty = (): Activity => ({ mutations: [], lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const receipt = (commandName: string, input: Json, result: Json, activity: Activity, events: readonly Json[] = []): Receipt => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: activity.mutations.length,
  fromLifecycle: 0, toLifecycle: activity.lifecycle.length,
});
const event = (action: "updated" | "deleted", id: string): Json => ({
  name: action === "updated" ? catalog.collection.updatedEvent : catalog.collection.deletedEvent,
  metadata: { source: "product", object: catalog.collection.eventObject, action }, data: { id },
});
const productEvent = (id: string): Json => ({ name: catalog.product.updatedEvent,
  metadata: { source: "product", object: catalog.product.eventObject, action: "updated" }, data: { id } });
const validate: LogicalCallReceiptValidation = (call, activity) => productCallReceipts(catalog).validateLogicalCall(call, activity);
const refused = async (call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(validate(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

/** Explicit native attempt transcript: all selectors saw the initial rows,
 * while the two later associations see the earlier root's pending writes. */
const membershipReceipt = (rootOrder: readonly string[] = ["c", "a"], selectorIds: readonly string[] = ["c", "a"]) => {
  const roots = rootOrder.map(id => ({ id, title: "Original", handle: id, metadata: null, deleted_at: null }));
  const initial: JsonObject[] = [
    { id: "out", title: "Out", collection_id: "c", deleted_at: null },
    { id: "shared", title: "Shared", collection_id: "c", deleted_at: null },
    { id: "prior-a", title: "Prior A", collection_id: "a", deleted_at: null },
    { id: "new", title: "New", collection_id: null, deleted_at: null },
    { id: "deleted", title: "Deleted", collection_id: "a", deleted_at: "2026-10-16T01:00:00.000Z" },
  ];
  const requested = ["new", "missing", "shared", "new"];
  const mutations: Activity["mutations"][number][] = roots.map((row, ordinal) => ({
    ordinal, table: catalog.collection.table.name, operation: "patch", before: row, after: { ...row, title: "Changed" },
  }));
  const pending = new Map(initial.map(row => [row.id, row]));
  const firstTouch = new Set<string>();
  const cohorts = new Map<string, ReadonlyArray<readonly [string, string | null]>>([
    ["c", [["out", null], ["new", "c"], ["shared", "c"]]],
    ["a", [["prior-a", null], ["new", "a"], ["shared", "a"]]],
  ]);
  for (const [id, target] of rootOrder.flatMap(root => cohorts.get(root) ?? [])) {
    const before = pending.get(id);
    if (before === undefined) throw new Error("missing test Product");
    const after = { ...before, collection_id: target, updated_at: `attempt-${mutations.length}` };
    mutations.push({ ordinal: mutations.length, table: catalog.product.table.name, operation: "patch", before, after });
    pending.set(id, after);
    firstTouch.add(id);
  }
  const activity: Activity = { ...empty(), mutations, observedRows: [
    ...roots.map(row => ({ table: catalog.collection.table.name, row: { ...row, title: "Changed" } })),
    ...[...pending.values()].map(row => ({ table: catalog.product.table.name, row })),
  ] };
  const output = roots.map(row => ({ ...row, title: "Changed", products: requested.map(id => ({ id })) }));
  const call = receipt("productUpdateCollectionsBySelector", { selector: { id: [...selectorIds] },
    update: { title: "Changed", product_ids: requested } }, output, activity,
  [...roots.map(row => event("updated", row.id)), ...[...firstTouch].map(productEvent)]);
  return { activity, call, initial, output };
};

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-collection-workflow-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Collection workflow receipts", () => {
  it("checks four creation references across the entire mutable native array", () => {
    const create = Schema.decodeUnknownResult(ProductCollectionCreateInput);
    expect(create([{ title: "A", product_ids: ["a", "b"] }, { title: "B", product_ids: ["c", "d"] }])._tag).toBe("Success");
    expect(create([{ title: "A", product_ids: ["a", "b", "c"] }, { title: "B", product_ids: ["d", "e"] }])._tag).toBe("Failure");
    expect(create(Array.from({ length: 5 }, () => ({ title: "A" })))._tag).toBe("Failure");
    expect(Schema.decodeUnknownResult(ProductCollectionIds)(Array.from({ length: 5 }, () => "same"))._tag).toBe("Failure");
    expect(decodeProductCollectionUpdateInput({ selector: {}, update: {} })._tag).toBe("Success");
    expect(decodeProductCollectionUpdateInput({ selector: {}, update: { value: "not-a-DML-field" } })._tag).toBe("Failure");
  });

  it("binds four ordered native roots, metadata merging and requested missing/duplicate stubs", async () => {
    const order = ["a", "b", "c", "d"], requested = ["product-b", "missing", "product-a", "product-b"];
    const before = order.map(id => ({ id, title: "Original", handle: id, metadata: { retained: true, removed: true }, deleted_at: null }));
    const after = before.map(row => ({ ...row, title: "Changed", metadata: { retained: true, nested: { next: true } } }));
    const activity: Activity = { ...empty(),
      mutations: before.map((row, ordinal) => ({ ordinal, table: catalog.collection.table.name, operation: "patch", before: row, after: after[ordinal] ?? null })),
      observedRows: after.map(row => ({ table: catalog.collection.table.name, row })),
    };
    const output = after.map(row => ({ ...row, products: requested.map(id => ({ id })) }));
    const call = receipt("productUpdateCollectionsBySelector", { selector: {},
      update: { title: "Changed", metadata: { removed: "", nested: { next: true } }, product_ids: requested } }, output, activity,
    order.map(id => event("updated", id)));
    await Effect.runPromise(validate(call, activity));
    await refused(call, { ...activity, referenceReplacements: [{ sourceTable: catalog.product.table.name, sourceColumn: "collection_id",
      targetTable: catalog.collection.table.name, targetColumn: "id", targetKey: "c", desiredKeys: [] }] });
    await refused({ ...call, result: [...output].reverse() }, activity);
    await refused({ ...call, result: output.map(row => ({ ...row, products: [] })) }, activity);
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.collection.table.name, row: { id: "skipped", title: "Original", handle: "skipped", deleted_at: null } }] });
  });

  it("validates initial cohorts, repeated pending updates and first-touch events in native attempt order", async () => {
    const { call, activity, initial } = membershipReceipt();
    await Effect.runPromise(validate(call, activity));
    // Both observed final rows and later mutation.before rows differ from the
    // request-initial rows. Replacing observations with initial rows is valid too.
    await Effect.runPromise(validate(call, { ...activity, observedRows: [
      ...activity.observedRows.filter(row => row.table !== catalog.product.table.name),
      ...initial.map(row => ({ table: catalog.product.table.name, row })),
    ] }));
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.product.table.name, row: { id: "skipped", collection_id: "c", deleted_at: null } }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      ...Array.from({ length: 3 }, (_, index) => ({ table: catalog.product.table.name,
        row: { id: `oversize-${index}`, collection_id: "c", deleted_at: null } })),
    ] });
  });

  it("rejects coordinated root, result, event and membership reversal that changes the final owner", async () => {
    const { call, activity } = membershipReceipt(["a", "c"]);
    expect(activity.observedRows.find(observed => observed.table === catalog.product.table.name && observed.row.id === "new")?.row.collection_id)
      .toBe("c");
    await refused(call, activity);
  });

  it("binds selector-only changes", async () => {
    const changedSelector = membershipReceipt(["c", "a"], ["a", "c"]);
    await refused(changedSelector.call, changedSelector.activity);
  });

  it("retains native service first-occurrence ID order before membership's last target wins", async () => {
    // buildQuery deduplicates the service selector before the repository's
    // preservePrimaryKeyOrFilterOrder sees it. Raw DAL duplicate rank differs.
    const duplicateRank = membershipReceipt(["c", "a"], ["c", "a", "c"]);
    await Effect.runPromise(validate(duplicateRank.call, duplicateRank.activity));
    expect(duplicateRank.activity.observedRows.find(observed => observed.table === catalog.product.table.name && observed.row.id === "new")?.row.collection_id)
      .toBe("a");
    const wrongDuplicateRank = membershipReceipt(["a", "c"], ["c", "a", "c"]);
    await refused(wrongDuplicateRank.call, wrongDuplicateRank.activity);
  });

  it("rejects coordinated within-cohort Product and first-touch event reversal", async () => {
    const { call, activity } = membershipReceipt();
    const changed: Activity = { ...activity, mutations: [
      ...activity.mutations.slice(0, 3), ...activity.mutations.slice(4, 5), ...activity.mutations.slice(3, 4),
      ...activity.mutations.slice(5),
    ].map((mutation, ordinal) => ({ ...mutation, ordinal })) };
    await refused({ ...call, events: [...call.events.slice(0, 3), productEvent("shared"), productEvent("new"), productEvent("prior-a")] }, changed);
  });

  it("uses native UTF-8 ID order for empty/title selectors and direct ID-array overrides", async () => {
    // UTF-16 would put the supplementary ID first; the native logical reader
    // compares complete UTF-8 bytes and puts this BMP ID first instead.
    const order = ["\uE000", "\u{10000}"];
    const rows = order.map(id => ({ id, title: "Same", handle: id, metadata: null, deleted_at: null }));
    const make = (orderedRows: typeof rows, selector: JsonObject) => {
      const activity: Activity = { ...empty(), observedRows: rows.map(row => ({ table: catalog.collection.table.name, row })),
        mutations: orderedRows.map((row, ordinal) => ({ ordinal, table: catalog.collection.table.name,
          operation: "patch", before: row, after: row })) };
      return { activity, call: receipt("productUpdateCollectionsBySelector", { selector, update: {} },
        orderedRows.map(row => ({ ...row, products: [] })), activity, orderedRows.map(row => event("updated", row.id))) };
    };
    const defaultSelectors: JsonObject[] = [{}, { title: "Same" }];
    for (const selector of defaultSelectors) {
      const valid = make(rows, selector);
      await Effect.runPromise(validate(valid.call, valid.activity));
      const reversed = make([...rows].reverse(), selector);
      await refused(reversed.call, reversed.activity);
    }
    const explicit = make([...rows].reverse(), { id: [...order].reverse() });
    await Effect.runPromise(validate(explicit.call, explicit.activity));
    const scalarSelectors: JsonObject[] = [{ id: "\uE000" }, { handle: "\uE000" }];
    for (const selector of scalarSelectors) {
      const scalar = make(rows.slice(0, 1), selector);
      await Effect.runPromise(validate(scalar.call, scalar.activity));
    }
  });

  it("rejects missing, repeated, reordered and wrongly targeted native Product cohorts", async () => {
    const { call, activity } = membershipReceipt();
    const check = async (mutations: Activity["mutations"]) => {
      const changed: Activity = { ...activity, mutations: mutations.map((mutation, ordinal) => ({ ...mutation, ordinal })) };
      await refused({ ...call, toAttempt: changed.mutations.length }, changed);
    };
    await check(activity.mutations.filter((_, index) => index !== 2));
    await check([...activity.mutations, ...activity.mutations.slice(7)]);
    await check([...activity.mutations.slice(0, 2), ...activity.mutations.slice(3, 4),
      ...activity.mutations.slice(2, 3), ...activity.mutations.slice(4)]);
    await check(activity.mutations.map((mutation, index) => index === 2 && mutation.after !== null
      ? { ...mutation, after: { ...mutation.after, collection_id: "a" } } : mutation));
    await check(activity.mutations.map((mutation, index) => index === 4 && mutation.before !== null && mutation.after !== null
      ? { ...mutation, before: { ...mutation.before, id: "new" }, after: { ...mutation.after, id: "new" } } : mutation));
  });

  it("rejects stale pending preimages and unrelated removed or added Product fields", async () => {
    const { call, activity, initial } = membershipReceipt();
    const original = initial.find(row => row.id === "new");
    if (original === undefined) throw new Error("missing initial test Product");
    await refused(call, { ...activity, mutations: activity.mutations.map((mutation, index) =>
      index === 6 ? { ...mutation, before: original } : mutation) });
    for (const field of ["title", "unexpected"]) {
      await refused(call, { ...activity, mutations: activity.mutations.map((mutation, index) =>
        index === 2 && mutation.after !== null ? { ...mutation, after: { ...mutation.after, [field]: "forged" } } : mutation) });
    }
    await refused(call, { ...activity, mutations: activity.mutations.map((mutation, index) => {
      if (index !== 2 || mutation.after === null) return mutation;
      const { title: omitted, ...after } = mutation.after;
      void omitted;
      return { ...mutation, after };
    }) });
    await refused(call, { ...activity, mutations: activity.mutations.map((mutation, index) =>
      index === 0 && mutation.after !== null ? { ...mutation, after: { ...mutation.after, unexpected: true } } : mutation) });
  });

  it("rejects missing, duplicate or reordered events and Product events before Collection events", async () => {
    const { call, activity } = membershipReceipt();
    await refused({ ...call, events: call.events.slice(0, -1) }, activity);
    await refused({ ...call, events: [...call.events, productEvent("shared")] }, activity);
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [productEvent("out"), ...call.events.slice(0, 2), ...call.events.slice(3)] }, activity);
    await refused({ ...call, events: [...call.events.slice(0, 2), productEvent("shared"), productEvent("new"),
      productEvent("out"), productEvent("prior-a")] }, activity);
  });

  it("retains the existing single-Collection sealed replacement profile without admitting Product attempts", async () => {
    const before = { id: "single", title: "Single", handle: "single", metadata: null, deleted_at: null };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: catalog.collection.table.name,
      operation: "patch", before, after: before }], relationalReads: [], referenceReplacements: [{
      sourceTable: catalog.product.table.name, sourceColumn: "collection_id", targetTable: catalog.collection.table.name,
      targetColumn: "id", targetKey: "single", desiredKeys: ["requested"],
    }] };
    const call = receipt("productupdatecollection", { id: "single", data: { product_ids: ["requested"] } },
      { ...before, products: [{ id: "requested" }] }, activity, [event("updated", "single")]);
    await Effect.runPromise(validate(call, activity));
    const changed: Activity = { ...activity, mutations: [...activity.mutations, { ordinal: 1, table: catalog.product.table.name,
      operation: "patch", before: { id: "requested", collection_id: null, deleted_at: null },
      after: { id: "requested", collection_id: "single", deleted_at: null } }] };
    await refused({ ...call, toAttempt: 2, events: [...call.events, productEvent("requested")] }, changed);
  });

  it("requires complete empty-selector coverage and rejects unrelated Product writes", async () => {
    const row = { id: "collection", title: "Original", handle: "original", metadata: null, deleted_at: null };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: catalog.collection.table.name,
      operation: "patch", before: row, after: row }], observedRows: [{ table: catalog.collection.table.name, row }] };
    const call = receipt("productUpdateCollectionsBySelector", { selector: {}, update: {} }, [{ ...row, products: [] }], activity,
      [event("updated", row.id)]);
    await Effect.runPromise(validate(call, activity));
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.collection.table.name, row: { ...row, id: "skipped" } }] });
    await refused({ ...call, toAttempt: 2 }, { ...activity, mutations: [...activity.mutations,
      { ordinal: 1, table: catalog.product.table.name, operation: "patch", before: { id: "product", collection_id: null, deleted_at: null },
        after: { id: "product", collection_id: row.id, deleted_at: null } }] });
  });

  it("clears active prior members with [] and preserves native empty/null metadata replacement", async () => {
    for (const metadata of [{}, null]) {
      const before = { id: "collection", title: "Original", handle: "original", metadata: { old: true }, deleted_at: null };
      const after = { ...before, metadata };
      const product = { id: "member", collection_id: before.id, deleted_at: null };
      const activity: Activity = { ...empty(), mutations: [
        { ordinal: 0, table: catalog.collection.table.name, operation: "patch", before, after },
        { ordinal: 1, table: catalog.product.table.name, operation: "patch", before: product, after: { ...product, collection_id: null } },
      ], observedRows: [{ table: catalog.collection.table.name, row: after },
        { table: catalog.product.table.name, row: { ...product, collection_id: null } }] };
      const call = receipt("productUpdateCollectionsBySelector", { selector: { id: before.id }, update: { metadata, product_ids: [] } },
        [{ ...after, products: [] }], activity, [event("updated", before.id), productEvent(product.id)]);
      await Effect.runPromise(validate(call, activity));
      await refused({ ...call, toAttempt: 1 }, { ...activity, mutations: activity.mutations.slice(0, 1) });
    }
  });

  it("retains a missing selector's empty native result with an explicit empty membership request", async () => {
    const activity = empty();
    await Effect.runPromise(validate(receipt("productUpdateCollectionsBySelector", { selector: { id: "missing" }, update: { product_ids: [] } }, [], activity), activity));
  });

  it("requires exact soft-delete root coverage and preserves duplicate request coalescing", async () => {
    const before: JsonObject = { id: "collection", title: "Original", handle: "original", metadata: null, deleted_at: null };
    const after = { ...before, deleted_at: "2026-10-16T01:00:00.000Z" };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: catalog.collection.table.name, operation: "patch", before, after }],
      lifecycle: [{ table: catalog.collection.table.name, key: { id: "collection" }, operation: "softDelete", beforeDeletedAt: null,
        afterDeletedAt: after.deleted_at, attemptOrdinal: 0, rowAtOperation: null }], observedRows: [{ table: catalog.collection.table.name, row: after }] };
    const call = receipt("productSoftDeleteCollectionsForWorkflow", ["collection", "missing", "collection"],
      { product_collection_id: ["collection"] }, activity, [event("deleted", "collection")]);
    await Effect.runPromise(validate(call, activity));
    await refused({ ...call, result: {} }, activity);
    await refused(call, { ...activity, lifecycle: [] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: catalog.collection.table.name, row: { ...before, id: "missing" } }] });
    await refused(call, { ...activity, setNull: [{ sourceTable: catalog.product.table.name, sourceColumn: "collection_id",
      targetTable: catalog.collection.table.name, targetColumn: "id", targetKey: "collection", managedUpdate: "advance" }] });
  });

  it("admits missing/already-deleted lifecycle no-ops without transitions or Product effects", async () => {
    const activity: Activity = { ...empty(), observedRows: [{ table: catalog.collection.table.name,
      row: { id: "deleted", title: "Old", handle: "old", deleted_at: "2026-10-16T01:00:00.000Z" } }] };
    for (const ids of [[], ["missing"], ["deleted", "missing", "deleted"]])
      await Effect.runPromise(validate(receipt("productSoftDeleteCollectionsForWorkflow", ids, {}, activity), activity));
  });
});
