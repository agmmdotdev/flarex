import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { compileOrderChangeDeletionContracts, decodeOrderChangeDeletionArguments, decodeOrderChangeDeletionIds } from "../src/modules/order/change-deletion-input";
import { orderChangeDeletionPolicy } from "../src/modules/order/change-deletion-receipt";
import { orderChangeUpdateRows } from "./support/logical-order-change-update-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Packet = { readonly call: Call; readonly activity: Activity };
let contracts: Result.Result.Success<ReturnType<typeof compileOrderChangeDeletionContracts>>;
let policy: ReturnType<typeof orderChangeDeletionPolicy>;
const time = "2020-02-03T04:05:06.000Z", deletedAt = "2026-10-24T01:00:00.000Z", restoredAt = "2026-10-24T02:00:00.000Z";
const seed = orderChangeUpdateRows();
function original(table: string): JsonObject {
  const selected = seed.find(value => value.table === table);
  if (selected === undefined) throw new Error("Missing complete Order Change fixture row: " + table);
  return selected.row;
}
const order: JsonObject = { ...original("order"), id: "order-delete-a", deleted_at: null };
const change: JsonObject = { ...original("order_change"), id: "change-delete-a", order_id: "order-delete-a", deleted_at: null };
const action: JsonObject = { ...original("order_change_action"), id: "action-delete-a", order_id: "order-delete-a",
  order_change_id: "change-delete-a", amount: "3.1250000000000000000", raw_amount: { value: "3.1250000000000000000", precision: 20 },
  details: { keep: true, nested: { empty: "", nullable: null } }, deleted_at: null };
