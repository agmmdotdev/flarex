import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productLogicalOptionEventPolicy } from "../src/modules/product/events/entity";
import { productLogicalLifecycleEventPolicy } from "../src/modules/product/events/lifecycle";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Mutation = Activity["mutations"][number];
let catalog: ProductRuntimeMetadata;
const first = "2026-10-19T01:00:00.000Z", next = "2026-10-19T02:00:00.000Z";
const option = (id: string, fields: JsonObject = {}): JsonObject => ({ id, title: id, product_id: "product", metadata: null,
  created_at: first, updated_at: first, deleted_at: null, ...fields });
const value = (id: string, text: string, owner = "option", fields: JsonObject = {}): JsonObject => ({ id, value: text,
  option_id: owner, metadata: null, created_at: first, updated_at: first, deleted_at: null, ...fields });
const event = (entity: "option" | "value", action: "created" | "updated" | "deleted", id: string | string[]): Json => {
  const target = catalog[entity];
  return { name: action === "created" ? target.createdEvent : action === "updated" ? target.updatedEvent : target.deletedEvent,
    metadata: { source: "product", object: target.eventObject, action }, data: { id } };
};
const activity = (mutations: Mutation[], observations: Activity["observedRows"] = []): Activity => ({
  mutations, observedRows: observations, lifecycle: [], setNull: [], referenceReplacements: [],
});
const call = (commandName: string, input: Json, result: Json, events: Json[], observed: Activity): Receipt => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: observed.mutations.length,
  fromLifecycle: 0, toLifecycle: observed.lifecycle.length,
});
const refused = async (policy: LogicalCallReceiptValidation, receipt: Receipt, observed: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy(receipt, observed))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

const replacement = () => {
  const before = option("option", { metadata: { old: true } }), after = { ...before, title: "Changed", metadata: { next: true }, updated_at: next };
  const keep = value("keep", "keep", "option", { metadata: { preserve: true } }), drop = value("drop", "drop"), added = value("added", "new");
  const pivot = { [catalog.pivot.variantColumn]: "variant", [catalog.pivot.valueColumn]: "drop" };
  const mutations: Mutation[] = [
    { ordinal: 0, table: catalog.pivot.table.name, operation: "delete", before: pivot, after: null },
    { ordinal: 1, table: catalog.value.table.name, operation: "delete", before: drop, after: null },
    { ordinal: 2, table: catalog.value.table.name, operation: "insert", before: null, after: added },
    { ordinal: 3, table: catalog.option.table.name, operation: "patch", before, after },
  ];
  const observed = activity(mutations, [
    { table: catalog.option.table.name, row: after }, { table: catalog.value.table.name, row: keep },
    { table: catalog.value.table.name, row: added }, { table: catalog.pivot.table.name, row: pivot },
    { table: catalog.product.table.name, row: { id: "product", deleted_at: null } },
    { table: catalog.variant.table.name, row: { id: "variant", product_id: "product", deleted_at: null } },
  ]);
  const receipt = call("productUpdateOptionsBySelector", { selector: { id: "option" },
    update: { title: "Changed", metadata: { next: true }, values: ["keep", "new"] } }, [{ ...after, values: [keep, added] }],
  [event("value", "deleted", "drop"), event("value", "created", "added"), event("option", "updated", "option")], observed);
  return { receipt, observed, before, after, keep, drop, added, pivot };
};

