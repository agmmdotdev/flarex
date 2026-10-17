import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { scalarLifecycleReceipt } from "../src/repository/scalar-lifecycle-receipt";
import { decodeShippingOptionTypeDeletionIds } from "../src/modules/fulfillment/shipping-option-type-delete-input";
import { captureCommerceInput } from "../src/value/input";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionTypeDeletionRepository } from "../src/modules/fulfillment/shipping-option-type-delete-repository";
import { shippingOptionTypeDeletionPolicy } from "../src/modules/fulfillment/shipping-option-type-delete-receipt";
import { shippingOptionTypeDeletionGraph } from "./support/logical-shipping-option-type-deletion-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let prepared: Result.Result.Success<ReturnType<typeof prepareShippingOptionTypeDeletionRepository>>;
let validate: LogicalCallReceiptValidation;
const graph = shippingOptionTypeDeletionGraph("receipt", 1, { optionsPerType: 2 });
const options = graph.rows.filter(value => value.table === "shipping_option").map(value => value.row);
const input = (ids: readonly string[]) => ({ filters: { shipping_option_type_id: [...ids] }, config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 1 } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const call = (ids: readonly string[], rows = options, count = rows.length): Call => ({ commandName: "shippingOptionCountForTypeDeletion", mode: "read", input: input(ids),
  result: [rows.slice(0, 1).map(row => ({ id: row.id! })), count], events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const evidence = (ids: readonly string[], rows = options, count = rows.length): Activity => {
  const query = Result.getOrThrow(prepared.optionQuery(Result.getOrThrow(captureCommerceInput(buildQuery(input(ids).filters, {
    ...input(ids).config, select: prepared.contracts.option.columns.map(column => column.name), order: { id: "ASC" as const },
  }))))).query;
  return { ...empty(), observedRows: rows.map(row => ({ table: "shipping_option", row })), relationalReads: [
    { table: "shipping_option", query, total: count, returned: Math.min(1, rows.length) },
    { table: "shipping_option", query, total: count, returned: Math.min(1, rows.length) },
  ] };
};
const refuse = async (receipt: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(validate(receipt, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { const metadata = await Effect.runPromise(captureShippingProfileDeletionMetadata()); prepared = Result.getOrThrow(prepareShippingOptionTypeDeletionRepository(metadata.frame)); validate = shippingOptionTypeDeletionPolicy(prepared).validateLogicalCall; });
describe("native Type deletion exact paginated Option read evidence", () => {
  it("accepts one projected row and real total two with full native count observations", async () => {
    await Effect.runPromise(validate(call(graph.ids), evidence(graph.ids)));
    const activity = evidence(graph.ids); await Effect.runPromise(validate(call(graph.ids), { ...activity, observedRows: [...activity.observedRows].reverse() }));
  });
  it("retains database byte ordering across punctuation and case in the existence page", async () => {
    const first = options[0], second = options[1]; if (first === undefined || second === undefined) throw new Error("Missing count rows");
    const rows = [{ ...first, id: "B-option" }, { ...second, id: "a-option" }];
    await Effect.runPromise(validate(call(graph.ids, rows), evidence(graph.ids, [...rows].reverse())));
    await refuse({ ...call(graph.ids, rows), result: [[{ id: "a-option" }], 2] }, evidence(graph.ids, rows));
  });
  it("requires authentic exact zero-match read evidence including raw empty selectors", async () => {
    for (const ids of [[], ["missing", "missing"]]) {
      const receipt = call(ids, []), activity = evidence(ids, []); await Effect.runPromise(validate(receipt, activity));
      await refuse(receipt, empty()); await refuse(receipt, { ...activity, relationalReads: activity.relationalReads.slice(0, 1) });
      await refuse(receipt, evidence(["other"], []));
      await refuse(receipt, { ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, table: "shipping_option_type" })) });
    }
  });
  it("validates historical physical candidates while native active rows alone determine count and page", async () => {
    const first = options[0], second = options[1]; if (first === undefined || second === undefined) throw new Error("Missing Option candidates");
    const historical: JsonObject = { ...first, deleted_at: "2026-10-17T00:00:00.000Z" };
    const historicalOnly = { ...evidence(graph.ids, []), observedRows: [{ table: "shipping_option", row: historical }] };
    await Effect.runPromise(validate(call(graph.ids, []), historicalOnly));
    const mixed = { ...evidence(graph.ids, [second]), observedRows: [{ table: "shipping_option", row: historical }, { table: "shipping_option", row: second }] };
    await Effect.runPromise(validate(call(graph.ids, [second]), mixed));
    await refuse({ ...call(graph.ids, [second]), result: [[{ id: second.id! }], 2] }, mixed);
    const { provider_id: _provider, ...incompleteHistorical } = historical;
    await refuse(call(graph.ids, []), { ...historicalOnly, observedRows: [{ table: "shipping_option", row: incompleteHistorical }] });
  });
  it("refuses truncated counts, fabricated membership, widened pages and mismatched table/intent", async () => {
    const receipt = call(graph.ids), activity = evidence(graph.ids);
    await refuse({ ...receipt, result: [options.slice(0, 1).map(row => ({ id: row.id! })), 1] }, activity);
    await refuse({ ...receipt, result: [[], 2] }, activity);
    await refuse({ ...receipt, result: [options.map(row => ({ id: row.id! })), 2] }, activity);
    await refuse({ ...receipt, result: [[{ id: "invented" }], 2] }, activity);
    await refuse({ ...receipt, result: [[{ id: options[0]!.id!, name: "extra" }], 2] }, activity);
    await refuse(receipt, { ...activity, observedRows: activity.observedRows.slice(0, 1) });
    await refuse(receipt, { ...activity, observedRows: activity.observedRows.map(value => ({ ...value, row: { ...value.row, shipping_option_type_id: "outside" } })) });
    await refuse(receipt, { ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, total: 1 })) });
    await refuse(receipt, { ...activity, relationalReads: activity.relationalReads.map((read, index) => {
      if (!isJsonObject(read.query)) throw new Error("Missing prepared Option query object");
      return index === 0 ? read : { ...read, query: { ...read.query, take: 2 } };
    }) });
    await refuse({ ...receipt, mode: "write" }, activity); await refuse({ ...receipt, events: [{ name: "foreign" }] }, activity);
  });
  it("validates complete count-observed Option bodies before the id projection", async () => {
    for (const modify of [(row: Record<string, unknown>) => { delete row.provider_id; }, (row: Record<string, unknown>) => { row.created_at = null; },
      (row: Record<string, unknown>) => { row.shipping_option_type_id = "outside-selected-types"; }]) {
      const activity = evidence(graph.ids), row = activity.observedRows[1]; if (row === undefined) throw new Error("Missing count-only observation");
      const malformed = { ...row.row }; modify(malformed);
      await refuse(call(graph.ids), { ...activity, observedRows: [activity.observedRows[0]!, { ...row, row: malformed }] });
    }
  });
});

