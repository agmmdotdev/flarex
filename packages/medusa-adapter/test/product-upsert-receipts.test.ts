import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productLogicalUpsertEventPolicy, productLogicalUpdateEventPolicy } from "../src/modules/product/events/product";

type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-upsert-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});
const row = (id: string): JsonObject => ({ id, title: id, handle: id, deleted_at: null });
function witness(mixed = false) {
  const inserted = row("product-inserted"), updated = { ...row("product-existing"), title: "Updated" };
  const mutations: Activity["mutations"] = [
    { ordinal: 0, table: catalog.product.table.name, operation: "insert", before: null, after: inserted },
    ...(mixed ? [{ ordinal: 1, table: catalog.product.table.name, operation: "patch" as const, before: row("product-existing"), after: updated }] : []),
  ];
  const event = (id: string, created: boolean): Json => ({ name: created ? catalog.product.createdEvent : catalog.product.updatedEvent,
    metadata: { source: "product", object: catalog.product.eventObject, action: created ? "created" : "updated" }, data: { id } });
  const result = [inserted, ...(mixed ? [updated] : [])];
  const call: Receipt = { commandName: "productUpsert", mode: "write", input: result, result,
    events: [event("product-inserted", true), ...(mixed ? [event("product-existing", false)] : [])],
    fromAttempt: 0, toAttempt: mutations.length, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Activity = { mutations, observedRows: result.map(row => ({ table: catalog.product.table.name, row })),
    lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] };
  return { call, activity, event };
}
const refused = async (call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(productLogicalUpsertEventPolicy(catalog)(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("native Product upsert authentic insert and update receipts", () => {
  it.each([false, true])("admits authenticated missing-ID insertion with given identity, mixed=%s", async mixed => {
    const { call, activity } = witness(mixed);
    await Effect.runPromise(productLogicalUpsertEventPolicy(catalog)(call, activity));
  });
  it("retains ordinary existing-root update semantics", async () => {
    const { call, activity, event } = witness(true);
    const mutation = activity.mutations[1];
    if (mutation?.after === null || mutation === undefined) throw new Error("Missing existing root witness");
    await Effect.runPromise(productLogicalUpsertEventPolicy(catalog)({ ...call, input: [mutation.after], result: [mutation.after],
      events: [event("product-existing", false)] }, { ...activity, mutations: [{ ...mutation, ordinal: 0 }] }));
  });
  it("does not admit insertion through an ordinary update/selector receipt", async () => {
    const { call, activity } = witness();
    expect(await Effect.runPromise(Effect.result(productLogicalUpdateEventPolicy(catalog).validateLogicalCall({ ...call, commandName: "productUpdate" }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
  it("binds inserted IDs to explicit requests and authentic returned rows", async () => {
    const { call, activity } = witness();
    await refused({ ...call, input: [{ ...row("product-claimed"), title: "Changed" }] }, activity);
    await refused({ ...call, result: [{ ...row("product-inserted"), handle: "forged" }] }, activity);
  });
  it.each(["explicit-native-handle", ""])("matches provided handle=%s without creation-only derivation", async handle => {
    const { call, activity } = witness();
    const inserted = { ...row("product-inserted"), title: "Would derive another handle on creation", handle };
    const native = { ...call, input: [inserted], result: [inserted] };
    const facts = { ...activity, mutations: [{ ordinal: 0, table: catalog.product.table.name, operation: "insert" as const, before: null, after: inserted }],
      observedRows: [{ table: catalog.product.table.name, row: inserted }] };
    await Effect.runPromise(productLogicalUpsertEventPolicy(catalog)(native, facts));
    await refused({ ...native, result: [{ ...inserted, handle: "would-derive-another-handle-on-creation" }] }, facts);
  });
  it("requires created module events only for inserted roots and updated events for existing roots", async () => {
    const { call, activity, event } = witness(true);
    await refused({ ...call, events: [event("product-inserted", false), event("product-existing", false)] }, activity);
    await refused({ ...call, events: [event("product-inserted", true), event("product-existing", true)] }, activity);
  });
  it("keeps native inserted children and existing-child edits distinct in one mixed upsert", async () => {
    const { call, activity } = witness(true);
    const image = (id: string, product_id: string, url: string): JsonObject => ({ id, product_id, url, rank: 0, deleted_at: null });
    const inserted = image("image-new", "product-inserted", "new.png"), before = image("image-old", "product-existing", "before.png"),
      after = { ...before, url: "after.png" };
    const result = [
      { ...row("product-inserted"), images: [inserted] },
      { ...row("product-existing"), title: "Updated", images: [after] },
    ];
    const events: Json[] = [
      { name: catalog.image.createdEvent, metadata: { source: "product", object: catalog.image.eventObject, action: "created" }, data: { id: "image-new" } },
      { name: catalog.image.updatedEvent, metadata: { source: "product", object: catalog.image.eventObject, action: "updated" }, data: { id: "image-old" } },
    ];
    const expanded = { ...activity, mutations: [...activity.mutations,
      { ordinal: 2, table: catalog.image.table.name, operation: "insert" as const, before: null, after: inserted },
      { ordinal: 3, table: catalog.image.table.name, operation: "patch" as const, before, after },
    ] };
    const receipt = { ...call, input: result, result, events: [...call.events, ...events], toAttempt: expanded.mutations.length };
    await Effect.runPromise(productLogicalUpsertEventPolicy(catalog)(receipt, expanded));
    await refused(receipt, { ...expanded, mutations: expanded.mutations.map(mutation => mutation.ordinal === 2
      ? { ...mutation, operation: "patch", before: inserted } : mutation) });
  });
  it("rejects tombstone resurrection or changed ownership hidden as a fresh insert", async () => {
    const { call, activity } = witness();
    const mutation = activity.mutations[0];
    if (mutation?.after === null || mutation === undefined) throw new Error("Missing inserted root witness");
    await refused(call, { ...activity, mutations: [{ ...mutation, before: { ...mutation.after, deleted_at: "2026-11-10T00:00:00.000Z" } }] });
    const child = { id: "variant-foreign", product_id: "product-inserted", deleted_at: null };
    await refused(call, { ...activity, mutations: [...activity.mutations,
      { ordinal: 1, table: catalog.variant.table.name, operation: "patch", before: child, after: { ...child, title: "Invalid existing child" } }],
    });
  });
});