const sibling: JsonObject = { ...action, id: "action-delete-b", ordering: 201, applied: false };
const deletedChange: JsonObject = { ...change, deleted_at: deletedAt, updated_at: deletedAt };
const deletedAction: JsonObject = { ...action, deleted_at: deletedAt, updated_at: deletedAt };
const deletedSibling: JsonObject = { ...sibling, deleted_at: deletedAt, updated_at: deletedAt };
const restoredChange: JsonObject = { ...change, updated_at: restoredAt };
const restoredAction: JsonObject = { ...action, updated_at: restoredAt };
const restoredSibling: JsonObject = { ...sibling, updated_at: restoredAt };
const rawIds = ["change-delete-a", "change-delete-a", "missing", ""];
const output: Json = { order_change_id: ["change-delete-a"], OrderChangeAction: [deletedAction, deletedSibling] };
const event = (object: "order_change" | "order_change_action", id: string, action: "deleted" | "restored" = "deleted"): Json => ({
  name: `order.${object.replaceAll("_", "-")}.${action}`, metadata: { source: "order", object, action }, data: { id },
});
const events = (action: "deleted" | "restored" = "deleted") => [event("order_change", "change-delete-a", action),
  event("order_change_action", "action-delete-a", action), event("order_change_action", "action-delete-b", action)];
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const read = (table: string, predicate: Json, count: number): Activity["relationalReads"][number] => ({ table,
  query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
const rootRead = (ids: readonly string[] = rawIds, count = 1) => read("order_change", { kind: "in", column: "id", values: [...ids] }, count);
const parentRead = (count = 1) => read("order", { kind: "and", children: [
  { kind: "in", column: "id", values: ["order-delete-a"] }, { kind: "isNull", column: "deleted_at" },
] }, count);
const childRead = () => read("order_change_action", { kind: "in", column: "order_change_id", values: ["change-delete-a"] }, 2);
const call = (restore = false): Call => ({ commandName: restore ? "orderChangeRestoreForWorkflow" : "orderChangeSoftDeleteForWorkflow",
  mode: "write", input: rawIds,
  result: restore ? { order_change_id: ["change-delete-a"], OrderChangeAction: [restoredAction, restoredSibling] } : output,
  events: events(restore ? "restored" : "deleted"),
  fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 3 });

// Fixed native transcript only: this fixture does not select rows, plan a
// lifecycle, derive a cascade or simulate storage/query execution.
const deletion = (): Activity => ({ ...empty(),
  observedRows: [{ table: "order_change", row: deletedChange }, { table: "order", row: order },
    { table: "order_change_action", row: deletedAction }, { table: "order_change_action", row: deletedSibling }],
  relationalReads: [rootRead(), parentRead(), childRead()],
  mutations: [
    { ordinal: 0, table: "order_change", operation: "patch", before: change, after: deletedChange },
    { ordinal: 1, table: "order_change_action", operation: "patch", before: action, after: deletedAction },
    { ordinal: 2, table: "order_change_action", operation: "patch", before: sibling, after: deletedSibling },
  ], lifecycle: [
    { table: "order_change", operation: "softDelete", key: { id: "change-delete-a" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 0, rowAtOperation: null },
    { table: "order_change_action", operation: "softDelete", key: { id: "action-delete-a" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 1, rowAtOperation: null },
    { table: "order_change_action", operation: "softDelete", key: { id: "action-delete-b" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 2, rowAtOperation: null },
  ] });
const restoration = (): Activity => ({ ...empty(),
  observedRows: [{ table: "order_change", row: restoredChange }, { table: "order_change_action", row: restoredAction },
    { table: "order_change_action", row: restoredSibling }],
  relationalReads: [rootRead(), childRead()],
  mutations: [
    { ordinal: 0, table: "order_change", operation: "patch", before: deletedChange, after: restoredChange },
    { ordinal: 1, table: "order_change_action", operation: "patch", before: deletedAction, after: restoredAction },
    { ordinal: 2, table: "order_change_action", operation: "patch", before: deletedSibling, after: restoredSibling },
  ], lifecycle: [
    { table: "order_change", operation: "restore", key: { id: "change-delete-a" }, beforeDeletedAt: deletedAt, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
    { table: "order_change_action", operation: "restore", key: { id: "action-delete-a" }, beforeDeletedAt: deletedAt, afterDeletedAt: null, attemptOrdinal: 1, rowAtOperation: null },
    { table: "order_change_action", operation: "restore", key: { id: "action-delete-b" }, beforeDeletedAt: deletedAt, afterDeletedAt: null, attemptOrdinal: 2, rowAtOperation: null },
  ] });
const accepted = (value: Packet) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (value: Packet) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("native Order Change deletion receipts", () => {
  beforeAll(async () => {
    contracts = Result.getOrThrow(compileOrderChangeDeletionContracts((await Effect.runPromise(captureOrderMetadata())).frame));
    policy = orderChangeDeletionPolicy(contracts);
  });

  it("retains duplicate, missing and empty requested positions and the exact native cascade result", async () => {
    await accepted({ call: call(), activity: deletion() });
    expect(Result.getOrThrow(decodeOrderChangeDeletionIds(rawIds))).toEqual(rawIds);
    expect(Result.getOrThrow(decodeOrderChangeDeletionArguments([rawIds]))).toEqual([rawIds]);
    expect(Result.getOrThrow(decodeOrderChangeDeletionIds([]))).toEqual([]);
    expect(Result.getOrThrow(decodeOrderChangeDeletionIds([""]))).toEqual([""]);
    for (const input of ["change-delete-a", [null], [1], ["a".repeat(257)], ["a", "b", "c", "d", "e"]])
      expect(Result.isFailure(decodeOrderChangeDeletionIds(input))).toBe(true);
    for (const args of [[], [rawIds, {}], [rawIds, undefined]])
      expect(Result.isFailure(decodeOrderChangeDeletionArguments(args))).toBe(true);
    expect(Result.getOrThrow(contracts.decodeOutput(output))).toEqual(output);
    expect(Result.getOrThrow(contracts.decodeOutput({}))).toEqual({});
    for (const malformed of [{ order_change_id: [""] }, { order_change_id: [1] },
      { order_change_id: ["a", "b", "c", "d", "e"] },
      { OrderChangeAction: Array.from({ length: 9 }, (_, index) => ({ ...deletedAction, id: `action-${index}` })) },
      { order_change_action_id: ["action-delete-a"] }])
      expect(Result.isFailure(contracts.decodeOutput(malformed))).toBe(true);
    for (const result of [{}, { order_change_id: ["change-delete-a"], order_change_action_id: ["action-delete-a", "action-delete-b"] },
      { order_change_id: ["missing"], OrderChangeAction: [deletedAction, deletedSibling] },
      { order_change_id: ["change-delete-a"], OrderChangeAction: [deletedAction] },
      { order_change_id: ["change-delete-a"], OrderChangeAction: [deletedAction, deletedAction] },
      { order_change_id: ["change-delete-a"], OrderChangeAction: [] },
      { order_change_id: ["change-delete-a"], OrderChangeAction: [deletedSibling, deletedAction] },
      { order_change_id: ["change-delete-a"], OrderChangeAction: [deletedAction, deletedSibling], order_id: ["order-delete-a"] }])
      await refused({ call: { ...call(), result }, activity: deletion() });
    await refused({ call: { ...call(), input: ["unrelated"] }, activity: deletion() });
  });

  it("preserves native full Action output rows and authenticates every retained field", async () => {
    const decoded = Result.getOrThrow(contracts.decodeOutput(output));
    expect(decoded.OrderChangeAction).toEqual([deletedAction, deletedSibling]);
    expect(decoded.OrderChangeAction?.[0]?.details).toEqual(action.details);
    expect(decoded.OrderChangeAction?.[0]?.raw_amount).toEqual(action.raw_amount);
    const incomplete = { ...deletedAction }; delete incomplete.reference;
    for (const malformed of [incomplete, { ...deletedAction, unknown: true }, { ...deletedAction, applied: "true" }])
      expect(Result.isFailure(contracts.decodeOutput({ order_change_id: ["change-delete-a"], OrderChangeAction: [malformed, deletedSibling] }))).toBe(true);
    for (const restore of [false, true]) {
      const retained = restore ? restoredAction : deletedAction, other = restore ? restoredSibling : deletedSibling;
      for (const [field, value] of Object.entries(retained)) {
        const replacement: Json = value === null ? "forged" : typeof value === "string" ? value + "-forged"
          : typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : null;
        await refused({ call: { ...call(restore), result: { order_change_id: ["change-delete-a"],
          OrderChangeAction: [{ ...retained, [field]: replacement }, other] } }, activity: restore ? restoration() : deletion() });
      }
    }
    await refused({ call: { ...call(), result: { order_change_id: ["change-delete-a"],
      OrderChangeAction: ["action-delete-a", "action-delete-b"] } }, activity: deletion() });
  });

  it("authenticates complete before, after and mixed observations against mutation preimages", async () => {
    const evidence = deletion();
    await accepted({ call: call(), activity: { ...evidence, observedRows: [
      { table: "order_change", row: change }, { table: "order", row: order },
      { table: "order_change_action", row: action }, { table: "order_change_action", row: sibling },
    ] } });
    await accepted({ call: call(), activity: { ...evidence, observedRows: [
      { table: "order_change", row: deletedChange }, { table: "order", row: order },
      { table: "order_change_action", row: action }, { table: "order_change_action", row: deletedSibling },
    ] } });
    const document = (row: JsonObject): JsonObject => ({ ...row, _id: "document-" + row.id, _creationTime: 1_760_572_800_000 });
    await accepted({ call: call(), activity: { ...evidence,
      observedRows: evidence.observedRows.map(value => ({ ...value, row: document(value.row) })),
      mutations: evidence.mutations.map(value => ({ ...value, before: value.before === null ? null : document(value.before),
        after: value.after === null ? null : document(value.after) })),
    } });
    await refused({ call: call(), activity: { ...evidence,
      observedRows: evidence.observedRows.map(value => ({ ...value, row: { ...value.row, _revision: "forged" } })),
    } });
    for (const table of ["order_change", "order_change_action"]) await refused({ call: call(), activity: { ...evidence,
      observedRows: evidence.observedRows.map(value => value.table === table
        ? { ...value, row: { ...value.row, version: 999 } } : value),
    } });
  });

  it("requires the active required Order only during forward deletion", async () => {
    const evidence = deletion();
    await refused({ call: call(), activity: { ...evidence, observedRows: evidence.observedRows.filter(value => value.table !== "order") } });
    for (const forged of [{ ...order, id: "other-order" }, { ...order, deleted_at: time }, { id: "order-delete-a", deleted_at: null }])
      await refused({ call: call(), activity: { ...evidence,
        observedRows: evidence.observedRows.map(value => value.table === "order" ? { ...value, row: forged } : value),
      } });
    await accepted({ call: call(true), activity: restoration() });
    await refused({ call: call(true), activity: { ...restoration(), observedRows: [...restoration().observedRows, { table: "order", row: order }] } });
    await refused({ call: call(true), activity: { ...restoration(), relationalReads: [rootRead(), parentRead(), childRead()] } });
    const hidden: Packet = { call: { ...call(), result: {}, events: [] }, activity: { ...empty(),
      observedRows: [{ table: "order_change", row: change }], relationalReads: [rootRead(), parentRead(0)] } };
    await accepted(hidden);
    const historicalParent: JsonObject = { ...order, deleted_at: time };
    await accepted({ ...hidden, activity: { ...hidden.activity,
      observedRows: [...hidden.activity.observedRows, { table: "order", row: historicalParent }],
    } });
    for (const parent of [{ ...historicalParent, id: "foreign-order" }, { id: "order-delete-a", deleted_at: time }])
      await refused({ ...hidden, activity: { ...hidden.activity,
        observedRows: [...hidden.activity.observedRows, { table: "order", row: parent }],
      } });
    await refused({ ...hidden, activity: { ...hidden.activity,
      observedRows: [...hidden.activity.observedRows, { table: "order", row: historicalParent }, { table: "order", row: order }],
    } });
    await refused({ ...hidden, activity: { ...hidden.activity,
      observedRows: [...hidden.activity.observedRows, { table: "order", row: historicalParent }],
      relationalReads: [rootRead(), parentRead()],
    } });
    await refused({ ...hidden, activity: { ...hidden.activity, relationalReads: [rootRead()] } });
    const hiddenChange: JsonObject = { ...change, id: "change-delete-b", order_id: "order-delete-b" };
    const hiddenOrder: JsonObject = { ...order, id: "order-delete-b", display_id: 702, deleted_at: time };
    const mixedParentRead = (count: number) => read("order", { kind: "and", children: [
      { kind: "in", column: "id", values: ["order-delete-a", "order-delete-b"] }, { kind: "isNull", column: "deleted_at" },
    ] }, count);
    const mixed: Packet = { call: { ...call(), input: ["change-delete-a", "change-delete-b"] }, activity: { ...evidence,
      observedRows: [...evidence.observedRows, { table: "order_change", row: hiddenChange }, { table: "order", row: hiddenOrder }],
      relationalReads: [rootRead(["change-delete-a", "change-delete-b"], 2), mixedParentRead(1), childRead()],
    } };
    await accepted(mixed);
    await refused({ ...mixed, activity: { ...mixed.activity,
      relationalReads: [rootRead(["change-delete-a", "change-delete-b"], 2), mixedParentRead(2), childRead()],
    } });
    await refused({ ...mixed, call: { ...mixed.call, result: { order_change_id: ["change-delete-a", "change-delete-b"],
      OrderChangeAction: [deletedAction, deletedSibling] } } });
  });

  it("skips historical Change roots forward and revives them with every historical Action on restore", async () => {
    await accepted({ call: { ...call(), result: {}, events: [] }, activity: { ...empty(),
      observedRows: [{ table: "order_change", row: deletedChange }], relationalReads: [rootRead()] } });
    const evidence = deletion();
    const historical: Activity = { ...evidence,
      mutations: evidence.mutations.map(value => value.table === "order_change_action" && value.before?.id === "action-delete-a"
        ? { ...value, before: { ...action, deleted_at: time } } : value),
      lifecycle: evidence.lifecycle.map(value => value.key.id === "action-delete-a" ? { ...value, beforeDeletedAt: time } : value),
    };
    await accepted({ call: call(), activity: historical });
    await accepted({ call: call(true), activity: restoration() });
    await refused({ call: { ...call(true), events: events() }, activity: restoration() });
  });

  it("retains active restoration no-ops with complete operation rows and deleted child restoration", async () => {
    const evidence: Activity = { ...empty(), observedRows: [{ table: "order_change_action", row: restoredSibling }],
      relationalReads: [rootRead(), childRead()],
      mutations: [{ ordinal: 0, table: "order_change_action", operation: "patch", before: deletedSibling, after: restoredSibling }],
      lifecycle: [
        { table: "order_change", operation: "restore", key: { id: "change-delete-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: change },
        { table: "order_change_action", operation: "restore", key: { id: "action-delete-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: action },
        { table: "order_change_action", operation: "restore", key: { id: "action-delete-b" }, beforeDeletedAt: deletedAt, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
      ] };
    const nativeNoop: Call = { ...call(true), result: { order_change_id: ["change-delete-a"], OrderChangeAction: [action, restoredSibling] } };
    await accepted({ call: nativeNoop, activity: evidence });
    await refused({ call: nativeNoop, activity: { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) } });
    const incomplete = { ...action }; delete incomplete.details;
    await refused({ call: nativeNoop, activity: { ...evidence, lifecycle: evidence.lifecycle.map(value => value.key.id === "action-delete-a"
      ? { ...value, rowAtOperation: incomplete } : value) } });
  });

  it("binds complete root, active Order and historical Action reads to their exact order and raw selectors", async () => {
    const evidence = deletion();
    for (const relationalReads of [[], evidence.relationalReads.slice(0, 2), [...evidence.relationalReads, childRead()],
      [parentRead(), rootRead(), childRead()], [rootRead(["change-delete-a"]), parentRead(), childRead()],
      [rootRead(rawIds, 0), parentRead(), childRead()], [rootRead(), parentRead(0), childRead()],
      [rootRead(), parentRead(), read("order_change_action", { kind: "and", children: [
        { kind: "in", column: "order_change_id", values: ["change-delete-a"] }, { kind: "isNull", column: "deleted_at" },
      ] }, 2)],
      [rootRead(), parentRead(), read("order_change_action", { kind: "in", column: "order_change_id", values: ["foreign"] }, 2)]])
      await refused({ call: call(), activity: { ...evidence, relationalReads } });
    const first = rootRead();
    if (!isJsonObject(first.query)) throw new Error("Expected the captured relation query object");
    for (const fields of [{ take: 1 }, { order: { column: "id", direction: "desc" } }, { unknown: true }])
      await refused({ call: call(), activity: { ...evidence,
        relationalReads: [{ ...first, query: { ...first.query, ...fields } }, parentRead(), childRead()],
      } });
    await refused({ call: call(), activity: { ...evidence, relationalReads: [{ ...first, total: 2 }, parentRead(), childRead()] } });
    // Omit the same child consistently from every reported output. The real
    // complete-set read still reports two rows, so partial closure is refused.
    await refused({ call: { ...call(), result: { order_change_id: ["change-delete-a"], OrderChangeAction: [deletedAction] },
      events: events().slice(0, 2) }, activity: { ...evidence,
      observedRows: evidence.observedRows.filter(value => value.row.id !== "action-delete-b"),
      mutations: evidence.mutations.slice(0, 2), lifecycle: evidence.lifecycle.slice(0, 2),
    } });
  });

  it("retains native public-ID selection order when opaque observations and raw roots arrive in reverse order", async () => {
    const parentB: JsonObject = { ...order, id: "order-delete-b", display_id: 702 };
    const changeB: JsonObject = { ...change, id: "change-delete-b", order_id: "order-delete-b" };
    const deletedChangeB: JsonObject = { ...changeB, deleted_at: deletedAt, updated_at: deletedAt };
    const requested = ["change-delete-b", "change-delete-a"];
    const evidence: Activity = { ...empty(),
      observedRows: [{ table: "order_change", row: deletedChangeB }, { table: "order_change_action", row: deletedSibling },
        { table: "order", row: parentB }, { table: "order_change", row: deletedChange },
        { table: "order", row: order }, { table: "order_change_action", row: deletedAction }],
      relationalReads: [rootRead(requested, 2), read("order", { kind: "and", children: [
        { kind: "in", column: "id", values: ["order-delete-a", "order-delete-b"] }, { kind: "isNull", column: "deleted_at" },
      ] }, 2), childRead(), read("order_change_action", { kind: "in", column: "order_change_id", values: ["change-delete-b"] }, 0)],
      mutations: [
        { ordinal: 0, table: "order_change", operation: "patch", before: change, after: deletedChange },
        { ordinal: 1, table: "order_change", operation: "patch", before: changeB, after: deletedChangeB },
        { ordinal: 2, table: "order_change_action", operation: "patch", before: action, after: deletedAction },
        { ordinal: 3, table: "order_change_action", operation: "patch", before: sibling, after: deletedSibling },
      ], lifecycle: [
        { table: "order_change", operation: "softDelete", key: { id: "change-delete-a" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 0, rowAtOperation: null },
        { table: "order_change", operation: "softDelete", key: { id: "change-delete-b" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 1, rowAtOperation: null },
        { table: "order_change_action", operation: "softDelete", key: { id: "action-delete-a" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 2, rowAtOperation: null },
        { table: "order_change_action", operation: "softDelete", key: { id: "action-delete-b" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 3, rowAtOperation: null },
      ] };
    const receipt: Call = { ...call(), input: requested, toAttempt: 4, toLifecycle: 4,
      result: { order_change_id: ["change-delete-a", "change-delete-b"], OrderChangeAction: [deletedAction, deletedSibling] },
      events: [event("order_change", "change-delete-a"), event("order_change", "change-delete-b"),
        event("order_change_action", "action-delete-a"), event("order_change_action", "action-delete-b")] };
    await accepted({ call: receipt, activity: evidence });
    const [roots, parents, firstChildren, secondChildren] = evidence.relationalReads;
    if (roots === undefined || parents === undefined || firstChildren === undefined || secondChildren === undefined)
      throw new Error("Missing fixed two-root read transcript");
    await refused({ call: receipt, activity: { ...evidence, relationalReads: [roots, parents, secondChildren, firstChildren] } });
    await refused({ call: receipt, activity: { ...evidence, relationalReads: [roots, read("order", { kind: "and", children: [
      { kind: "in", column: "id", values: ["order-delete-b", "order-delete-a"] }, { kind: "isNull", column: "deleted_at" },
    ] }, 2), firstChildren, secondChildren] } });
    const [firstRoot, secondRoot, firstAction, secondAction] = evidence.lifecycle;
    if (firstRoot === undefined || secondRoot === undefined || firstAction === undefined || secondAction === undefined)
      throw new Error("Missing fixed two-root lifecycle transcript");
    await refused({ call: receipt, activity: { ...evidence, lifecycle: [secondRoot, firstRoot, firstAction, secondAction] } });
  });

  it("orders each root's Action read even when two reverse-observed roots share one deduplicated Order", async () => {
    const changeB: JsonObject = { ...change, id: "change-delete-b" };
    const deletedChangeB: JsonObject = { ...changeB, deleted_at: deletedAt, updated_at: deletedAt };
    const requested = ["change-delete-b", "change-delete-a"];
    const evidence: Activity = { ...empty(),
      observedRows: [{ table: "order_change", row: deletedChangeB }, { table: "order_change_action", row: deletedSibling },
        { table: "order", row: order }, { table: "order_change", row: deletedChange }, { table: "order_change_action", row: deletedAction }],
      relationalReads: [rootRead(requested, 2), parentRead(), childRead(),
        read("order_change_action", { kind: "in", column: "order_change_id", values: ["change-delete-b"] }, 0)],
      mutations: [
        { ordinal: 0, table: "order_change", operation: "patch", before: change, after: deletedChange },
        { ordinal: 1, table: "order_change", operation: "patch", before: changeB, after: deletedChangeB },
        { ordinal: 2, table: "order_change_action", operation: "patch", before: action, after: deletedAction },
        { ordinal: 3, table: "order_change_action", operation: "patch", before: sibling, after: deletedSibling },
      ], lifecycle: [
        { table: "order_change", operation: "softDelete", key: { id: "change-delete-a" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 0, rowAtOperation: null },
        { table: "order_change", operation: "softDelete", key: { id: "change-delete-b" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 1, rowAtOperation: null },
        { table: "order_change_action", operation: "softDelete", key: { id: "action-delete-a" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 2, rowAtOperation: null },
        { table: "order_change_action", operation: "softDelete", key: { id: "action-delete-b" }, beforeDeletedAt: null, afterDeletedAt: deletedAt, attemptOrdinal: 3, rowAtOperation: null },
      ] };
    const receipt: Call = { ...call(), input: requested, toAttempt: 4, toLifecycle: 4,
      result: { order_change_id: ["change-delete-a", "change-delete-b"], OrderChangeAction: [deletedAction, deletedSibling] },
      events: [event("order_change", "change-delete-a"), event("order_change", "change-delete-b"),
        event("order_change_action", "action-delete-a"), event("order_change_action", "action-delete-b")] };
    await accepted({ call: receipt, activity: evidence });
    const [roots, parents, firstChildren, secondChildren] = evidence.relationalReads;
    if (roots === undefined || parents === undefined || firstChildren === undefined || secondChildren === undefined)
      throw new Error("Missing fixed shared-parent read transcript");
    await refused({ call: receipt, activity: { ...evidence, relationalReads: [roots, parents, secondChildren, firstChildren] } });
  });

  it("preserves every business scalar and Action owner field in lifecycle mutations", async () => {
    const evidence = deletion();
    const variants: readonly { readonly table: string; readonly fields: JsonObject }[] = [
      { table: "order_change", fields: { status: "declined" } }, { table: "order_change", fields: { description: "forged" } },
      { table: "order_change", fields: { metadata: null } }, { table: "order_change", fields: { order_id: "other-order" } },
      { table: "order_change", fields: { version: 99 } }, { table: "order_change", fields: { requested_at: null } },
      { table: "order_change", fields: { carry_over_promotions: false } }, { table: "order_change", fields: { created_at: restoredAt } },
      { table: "order_change_action", fields: { order_change_id: null } }, { table: "order_change_action", fields: { order_change_id: "foreign" } },
      { table: "order_change_action", fields: { order_id: "other-order" } }, { table: "order_change_action", fields: { ordering: 1 } },
      { table: "order_change_action", fields: { action: "ITEM_ADD" } }, { table: "order_change_action", fields: { details: {} } },
      { table: "order_change_action", fields: { amount: "9.0000000000000000000" } }, { table: "order_change_action", fields: { raw_amount: null } },
      { table: "order_change_action", fields: { applied: false } }, { table: "order_change_action", fields: { unknown: true } },
    ];
    for (const variant of variants) await refused({ call: call(), activity: { ...evidence,
      mutations: evidence.mutations.map(value => value.table === variant.table && value.after !== null
        ? { ...value, after: { ...value.after, ...variant.fields } } : value),
    } });
    const incomplete = { ...deletedAction }; delete incomplete.reference;
    await refused({ call: call(), activity: { ...evidence, mutations: evidence.mutations.map(value => value.ordinal === 1
      ? { ...value, after: incomplete } : value) } });
    for (const owner of [null, "foreign"]) await refused({ call: call(), activity: { ...evidence,
      observedRows: evidence.observedRows.map(value => value.table === "order_change_action"
        ? { ...value, row: { ...value.row, order_change_id: owner } } : value),
      mutations: evidence.mutations.map(value => value.table === "order_change_action" && value.before !== null && value.after !== null
        ? { ...value, before: { ...value.before, order_change_id: owner }, after: { ...value.after, order_change_id: owner } } : value),
    } });
    const inverse = restoration();
    await refused({ call: call(true), activity: { ...inverse, mutations: inverse.mutations.map(value => value.table === "order_change"
      && value.after !== null ? { ...value, after: { ...value.after, status: "declined" } } : value) } });
    await refused({ call: call(true), activity: { ...inverse, mutations: inverse.mutations.map(value => value.table === "order_change_action"
      && value.after !== null ? { ...value, after: { ...value.after, details: null } } : value) } });
  });

  it("refuses missing or duplicate transitions, malformed mutations, ordinal aliases and unrelated tables", async () => {
    const evidence = deletion();
    await refused({ call: call(), activity: { ...evidence, lifecycle: evidence.lifecycle.slice(0, 2) } });
    await refused({ call: call(), activity: { ...evidence, mutations: evidence.mutations.slice(0, 2) } });
    await refused({ call: call(), activity: { ...evidence, lifecycle: [...evidence.lifecycle, ...evidence.lifecycle] } });
    await refused({ call: call(), activity: { ...evidence, mutations: [...evidence.mutations, ...evidence.mutations] } });
    for (const attemptOrdinal of [null, 1, 99]) await refused({ call: call(), activity: { ...evidence,
      lifecycle: evidence.lifecycle.map((value, index) => index === 0 ? { ...value, attemptOrdinal } : value),
    } });
    await refused({ call: call(), activity: { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, ordinal: 7 })) } });
    await refused({ call: call(), activity: { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, before: null })) } });
    await refused({ call: call(), activity: { ...evidence, mutations: evidence.mutations.map<Activity["mutations"][number]>(value => ({ ...value, operation: "delete", after: null })) } });
    await refused({ call: call(), activity: { ...evidence, observedRows: [...evidence.observedRows, { table: "region", row: change }] } });
    await refused({ call: call(), activity: { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, table: "order" })) } });
    await refused({ call: call(), activity: { ...evidence, lifecycle: evidence.lifecycle.map<Activity["lifecycle"][number]>(value => ({ ...value, operation: "restore" })) } });
    await refused({ call: { ...call(), mode: "read" }, activity: evidence });
    await refused({ call: { ...call(), commandName: "orderPaymentFinanceChangesDelete" }, activity: evidence });
  });

  it("refuses changing any complete native business field during deletion or restoration", async () => {
    for (const restore of [false, true]) {
      const evidence = restore ? restoration() : deletion();
      for (const sample of [{ table: "order_change", row: change }, { table: "order_change_action", row: action }])
        for (const [field, value] of Object.entries(sample.row)) {
          if (field === "deleted_at" || field === "updated_at") continue;
          const replacement: Json = value === null ? "forged" : typeof value === "string" ? value + "-forged"
            : typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : null;
          await refused({ call: call(restore), activity: { ...evidence,
            mutations: evidence.mutations.map(mutation => mutation.table === sample.table && mutation.after !== null
              ? { ...mutation, after: { ...mutation.after, [field]: replacement } } : mutation),
          } });
        }
    }
  });

  it("binds native event family, action, identity and full closure order", async () => {
    const evidence = deletion();
    await accepted({ call: { ...call(), events: [event("order_change", "change-delete-a"), {
      name: "order.order-change-action.deleted", metadata: { source: "order", object: "order_change_action", action: "deleted" },
      data: { id: ["action-delete-a", "action-delete-b"] },
    }] }, activity: evidence });
    for (const selected of [[], events().slice(0, 2), [...events(), event("order_change", "change-delete-a")],
      [event("order_change", "missing"), event("order_change_action", "action-delete-a"), event("order_change_action", "action-delete-b")],
      [event("order_change_action", "action-delete-a"), event("order_change", "change-delete-a"), event("order_change_action", "action-delete-b")],
      events("restored")]) await refused({ call: { ...call(), events: selected }, activity: evidence });
    for (const malformed of [
      { name: "order.order-change.deleted", metadata: { source: "payment", object: "order_change", action: "deleted" }, data: { id: "change-delete-a" } },
      { name: "order.order.deleted", metadata: { source: "order", object: "order", action: "deleted" }, data: { id: "change-delete-a" } },
      { name: "order.order-change.updated", metadata: { source: "order", object: "order_change", action: "updated" }, data: { id: "change-delete-a" } },
      { name: "order.order-change.deleted", metadata: { source: "order", object: "order_change", action: "deleted" }, data: { id: [] } },
    ]) expect(await Effect.runPromise(Effect.result(policy.capture(malformed))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });

  it("validates complete typed native tuples and exact Change/Action correspondence before projection", () => {
    const tuple = [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [deletedAction, deletedSibling] }];
    expect(Result.getOrThrow(contracts.decodeLifecycleResult(tuple))).toEqual(tuple);
    expect(Result.getOrThrow(contracts.decodeLifecycleResult([[], {}]))).toEqual([[], {}]);
    const incomplete = { ...deletedAction }; delete incomplete.applied;
    for (const malformed of [[], [[deletedChange], {}], [[], { OrderChange: [deletedChange] }],
      [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [incomplete] }],
      [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [{ ...deletedAction, applied: "true" }] }],
      [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [deletedAction, deletedAction] }],
      [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [{ ...deletedAction, order_change_id: "foreign" }] }],
      [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [{ ...deletedAction, order_change_id: null }] }],
      [[{ ...deletedChange, description: "forged" }], { OrderChange: [deletedChange] }],
      [[deletedChange], { OrderChange: [deletedChange], Order: [order] }],
      [[deletedChange], { OrderChange: [deletedChange], OrderChangeAction: [{ ...deletedAction, unknown: null }] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(malformed))).toBe(true);
  });

  it("accepts genuine empty and absent selections without inventing parent or cascade reads", async () => {
    const absent: Call = { ...call(), input: [], result: {}, events: [] };
    await accepted({ call: absent, activity: empty() });
    await accepted({ call: { ...absent, input: ["missing", ""] }, activity: { ...empty(), relationalReads: [rootRead(["missing", ""], 0)] } });
    await refused({ call: { ...absent, input: ["missing"] }, activity: empty() });
    await refused({ call: absent, activity: { ...empty(), relationalReads: [rootRead([], 0)] } });
    await refused({ call: absent, activity: { ...empty(), observedRows: [{ table: "order_change", row: change }] } });
  });
});
