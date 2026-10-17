import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { captureCategoryProjection } from "../src/modules/product/category-projection";
import { categoryWorkflowCreatePolicy, categoryWorkflowSelectorUpdatePolicy, categoryWorkflowSoftDeletePolicy } from "../src/modules/product/events/category-workflow";
import { categoryCreateEventPolicy, internalCategoryPolicy } from "../src/modules/product/events/category";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Mutation = Activity["mutations"][number];
let catalog: ProductRuntimeMetadata;
const stamp = "2026-10-18T01:00:00.000Z";
const changed = "2026-10-18T02:00:00.000Z";
const row = (id: string, rank: number, parent: string | null = null, fields: JsonObject = {}): JsonObject => ({
  id, name: id, description: "", handle: id, mpath: parent === null ? id : parent + "." + id,
  rank, parent_category_id: parent, is_active: false, is_internal: false, metadata: null,
  created_at: stamp, updated_at: stamp, deleted_at: null, ...fields,
});
const projection = (rows: readonly JsonObject[]) => Result.getOrThrow(captureCategoryProjection(rows, defaultCommerceResources));
const event = (action: "created" | "updated" | "deleted", id: string | string[]): Json => ({
  name: action === "created" ? catalog.category.createdEvent : action === "updated" ? catalog.category.updatedEvent : catalog.category.deletedEvent,
  metadata: { source: "product", object: catalog.category.eventObject, action }, data: { id },
});
const emptyActivity = (): Activity => ({ mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [], observedRows: [] });
const receipt = (commandName: string, input: Json, result: Json, events: Json[], activity: Activity): Receipt => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: activity.mutations.length,
  fromLifecycle: 0, toLifecycle: activity.lifecycle.length,
});
const refused = async (policy: LogicalCallReceiptValidation, call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

/** These are explicit native mutation transcripts. The helper only records
 * supplied after fields and pending before images; it performs no selection,
 * tree, rank or event calculation. */
const transcript = (initial: readonly JsonObject[], changes: readonly (readonly [string, JsonObject])[]) => {
  const pending = new Map(initial.map(value => [value.id, value]));
  const mutations: Mutation[] = changes.map(([id, fields], ordinal) => {
    const before = pending.get(id);
    if (before === undefined) throw new Error("Invalid fixed transcript identity");
    const after = { ...before, ...fields, updated_at: changed };
    pending.set(id, after);
    return { ordinal, table: catalog.category.table.name, operation: "patch", before, after };
  });
  const activity: Activity = { ...emptyActivity(), mutations,
    observedRows: [...pending.values()].map(value => ({ table: catalog.category.table.name, row: value })) };
  return { activity, mutations };
};

const movingRoots = () => {
  const initial = [row("old-parent", 0), row("new-parent", 1),
    row("a", 0, "old-parent", { metadata: { old: true } }), row("b", 1, "old-parent"),
    row("old-tail", 2, "old-parent"), row("target", 0, "new-parent"),
    row("a-child", 0, "a", { mpath: "old-parent.a.a-child" }), row("foreign", 2)];
  const fixed = transcript(initial, [
    ["b", { rank: 0 }], ["old-tail", { rank: 1 }], ["target", { rank: 1 }],
    ["a", { rank: 0, parent_category_id: "new-parent", mpath: "new-parent.a", metadata: { next: true } }],
    ["a-child", { mpath: "new-parent.a.a-child" }], ["old-tail", { rank: 0 }],
    ["a", { rank: 1 }], ["target", { rank: 2 }],
    ["b", { rank: 0, parent_category_id: "new-parent", mpath: "new-parent.b", metadata: { next: true } }],
  ]);
  const a = fixed.mutations[3]?.after, b = fixed.mutations[8]?.after;
  if (a === null || a === undefined || b === null || b === undefined) throw new Error("Incomplete fixed transcript");
  return { ...fixed, initial, call: receipt("productUpdateCategoriesBySelector",
    { selector: { id: ["b", "a"] }, update: { parent_category_id: "new-parent", rank: 0, metadata: { next: true } } },
    projection([a, b]), ["b", "old-tail", "target", "a", "a-child"].map(id => event("updated", id))
      .concat([event("updated", ["a", "b"])]), fixed.activity) };
};

const deletedLeaves = (ids: string[], rankChanges: readonly (readonly [string, number])[]) => {
  const initial = [row("a", 0), row("b", 1), row("c", 2), row("d", 3)];
  const fixed = transcript(initial, [...rankChanges.map(([id, rank]): readonly [string, JsonObject] => [id, { rank }]),
    ...[...new Set(ids)].map((id): readonly [string, JsonObject] => [id, { deleted_at: changed }])]);
  const rootStart = rankChanges.length;
  const lifecycle: Activity["lifecycle"] = [...new Set(ids)].map((id, index) => ({
    table: catalog.category.table.name, operation: "softDelete", key: { id }, beforeDeletedAt: null,
    afterDeletedAt: changed, attemptOrdinal: rootStart + index, rowAtOperation: null,
  }));
  const activity = { ...fixed.activity, lifecycle };
  const events = [...new Set(rankChanges.map(([id]) => id))].map(id => event("updated", id))
    .concat([...new Set(ids)].map(id => event("deleted", id)));
  return { ...fixed, activity, call: receipt("productSoftDeleteCategoriesForWorkflow", ids, {}, events, activity) };
};

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-category-workflow-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Category workflow receipts", () => {
  it("admits empty create/update/delete only with their exact empty effects", async () => {
    const activity = emptyActivity();
    const cases: ReadonlyArray<readonly [LogicalCallReceiptValidation, Receipt]> = [
      [categoryWorkflowCreatePolicy(catalog), receipt("productCreateCategoriesForWorkflow", [], projection([]), [], activity)],
      [categoryWorkflowSelectorUpdatePolicy(catalog), receipt("productUpdateCategoriesBySelector", { selector: {}, update: {} }, projection([]), [], activity)],
      [categoryWorkflowSoftDeletePolicy(catalog), receipt("productSoftDeleteCategoriesForWorkflow", [], {}, [], activity)],
    ];
    for (const [policy, call] of cases) {
      await Effect.runPromise(policy(call, activity));
      await refused(policy, { ...call, events: [event("updated", "extra")] }, activity);
    }
  });

  it("preserves nullish native handle defaults, empty handles and grouped create events", async () => {
    const created = [row("a", 0, null, { name: "Native Name", handle: "native-name" }), row("b", 1, null, { handle: "" })];
    const activity: Activity = { ...emptyActivity(), mutations: created.map((after, ordinal) => ({ ordinal,
      table: catalog.category.table.name, operation: "insert", before: null, after })) };
    const call = receipt("productCreateCategoriesForWorkflow", [{ id: "a", name: "Native Name", handle: null },
      { id: "b", name: "b", handle: "" }], projection(created), [event("created", ["a", "b"])], activity);
    const policy = categoryWorkflowCreatePolicy(catalog);
    await Effect.runPromise(policy(call, activity));
    await refused(policy, { ...call, result: projection([...created].reverse()) }, activity);
    await refused(policy, { ...call, input: [{ id: "a", name: "Native Name", handle: "wrong" }, { id: "b", name: "b", handle: "" }] }, activity);
    for (const events of [[event("created", "a"), event("created", "b")], [event("created", ["b", "a"])],
      [event("created", ["a", "b", "a"])], [event("created", ["a", "b"]), event("created", "a")],
      [event("created", "a")], []]) await refused(policy, { ...call, events }, activity);
  });

  it("requires first-touch scalar rank-shift callbacks before the single manual creation message", async () => {
    const shifted = transcript([row("x", 0), row("y", 1)], [["x", { rank: 1 }], ["y", { rank: 2 }]]);
    const created = row("a", 0);
    const activity: Activity = { ...shifted.activity, mutations: [...shifted.mutations,
      { ordinal: 2, table: catalog.category.table.name, operation: "insert", before: null, after: created }] };
    const call = receipt("productCreateCategoriesForWorkflow", [{ id: "a", name: "a", rank: 0 }], projection([created]),
      [event("updated", "x"), event("updated", "y"), event("created", "a")], activity);
    const policy = categoryWorkflowCreatePolicy(catalog);
    await Effect.runPromise(policy(call, activity));
    for (const events of [[event("updated", "y"), event("updated", "x"), event("created", "a")],
      [event("created", "a"), event("updated", "x"), event("updated", "y")],
      [event("updated", ["x", "y"]), event("created", "a")],
      [event("updated", "x"), event("updated", "y"), event("created", ["a"])],
      [...call.events, event("updated", "x")], call.events.slice(1)]) await refused(policy, { ...call, events }, activity);
  });

  it("rejects forged native creation rank/path fields through the shared public and internal owners", async () => {
    const forged = row("a", 37, null, { mpath: "foreign.a" });
    const activity: Activity = { ...emptyActivity(), mutations: [{ ordinal: 0, table: catalog.category.table.name,
      operation: "insert", before: null, after: forged }] };
    const input: JsonObject[] = [{ id: "a", name: "a", rank: 0 }];
    const call = receipt("productCreateCategoriesForWorkflow", input, projection([forged]), [event("created", "a")], activity);
    await refused(categoryWorkflowCreatePolicy(catalog), call, activity);
    await refused(categoryCreateEventPolicy(catalog).validateLogicalCall,
      { ...call, commandName: "productCreatecategory", result: [forged] }, activity);
    await refused(internalCategoryPolicy(catalog, "create").validateLogicalCall,
      { ...call, commandName: "productInternalCategorycreate", events: [] }, activity);
    for (const [requestedRank, storedRank] of [[-1, -1], [Number.MAX_SAFE_INTEGER + 1, 0]] as const) {
      const invalid = row("a", storedRank);
      const invalidActivity: Activity = { ...emptyActivity(), mutations: [{ ordinal: 0,
        table: catalog.category.table.name, operation: "insert", before: null, after: invalid }] };
      await refused(internalCategoryPolicy(catalog, "create").validateLogicalCall,
        receipt("productInternalCategorycreate", [{ id: "a", name: "a", rank: requestedRank }], projection([invalid]), [], invalidActivity), invalidActivity);
    }
  });

  it("rejects dotted and reserved identities and parents through every creation owner", async () => {
    const cases: ReadonlyArray<readonly [JsonObject, JsonObject, readonly JsonObject[]]> = [
      ...["a.b", "__root__"].flatMap(id => [
        [{ id, name: "a" }, row(id, 0, null, { name: "a" }), []],
        [{ name: "a" }, row(id, 0, null, { name: "a" }), []],
      ] satisfies Array<readonly [JsonObject, JsonObject, readonly JsonObject[]]>),
      ...["parent.invalid", "__root__"].map(parent => [
        { id: "a", name: "a", parent_category_id: parent }, row("a", 0, parent), [row(parent, 0)],
      ] satisfies readonly [JsonObject, JsonObject, readonly JsonObject[]]),
    ];
    for (const [input, created, observed] of cases) {
      const activity: Activity = { ...emptyActivity(), mutations: [{ ordinal: 0, table: catalog.category.table.name,
        operation: "insert", before: null, after: created }],
      observedRows: observed.map(row => ({ table: catalog.category.table.name, row })) };
      const call = receipt("productCreateCategoriesForWorkflow", [input], projection([created]),
        [event("created", typeof created.id === "string" ? created.id : "invalid")], activity);
      await refused(categoryWorkflowCreatePolicy(catalog), call, activity);
      await refused(categoryCreateEventPolicy(catalog).validateLogicalCall,
        { ...call, commandName: "productCreatecategory", result: [created] }, activity);
      await refused(internalCategoryPolicy(catalog, "create").validateLogicalCall,
        { ...call, commandName: "productInternalCategorycreate", events: [] }, activity);
    }
  });

  it("binds exact ordered creation shift cohorts and managed-only changes", async () => {
    const shifted = transcript([row("x", 0), row("y", 1)], [["x", { rank: 1 }], ["y", { rank: 2 }]]);
    const created = row("a", 0);
    const insert: Mutation = { ordinal: 2, table: catalog.category.table.name, operation: "insert", before: null, after: created };
    const activity: Activity = { ...shifted.activity, mutations: [...shifted.mutations, insert] };
    const call = receipt("productCreateCategoriesForWorkflow", [{ id: "a", name: "a", rank: 0 }], projection([created]),
      [event("updated", "x"), event("updated", "y"), event("created", "a")], activity);
    const policy = categoryWorkflowCreatePolicy(catalog);
    await Effect.runPromise(policy(call, activity));
    const x = shifted.mutations[0], y = shifted.mutations[1];
    if (x === undefined || y === undefined) throw new Error("Missing fixed shifts");
    const variants: Mutation[][] = [
      [x, insert], [y, x, insert], [x, y, y, insert],
      [{ ...x, after: { ...x.after, rank: 99, mpath: "foreign.x" } }, y, insert],
      [{ ...x, after: { ...x.after, metadata: { forged: true } } }, y, insert],
      [x, { ...y, before: { ...y.before, rank: 0 } }, insert],
    ];
    for (const mutations of variants) await refused(policy, call, { ...activity,
      mutations: mutations.map((mutation, ordinal) => ({ ...mutation, ordinal })) });
    const foreign = row("foreign", 4);
    await refused(policy, call, { ...activity, mutations: [...activity.mutations,
      { ordinal: 3, table: catalog.category.table.name, operation: "patch", before: foreign,
        after: { ...foreign, rank: 5, updated_at: changed } }],
      observedRows: [...activity.observedRows, { table: catalog.category.table.name, row: foreign }] });
  });

  it("uses initial sibling counts plus batch offsets and preserves earlier intermediate creation results", async () => {
    const a = row("a", 0), b = row("b", 0), c = row("c", 2), child = row("child", 0, "a");
    const shiftedA = { ...a, rank: 1, updated_at: changed };
    const activity: Activity = { ...emptyActivity(), mutations: [
      { ordinal: 0, table: catalog.category.table.name, operation: "insert", before: null, after: a },
      { ordinal: 1, table: catalog.category.table.name, operation: "patch", before: a, after: shiftedA },
      { ordinal: 2, table: catalog.category.table.name, operation: "insert", before: null, after: b },
      { ordinal: 3, table: catalog.category.table.name, operation: "insert", before: null, after: c },
      { ordinal: 4, table: catalog.category.table.name, operation: "insert", before: null, after: child },
    ], observedRows: [shiftedA, b, c, child].map(row => ({ table: catalog.category.table.name, row })) };
    const call = receipt("productCreateCategoriesForWorkflow", [
      { id: "a", name: "a" }, { id: "b", name: "b", rank: 0 }, { id: "c", name: "c", rank: 99 },
      { id: "child", name: "child", parent_category_id: "a" },
    ], projection([a, b, c, child]), [event("updated", "a"), event("created", ["a", "b", "c", "child"])], activity);
    const policy = categoryWorkflowCreatePolicy(catalog);
    await Effect.runPromise(policy(call, activity));
    await refused(policy, { ...call, result: projection([shiftedA, b, c, child]) }, activity);
    await refused(policy, { ...call, input: [{ id: "a", name: "a" }, { id: "b", name: "b", rank: 0 },
      { id: "c", name: "c", rank: 99 }, { id: "child", name: "child", parent_category_id: "missing" }] }, activity);
  });

  it("binds native ordered maintenance, path descendants and intermediate root results", async () => {
    const fixed = movingRoots();
    await Effect.runPromise(categoryWorkflowSelectorUpdatePolicy(catalog)(fixed.call, fixed.activity));
    // a's returned rank is zero, before the later b move changes its stored rank to one.
    expect(fixed.mutations[3]?.after?.rank).toBe(0);
    expect(fixed.mutations[6]?.after?.rank).toBe(1);
  });

  it("rejects skipped, repeated, reordered and unrelated maintenance", async () => {
    const fixed = movingRoots(), policy = categoryWorkflowSelectorUpdatePolicy(catalog);
    const variants = [fixed.mutations.filter((_, index) => index !== 1),
      [fixed.mutations[0], ...fixed.mutations],
      [fixed.mutations[1], fixed.mutations[0], ...fixed.mutations.slice(2)]];
    for (const mutations of variants) {
      if (mutations.some(value => value === undefined)) throw new Error("Incomplete fixed transcript");
      const defined = mutations.filter((value): value is Mutation => value !== undefined);
      await refused(policy, fixed.call, { ...fixed.activity, mutations: defined.map((value, ordinal) => ({ ...value, ordinal })) });
    }
    const extra = transcript([row("foreign", 2)], [["foreign", { rank: 99 }]]).mutations[0];
    if (extra === undefined) throw new Error("Missing extra mutation");
    await refused(policy, fixed.call, { ...fixed.activity, mutations: [...fixed.mutations, { ...extra, ordinal: fixed.mutations.length }] });
  });

  it("rejects stale pending preimages, arbitrary deltas, metadata merge and foreign paths", async () => {
    const fixed = movingRoots(), policy = categoryWorkflowSelectorUpdatePolicy(catalog);
    const corruptions: ReadonlyArray<readonly [number, Partial<Mutation>]> = [
      [7, { before: fixed.initial.find(value => value.id === "target") ?? null }],
      [1, { after: { ...fixed.mutations[1]?.after, rank: 100 } }],
      [3, { after: { ...fixed.mutations[3]?.after, metadata: { old: true, next: true } } }],
      [4, { after: { ...fixed.mutations[4]?.after, mpath: "new-parent.foreign" } }],
    ];
    for (const [index, fields] of corruptions) await refused(policy, fixed.call, { ...fixed.activity,
      mutations: fixed.mutations.map((mutation, ordinal) => ordinal === index ? { ...mutation, ...fields } : mutation) });
    const finalA = fixed.mutations[6]?.after, b = fixed.mutations[8]?.after;
    if (finalA === null || finalA === undefined || b === null || b === undefined) throw new Error("Missing final rows");
    await refused(policy, { ...fixed.call, result: projection([finalA, b]) }, fixed.activity);
  });

  it("requires scalar first-touch events followed by the distinct ordered native root bulk", async () => {
    const fixed = movingRoots(), policy = categoryWorkflowSelectorUpdatePolicy(catalog);
    for (const events of [fixed.call.events.slice(0, -1), [...fixed.call.events].reverse(),
      [...fixed.call.events, event("updated", "a")],
      [...fixed.call.events.slice(0, -1), event("updated", ["b", "a"])],
      [event("updated", ["b", "old-tail", "target", "a", "a-child", "a", "b"])],
    ]) await refused(policy, { ...fixed.call, events }, fixed.activity);
  });

  it("binds complete selector evidence and binary Category order regardless of requested ID order", async () => {
    const fixed = movingRoots(), policy = categoryWorkflowSelectorUpdatePolicy(catalog);
    await Effect.runPromise(policy({ ...fixed.call, input: { selector: { id: ["a", "b", "a"] },
      update: { parent_category_id: "new-parent", rank: 0, metadata: { next: true } } } }, fixed.activity));
    const a = fixed.mutations[3]?.after, b = fixed.mutations[8]?.after;
    if (a === null || a === undefined || b === null || b === undefined) throw new Error("Missing selected rows");
    await refused(policy, { ...fixed.call, result: projection([b, a]) }, fixed.activity);
    await refused(policy, { ...fixed.call, input: { selector: {}, update: { metadata: { next: true } } } }, fixed.activity);
  });

  it("preserves metadata replacement and single-root event hash deduplication", async () => {
    for (const metadata of [null, {}, { next: true }]) {
      const fixed = transcript([row("a", 0, null, { metadata: { old: true } })], [["a", { metadata }]]);
      const after = fixed.mutations[0]?.after;
      if (after === null || after === undefined) throw new Error("Missing updated row");
      const call = receipt("productUpdateCategoriesBySelector", { selector: { name: "a", handle: "a", is_active: false, is_internal: false,
        parent_category_id: null }, update: { metadata } }, projection([after]), [event("updated", "a")], fixed.activity);
      await Effect.runPromise(categoryWorkflowSelectorUpdatePolicy(catalog)(call, fixed.activity));
    }
  });

  it("preserves duplicate leaf input and signed pending decrements from initial sibling cohorts", async () => {
    const fixed = deletedLeaves(["a", "a"], [["b", 0], ["c", 1], ["d", 2], ["b", -1], ["c", 0], ["d", 1]]);
    await Effect.runPromise(categoryWorkflowSoftDeletePolicy(catalog)(fixed.call, fixed.activity));
    const maximum = deletedLeaves(["a", "a", "a", "a"], [["b", 0], ["c", 1], ["d", 2],
      ["b", -1], ["c", 0], ["d", 1], ["b", -2], ["c", -1], ["d", 0], ["b", -3], ["c", -2], ["d", -1]]);
    await Effect.runPromise(categoryWorkflowSoftDeletePolicy(catalog)(maximum.call, maximum.activity));
  });

  it("retains both requested leaf orders with unique deletion coverage in request order", async () => {
    const cases = [deletedLeaves(["a", "b"], [["b", 0], ["c", 1], ["d", 2], ["c", 0], ["d", 1]]),
      deletedLeaves(["b", "a"], [["c", 1], ["d", 2], ["b", 0], ["c", 0], ["d", 1]])];
    for (const fixed of cases) await Effect.runPromise(categoryWorkflowSoftDeletePolicy(catalog)(fixed.call, fixed.activity));
  });

  it("refuses missing, already-deleted and parent-with-active-child successful receipts", async () => {
    const policy = categoryWorkflowSoftDeletePolicy(catalog), activity = emptyActivity();
    await refused(policy, receipt("productSoftDeleteCategoriesForWorkflow", ["missing"], {}, [], activity), activity);
    const fixed = deletedLeaves(["a"], [["b", 0], ["c", 1], ["d", 2]]);
    await refused(policy, fixed.call, { ...fixed.activity, observedRows: [...fixed.activity.observedRows,
      { table: catalog.category.table.name, row: row("child", 0, "a") }] });
    await refused(policy, receipt("productSoftDeleteCategoriesForWorkflow", ["a"], {}, [], activity), { ...activity,
      observedRows: [{ table: catalog.category.table.name, row: row("a", 0, null, { deleted_at: stamp }) }] });
  });

  it("requires exact leaf rank writes, lifecycle attempt coverage and event grouping", async () => {
    const fixed = deletedLeaves(["a", "a"], [["b", 0], ["c", 1], ["d", 2], ["b", -1], ["c", 0], ["d", 1]]);
    const policy = categoryWorkflowSoftDeletePolicy(catalog);
    await refused(policy, fixed.call, { ...fixed.activity, mutations: fixed.mutations.filter((_, index) => index !== 3)
      .map((value, ordinal) => ({ ...value, ordinal })) });
    await refused(policy, fixed.call, { ...fixed.activity, mutations: fixed.mutations.map((value, index) => index === 3
      ? { ...value, after: { ...value.after, rank: -10 } } : value) });
    await refused(policy, fixed.call, { ...fixed.activity, lifecycle: [] });
    await refused(policy, fixed.call, { ...fixed.activity, lifecycle: fixed.activity.lifecycle.map(value => ({ ...value, attemptOrdinal: 0 })) });
    await refused(policy, fixed.call, { ...fixed.activity, lifecycle: [...fixed.activity.lifecycle, ...fixed.activity.lifecycle] });
    await refused(policy, { ...fixed.call, result: { product_category_id: ["a"] } }, fixed.activity);
    for (const events of [[], [...fixed.call.events].reverse(), [...fixed.call.events, event("deleted", "a")],
      [event("updated", ["b", "c", "d"]), event("deleted", "a")]]) await refused(policy, { ...fixed.call, events }, fixed.activity);
  });
});