describe("native Type lifecycle exact historical selection evidence", () => {
  const lifecycleCall = (ids: readonly string[], restore: boolean): Call => ({ ...call([], []),
    commandName: restore ? "shippingOptionTypeRestoreForWorkflow" : "shippingOptionTypeSoftDeleteForWorkflow", mode: "write", input: [...ids], result: {} });
  const read = (ids: readonly string[], total: number): Activity["relationalReads"] => [{ table: "shipping_option_type",
    query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids }), total, returned: total }];
  it.each([false, true])("requires exact nonempty missing-ID reads without inventing lifecycle rows, restore=%s", async restore => {
    const ids = ["missing", "missing"], receipt = lifecycleCall(ids, restore), activity = { ...empty(), relationalReads: read(ids, 0) };
    await Effect.runPromise(validate(receipt, activity)); await refuse(receipt, empty());
    await refuse(receipt, { ...activity, relationalReads: read(["redirected"], 0) });
    await refuse(receipt, { ...activity, relationalReads: [...activity.relationalReads, ...activity.relationalReads] });
    await refuse(receipt, { ...activity, relationalReads: read(ids, 1) });
    await Effect.runPromise(validate(lifecycleCall([], restore), empty()));
    await refuse(lifecycleCall([], restore), { ...empty(), relationalReads: read([], 0) });
  });
  it("retains predeleted soft-delete no-op history and refuses substituted native maps/events", async () => {
    const graph = shippingOptionTypeDeletionGraph("old-receipt", 1, { deletedTypes: true }), type = graph.rows[0]?.row;
    if (type === undefined) throw new Error("Missing physical historical Type");
    const receipt = lifecycleCall(graph.ids, false), activity = { ...empty(), relationalReads: read(graph.ids, 1), observedRows: [{ table: "shipping_option_type", row: type }] };
    await Effect.runPromise(validate(receipt, activity));
    await refuse({ ...receipt, result: { shipping_option_type_id: graph.ids } }, activity);
    await refuse({ ...receipt, events: [{ name: "fulfillment.shipping-option-type.deleted", metadata: { source: "fulfillment", object: "shipping_option_type", action: "deleted" }, data: { id: graph.ids } }] }, activity);
    await refuse(receipt, { ...activity, observedRows: [{ table: "shipping_profile", row: type }] });
  });
  it("requires the opted-in native active restore patch while ordinary scalar profiles keep active no-op semantics", async () => {
    const initial = graph.rows.find(value => value.table === "shipping_option_type")?.row;
    if (initial === undefined) throw new Error("Missing complete active Type");
    const id = initial.id; if (typeof id !== "string") throw new Error("Missing Type id");
    const after = { ...initial, updated_at: "2026-10-18T00:00:00.000Z" };
    const receipt: Call = { ...lifecycleCall([id], true), result: { shipping_option_type_id: [id] },
      events: [{ name: "fulfillment.shipping-option-type.restored", metadata: { source: "fulfillment", object: "shipping_option_type", action: "restored" }, data: { id } }] };
    const noop: Activity = { ...empty(), relationalReads: read([id], 1), observedRows: [{ table: "shipping_option_type", row: initial }],
      lifecycle: [{ table: "shipping_option_type", operation: "restore", key: { id }, beforeDeletedAt: null, afterDeletedAt: null,
        attemptOrdinal: null, rowAtOperation: initial }] };
    const patched: Activity = { ...noop, observedRows: [{ table: "shipping_option_type", row: after }],
      mutations: [{ ordinal: 0, table: "shipping_option_type", operation: "patch", before: initial, after }],
      lifecycle: [{ ...noop.lifecycle[0]!, attemptOrdinal: 0, rowAtOperation: null }] };
    await Effect.runPromise(validate(receipt, patched)); await refuse(receipt, noop);
    await refuse(receipt, { ...patched, mutations: [{ ...patched.mutations[0]!, before: { ...initial, id: "forged-preimage" } }] });
    await refuse(receipt, { ...patched, lifecycle: [{ ...patched.lifecycle[0]!, attemptOrdinal: 1 }] });
    await refuse(receipt, { ...patched, mutations: [...patched.mutations, { ...patched.mutations[0]!, ordinal: 1 }] });
    const ordinary = scalarLifecycleReceipt({ table: "shipping_option_type", softDeleteCommand: "shippingOptionTypeSoftDeleteForWorkflow",
      restoreCommand: "shippingOptionTypeRestoreForWorkflow", maximumRoots: 4, decodeIds: decodeShippingOptionTypeDeletionIds,
      decodeRow: prepared.contracts.decodeRow, decodeResult: value => prepared.contracts.decodeOutput(value).pipe(Result.map(result => ({
        empty: Object.keys(result).length === 0, ids: result.shipping_option_type_id ?? [],
      }))) });
    await Effect.runPromise(ordinary(receipt, noop));
    expect(await Effect.runPromise(Effect.result(ordinary(receipt, patched)))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