const lifecycle = () => {
  const root = option("option"), keep = value("keep", "keep"), deleted = value("already-deleted", "deleted", "option", { deleted_at: first });
  const mutations: Mutation[] = [root, keep, deleted].map((before, ordinal) => ({ ordinal,
    table: ordinal === 0 ? catalog.option.table.name : catalog.value.table.name, operation: "patch", before,
    after: { ...before, deleted_at: next, updated_at: next } }));
  const observed: Activity = { ...activity(mutations), lifecycle: mutations.map(mutation => ({ table: mutation.table,
    operation: "softDelete", key: { id: String(mutation.before?.id) }, beforeDeletedAt: mutation.ordinal === 2 ? first : null,
    afterDeletedAt: next, attemptOrdinal: mutation.ordinal, rowAtOperation: null })) };
  const receipt = call("productSoftDeleteOptionsForWorkflow", ["option", "option", "missing"],
    { product_option_id: ["option"], product_option_value_id: ["keep", "already-deleted"] },
    [event("option", "deleted", "option"), event("value", "deleted", "keep"), event("value", "updated", "already-deleted")], observed);
  return { receipt, observed, mutations };
};

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-option-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Option command receipts", () => {
  it("binds complete created roots and Values to requested fields and identities", async () => {
    const root = option("option"), red = value("red-id", "red");
    const observed = activity([{ ordinal: 0, table: catalog.option.table.name, operation: "insert", before: null, after: root },
      { ordinal: 1, table: catalog.value.table.name, operation: "insert", before: null, after: red }]);
    const receipt = call("productCreateOptionsForWorkflow", [{ id: "option", title: "option", product_id: "product", values: ["red"] }],
      [{ ...root, values: [red] }], [event("option", "created", "option"), event("value", "created", "red-id")], observed);
    const policy = productLogicalOptionEventPolicy(catalog, "create", "productCreateOptionsForWorkflow").validateLogicalCall;
    await Effect.runPromise(policy(receipt, observed));
    await refused(policy, { ...receipt, result: [{ id: "option", values: [red] }] }, observed);
    await refused(policy, { ...receipt, input: [{ id: "option", title: "forged", product_id: "product", values: ["red"] }] }, observed);
    await refused(policy, { ...receipt, result: [{ ...root, values: [{ ...red, option_id: "foreign" }] }] }, observed);
    await refused(policy, receipt, { ...observed, mutations: observed.mutations.map(mutation => mutation.table === catalog.value.table.name
      ? { ...mutation, after: { ...red, metadata: { forged: true } } } : mutation) });
  });

  it("preserves empty named creation and selection with no changes or events", async () => {
    const observed = activity([]);
    for (const [operation, name, input] of [
      ["create", "productCreateOptionsForWorkflow", []],
      ["selector", "productUpdateOptionsBySelector", { selector: { id: [] }, update: {} }],
    ] as const) {
      const policy = productLogicalOptionEventPolicy(catalog, operation, name).validateLogicalCall;
      const receipt = call(name, input, [], [], observed);
      await Effect.runPromise(policy(receipt, observed));
      await refused(policy, { ...receipt, events: [event("option", "updated", "extra")] }, observed);
    }
  });

  it("binds full selector preimages and native first-occurrence caller ID order", async () => {
    const before = [option("b"), option("a")], after = before.map(row => ({ ...row, metadata: { next: true }, updated_at: next }));
    const observed = activity(before.map((row, ordinal) => ({ ordinal, table: catalog.option.table.name, operation: "patch",
      before: row, after: after[ordinal] ?? null })), after.map(row => ({ table: catalog.option.table.name, row })));
    const receipt = call("productUpdateOptionsBySelector", { selector: { id: ["b", "a", "b", "missing"] }, update: { metadata: { next: true } } },
      after.map(row => ({ ...row, values: [] })), [event("option", "updated", ["b", "a"])], observed);
    const policy = productLogicalOptionEventPolicy(catalog, "selector").validateLogicalCall;
    await Effect.runPromise(policy(receipt, observed));
    await refused(policy, { ...receipt, input: { selector: { id: ["a", "b"] }, update: { metadata: { next: true } } } }, observed);
    await refused(policy, { ...receipt, result: after.toReversed().map(row => ({ ...row, values: [] })) }, observed);
    await refused(policy, { ...receipt, events: [event("option", "updated", ["a", "b"])] }, observed);
    await refused(policy, { ...receipt, input: { selector: {}, update: { metadata: { next: true } } } }, { ...observed,
      observedRows: [...observed.observedRows, { table: catalog.option.table.name, row: option("unselected") }] });
  });

  it("reuses matching Value IDs and proves exact replacement removals while preserving endpoints", async () => {
    const fixed = replacement(), policy = productLogicalOptionEventPolicy(catalog, "selector").validateLogicalCall;
    await Effect.runPromise(policy(fixed.receipt, fixed.observed));
    await refused(policy, { ...fixed.receipt, result: [{ ...fixed.after, values: [{ ...fixed.keep, id: "replacement-id" }, fixed.added] }] }, fixed.observed);
    await refused(policy, fixed.receipt, { ...fixed.observed, mutations: fixed.observed.mutations.filter(value => value.table !== catalog.pivot.table.name)
      .map((value, ordinal) => ({ ...value, ordinal })) });
    await refused(policy, fixed.receipt, { ...fixed.observed, mutations: [...fixed.observed.mutations,
      { ordinal: 4, table: catalog.product.table.name, operation: "delete", before: { id: "product" }, after: null }] });
    await refused(policy, fixed.receipt, { ...fixed.observed, mutations: fixed.observed.mutations.map(value => value.table === catalog.pivot.table.name
      ? { ...value, before: { ...fixed.pivot, [catalog.pivot.valueColumn]: "keep" } } : value) });
  });

  it("distinguishes omitted Values from [] and replaces metadata as a whole", async () => {
    const before = option("option", { metadata: { old: true } }), kept = value("kept", "kept");
    for (const metadata of [null, {}, { next: true }]) {
      const after = { ...before, metadata, updated_at: next };
      const observed = activity([{ ordinal: 0, table: catalog.option.table.name, operation: "patch", before, after }],
        [{ table: catalog.value.table.name, row: kept }]);
      const receipt = call("productupdateoption", { id: "option", data: { metadata } }, { ...after, values: [kept] },
        [event("option", "updated", "option")], observed);
      const policy = productLogicalOptionEventPolicy(catalog, "update").validateLogicalCall;
      await Effect.runPromise(policy(receipt, observed));
      await refused(policy, { ...receipt, input: { id: "option", data: { metadata, values: [] } } }, observed);
      await refused(policy, { ...receipt, result: { ...after, values: [] } }, observed);
    }
    const fixed = replacement();
    await refused(productLogicalOptionEventPolicy(catalog, "selector").validateLogicalCall,
      { ...fixed.receipt, input: { selector: { id: "option" }, update: { title: "Changed", metadata: { next: true } } } }, fixed.observed);
    const cleared = { ...before, metadata: null, updated_at: next };
    const clearActivity = activity([{ ordinal: 0, table: catalog.value.table.name, operation: "delete", before: kept, after: null },
      { ordinal: 1, table: catalog.option.table.name, operation: "patch", before, after: cleared }]);
    await Effect.runPromise(productLogicalOptionEventPolicy(catalog, "update").validateLogicalCall(
      call("productupdateoption", { id: "option", data: { metadata: null, values: [] } }, { ...cleared, values: [] },
        [event("value", "deleted", "kept"), event("option", "updated", "option")], clearActivity), clearActivity));
  });

  it("uses all persisted Values for explicit removal but only active Values for reuse and output", async () => {
    const fixed = replacement(), policy = productLogicalOptionEventPolicy(catalog, "selector").validateLogicalCall;
    const deletedDrop = { ...fixed.drop, deleted_at: first };
    const sameTextNew = { ...fixed.added, value: "drop" };
    const replacementActivity: Activity = { ...fixed.observed,
      mutations: fixed.observed.mutations.map(mutation => mutation.before?.id === "drop"
        ? { ...mutation, before: deletedDrop } : mutation.after?.id === "added" ? { ...mutation, after: sameTextNew } : mutation),
      observedRows: [...fixed.observed.observedRows, { table: catalog.value.table.name, row: deletedDrop }] };
    const replacementCall: Receipt = { ...fixed.receipt, input: { selector: { id: "option" },
      update: { title: "Changed", metadata: { next: true }, values: ["keep", "drop"] } },
    result: [{ ...fixed.after, values: [fixed.keep, sameTextNew] }] };
    await Effect.runPromise(policy(replacementCall, replacementActivity));
    await refused(policy, { ...replacementCall, result: [{ ...fixed.after, values: [fixed.keep, deletedDrop] }] }, replacementActivity);
    const rootMutation = fixed.observed.mutations.find(mutation => mutation.table === catalog.option.table.name);
    if (rootMutation === undefined) throw new Error("Missing fixed root mutation");
    const omittedActivity = activity([{ ...rootMutation, ordinal: 0 }], [
      { table: catalog.value.table.name, row: fixed.keep }, { table: catalog.value.table.name, row: deletedDrop },
      { table: catalog.pivot.table.name, row: fixed.pivot },
    ]);
    const omittedCall = call("productUpdateOptionsBySelector", { selector: { id: "option" }, update: { title: "Changed", metadata: { next: true } } },
      [{ ...fixed.after, values: [fixed.keep] }], [event("option", "updated", "option")], omittedActivity);
    await Effect.runPromise(policy(omittedCall, omittedActivity));
    await refused(policy, { ...omittedCall, result: [{ ...fixed.after, values: [fixed.keep, deletedDrop] }] }, omittedActivity);
  });

  it("preserves existing create/upsert and physical-delete consumers", async () => {
    const root = option("created");
    const created = activity([{ ordinal: 0, table: catalog.option.table.name, operation: "insert", before: null, after: root }]);
    const input = { title: "created", product_id: "product" }, result = { ...root, values: [] };
    for (const [operation, name] of [["create", "productCreateoption"], ["upsert", "productupsertoption"]] as const)
      await Effect.runPromise(productLogicalOptionEventPolicy(catalog, operation).validateLogicalCall(
        call(name, input, result, [event("option", "created", "created")], created), created));
    const old = value("old", "old", "created");
    const removed = activity([{ ordinal: 0, table: catalog.value.table.name, operation: "delete", before: old, after: null },
      { ordinal: 1, table: catalog.option.table.name, operation: "delete", before: root, after: null }]);
    await Effect.runPromise(productLogicalOptionEventPolicy(catalog, "delete").validateLogicalCall(
      call("productDeleteoption", "created", null, [event("option", "deleted", "created")], removed), removed));
  });

  it("preserves missing, mixed and duplicate physical deletions while requiring every present root", async () => {
    const policy = productLogicalOptionEventPolicy(catalog, "delete").validateLogicalCall;
    const missing = activity([]);
    for (const ids of [["missing-option"], ["missing-option", "missing-option"], []])
      await Effect.runPromise(policy(call("productDeleteoption", ids, null, [], missing), missing));
    for (const deleted_at of [null, first]) {
      const root = option("present", { deleted_at }), child = value("owned", "owned", "present");
      const pivot = { [catalog.pivot.variantColumn]: "variant", [catalog.pivot.valueColumn]: "owned" };
      const observed = activity([
        { ordinal: 0, table: catalog.pivot.table.name, operation: "delete", before: pivot, after: null },
        { ordinal: 1, table: catalog.value.table.name, operation: "delete", before: child, after: null },
        { ordinal: 2, table: catalog.option.table.name, operation: "delete", before: root, after: null },
      ], [{ table: catalog.option.table.name, row: root }, { table: catalog.value.table.name, row: child },
        { table: catalog.pivot.table.name, row: pivot }]);
      const receipt = call("productDeleteoption", ["missing-option", "present", "present"], null,
        [event("option", "deleted", "present")], observed);
      await Effect.runPromise(policy(receipt, observed));
      await refused(policy, { ...receipt, input: ["missing-option"] }, observed);
      await refused(policy, { ...receipt, events: [event("option", "deleted", ["present", "present"])] }, observed);
      await refused(policy, { ...receipt, events: [event("option", "deleted", ["present", "missing-option"])] }, observed);
      await refused(policy, receipt, { ...observed, mutations: [] });
      await refused(policy, receipt, { ...observed, mutations: observed.mutations.filter(mutation => mutation.table !== catalog.value.table.name)
        .map((mutation, ordinal) => ({ ...mutation, ordinal })) });
      await refused(policy, receipt, { ...observed, mutations: observed.mutations.filter(mutation => mutation.table !== catalog.pivot.table.name)
        .map((mutation, ordinal) => ({ ...mutation, ordinal })) });
      await refused(policy, receipt, { ...observed, mutations: [...observed.mutations,
        { ordinal: 3, table: catalog.option.table.name, operation: "delete", before: root, after: null }] });
    }
    await refused(policy, call("productDeleteoption", ["missing-option"], null,
      [event("option", "deleted", "missing-option")], missing), missing);
  });

  it("authenticates mapped Option lifecycle cascades including native retimestamped Values", async () => {
    const fixed = lifecycle();
    await Effect.runPromise(productLogicalLifecycleEventPolicy(catalog, "softDelete", "option").validateLogicalCall(fixed.receipt, fixed.observed));
  });

  it("preserves empty, missing and already-deleted root noops and raw duplicate requests", async () => {
    const policy = productLogicalLifecycleEventPolicy(catalog, "softDelete", "option").validateLogicalCall;
    for (const ids of [[], ["missing"], ["gone", "gone", "missing"]]) {
      const observed = activity([], [{ table: catalog.option.table.name, row: option("gone", { deleted_at: first }) }]);
      await Effect.runPromise(policy(call("productSoftDeleteOptionsForWorkflow", ids, {}, [], observed), observed));
    }
    const root = option("empty-values"), after = { ...root, deleted_at: next, updated_at: next };
    const observed: Activity = { ...activity([{ ordinal: 0, table: catalog.option.table.name, operation: "patch", before: root, after }]),
      lifecycle: [{ table: catalog.option.table.name, operation: "softDelete", key: { id: "empty-values" }, beforeDeletedAt: null,
        afterDeletedAt: next, attemptOrdinal: 0, rowAtOperation: null }] };
    await Effect.runPromise(policy(call("productSoftDeleteOptionsForWorkflow", ["empty-values"], { product_option_id: ["empty-values"] },
      [event("option", "deleted", "empty-values")], observed), observed));
  });

  it("requires complete Option and Value lifecycle coverage and exact mapped keys", async () => {
    const fixed = lifecycle(), policy = productLogicalLifecycleEventPolicy(catalog, "softDelete", "option").validateLogicalCall;
    for (const result of [{}, { product_option_id: ["option"] }, { product_option_id: ["option", "option"], product_option_value_id: ["keep", "already-deleted"] },
      { product_option_id: ["option"], product_option_value_id: ["keep", "foreign"] }]) await refused(policy, { ...fixed.receipt, result }, fixed.observed);
    await refused(policy, fixed.receipt, { ...fixed.observed, lifecycle: fixed.observed.lifecycle.slice(0, 2) });
    await refused(policy, fixed.receipt, { ...fixed.observed, mutations: fixed.mutations.map((value, index) => index === 1
      ? { ...value, after: { ...value.after, value: "forged" } } : value) });
    await refused(policy, { ...fixed.receipt, events: [event("option", "deleted", "option"), event("value", "deleted", ["keep", "already-deleted"])] }, fixed.observed);
    await refused(policy, fixed.receipt, { ...fixed.observed, mutations: fixed.mutations.map((value, index) => index === 1
      ? { ...value, before: { ...value.before, option_id: "foreign" }, after: { ...value.after, option_id: "foreign" } } : value) });
  });

  it("binds mapped root and Value array order to authentic per-table lifecycle observations", async () => {
    const fixed = lifecycle(), policy = productLogicalLifecycleEventPolicy(catalog, "softDelete", "option").validateLogicalCall;
    await refused(policy, { ...fixed.receipt, result: { product_option_id: ["option"],
      product_option_value_id: ["already-deleted", "keep"] } }, fixed.observed);
    const root = option("second"), after = { ...root, deleted_at: next, updated_at: next };
    const firstRoot = fixed.mutations[0], firstLifecycle = fixed.observed.lifecycle[0];
    if (firstRoot === undefined || firstLifecycle === undefined) throw new Error("Missing fixed lifecycle root");
    const observed: Activity = { ...fixed.observed,
      mutations: [firstRoot, { ordinal: 1, table: catalog.option.table.name, operation: "patch" as const, before: root, after },
        ...fixed.mutations.slice(1)].map((mutation, ordinal) => ({ ...mutation, ordinal })),
      lifecycle: [firstLifecycle, { table: catalog.option.table.name, operation: "softDelete" as const, key: { id: "second" },
        beforeDeletedAt: null, afterDeletedAt: next, attemptOrdinal: 1, rowAtOperation: null }, ...fixed.observed.lifecycle.slice(1)]
        .map((observation, attemptOrdinal) => ({ ...observation, attemptOrdinal })) };
    const receipt: Receipt = { ...fixed.receipt, input: ["second", "option"], toAttempt: 4, toLifecycle: 4,
      result: { product_option_id: ["option", "second"], product_option_value_id: ["keep", "already-deleted"] },
      events: [event("option", "deleted", "option"), event("option", "deleted", "second"),
        event("value", "deleted", "keep"), event("value", "updated", "already-deleted")] };
    await Effect.runPromise(policy(receipt, observed));
    await refused(policy, { ...receipt, result: { product_option_id: ["second", "option"],
      product_option_value_id: ["keep", "already-deleted"] } }, observed);
  });
});
