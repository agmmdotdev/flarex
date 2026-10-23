import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { prepareOrderCompletionRepository } from "../src/modules/order/repository";
import { orderCompletionPolicy } from "../src/modules/order/receipt";
import { decodeOrderArchiveStatuses, decodeOrderCompletionStatuses } from "../src/modules/order/input";
import { orderArchiveRows } from "./support/logical-order-archive-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Packet = { readonly call: Call; readonly activity: Activity };
let prepared: Result.Result.Success<ReturnType<typeof prepareOrderCompletionRepository>>;
let policy: ReturnType<typeof orderCompletionPolicy>;
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string): Json => ({ name: "order.order.updated", data: { id },
  metadata: { source: "order", object: "order", action: "updated" } });
const nativeDto = (row: JsonObject): JsonObject => {
  const { shipping_address_id, billing_address_id, ...scalars } = row;
  return { ...scalars, shipping_address: shipping_address_id == null ? null : { id: shipping_address_id },
    billing_address: billing_address_id == null ? null : { id: billing_address_id },
    ...(shipping_address_id == null ? {} : { shipping_address_id }), ...(billing_address_id == null ? {} : { billing_address_id }) };
};
function read(where: JsonObject, count: number): Activity["relationalReads"][number] {
  const plan = Result.getOrThrow(prepared.query({ where, options: { populate: [], orderBy: { id: "ASC" } } }));
  return { table: "order", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: count, returned: count };
}
function packet(status = "pending", inverse = false): Packet {
  const original = orderArchiveRows()[0]?.row;
  if (original === undefined || typeof original.id !== "string") throw new Error("Missing explicit existing Order");
  const before = { ...original, status: inverse ? "completed" : status }, next = inverse ? status : "completed";
  const after = { ...before, status: next, updated_at: "2026-10-23T01:00:00.000Z" };
  return { call: { commandName: inverse ? "orderRestoreStatuses" : "orderComplete", mode: "write",
    input: inverse ? [{ id: original.id, status }] : [original.id], result: [nativeDto(inverse ? after : { ...before, status: next })],
    events: [event(original.id)], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 },
    activity: { ...empty(), observedRows: [{ table: "order", row: before }],
      relationalReads: [...(inverse ? [] : [read({ id: [original.id] }, 1)]), read({ $or: [{ id: original.id }] }, 1)],
      mutations: [{ ordinal: 0, table: "order", operation: "patch", before, after }] } };
}
const accepted = (value: Packet) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (value: Packet) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("Order completion authenticated call receipts", () => {
  beforeAll(async () => { prepared = Result.getOrThrow(prepareOrderCompletionRepository((await Effect.runPromise(captureOrderMetadata())).frame));
    policy = orderCompletionPolicy(prepared); });
  it.each(["pending", "completed", "draft", "archived", "requires_action"])("authenticates native completion and genuine %s inverse", async status => {
    await accepted(packet(status)); await accepted(packet(status, true));
  });
  it("keeps completion and archive inverse authority distinct", async () => {
    expect(Result.isFailure(decodeOrderCompletionStatuses([{ id: "order", status: "canceled" }]))).toBe(true);
    for (const status of ["pending", "archived", "requires_action"])
      expect(Result.isFailure(decodeOrderArchiveStatuses([{ id: "order", status }]))).toBe(true);
    await refused(packet("canceled")); await refused(packet("canceled", true));
    const value = packet(); await refused({ ...value, call: { ...value.call, commandName: "orderArchive" } });
  });
  it("requires same-status mutations and events", async () => {
    const value = packet("completed"); await accepted(value);
    await refused({ ...value, call: { ...value.call, events: [] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [] } });
  });
  it("preserves raw duplicate IDs while checking deduplicated native selections", async () => {
    const value = packet(), id = Array.isArray(value.call.input) ? value.call.input[0] : undefined;
    if (typeof id !== "string") throw new Error("Missing requested ID");
    await accepted({ ...value, call: { ...value.call, input: [id, id, id, id] } });
  });
  it("accepts exactly the native empty transition and inverse selections", async () => {
    const value = packet();
    await accepted({ call: { ...value.call, input: [], result: [], events: [] },
      activity: { ...empty(), relationalReads: [read({ id: [] }, 0)] } });
    await accepted({ call: { ...value.call, commandName: "orderRestoreStatuses", input: [], result: [], events: [] }, activity: empty() });
  });
  it.each(["display_id", "customer_id", "currency_code", "metadata", "created_at", "deleted_at"])("refuses unrelated %s changes", async field => {
    const value = packet(), mutation = value.activity.mutations[0];
    if (mutation?.after === null || mutation?.after === undefined) throw new Error("Missing mutation");
    const replacement: Json = field === "display_id" ? 999 : field === "metadata" ? { forged: true } : "forged";
    await refused({ ...value, activity: { ...value.activity, mutations: [{ ...mutation, after: { ...mutation.after, [field]: replacement } }] } });
  });
  it("validates complete DTO columns, serials and owning references", async () => {
    const root = orderArchiveRows()[0]?.row;
    if (root === undefined) throw new Error("Missing existing Order");
    const row = { ...root, shipping_address_id: "address-live", billing_address_id: "address-historical" }, dto = nativeDto(row);
    expect(Result.getOrThrow(prepared.contracts.present(row))).toEqual(dto);
    expect(Result.isSuccess(prepared.contracts.decodeRows([dto]))).toBe(true);
    for (const bad of [{}, { ...dto, display_id: 1.5 }, { ...dto, display_id: 2147483648 },
      { ...dto, shipping_address: { id: "foreign" } }, { ...dto, billing_address_id: null }])
      expect(Result.isFailure(prepared.contracts.decodeRows([bad]))).toBe(true);
  });
  it("distinguishes pre-write native completion timestamps from fresh inverse results", async () => {
    const complete = packet(), after = complete.activity.mutations[0]?.after;
    if (after === null || after === undefined) throw new Error("Missing mutation");
    await refused({ ...complete, call: { ...complete.call, result: [nativeDto(after)] } });
    const inverse = packet("pending", true), before = inverse.activity.mutations[0]?.before;
    if (before === null || before === undefined) throw new Error("Missing preimage");
    await refused({ ...inverse, call: { ...inverse.call, result: [nativeDto({ ...before, status: "pending" })] } });
  });
  it("refuses omitted, duplicate and foreign event identities", async () => {
    const value = packet();
    for (const events of [[], [event("foreign")], [...value.call.events, ...value.call.events],
      [{ name: "order.completed", data: { id: "order" } }]]) await refused({ ...value, call: { ...value.call, events } });
  });
  it("refuses absent or forged actual reads and extra status transitions", async () => {
    const value = packet(), observation = value.activity.observedRows[0], mutation = value.activity.mutations[0];
    if (observation === undefined || mutation === undefined) throw new Error("Missing actual evidence");
    await refused({ ...value, activity: { ...value.activity, relationalReads: [] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [{ ...observation, table: "order_credit_line" }] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [mutation, { ...mutation, ordinal: 1 }] } });
    await refused({ ...value, call: { ...value.call, input: ["foreign"] } });
  });
});
