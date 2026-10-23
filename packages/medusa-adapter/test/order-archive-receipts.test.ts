import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { prepareOrderArchiveRepository } from "../src/modules/order/repository";
import { orderArchivePolicy } from "../src/modules/order/receipt";
import { orderArchiveRows } from "./support/logical-order-archive-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Packet = { readonly call: Call; readonly activity: Activity };
let prepared: Result.Result.Success<ReturnType<typeof prepareOrderArchiveRepository>>;
let policy: ReturnType<typeof orderArchivePolicy>;
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
function packet(inverse = false): Packet {
  const original = orderArchiveRows()[0]?.row;
  if (original === undefined || typeof original.id !== "string") throw new Error("Missing explicit existing Order fixture");
  const before = inverse ? { ...original, status: "archived" } : original;
  const status = inverse ? "completed" : "archived", after = { ...before, status, updated_at: "2026-10-23T01:00:00.000Z" };
  return { call: { commandName: inverse ? "orderRestoreStatuses" : "orderArchive", mode: "write",
    input: inverse ? [{ id: original.id, status }] : [original.id], result: [nativeDto(inverse ? after : { ...before, status })],
    events: [event(original.id)], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 },
    activity: { ...empty(), observedRows: [{ table: "order", row: before }],
      relationalReads: [...(inverse ? [] : [read({ id: [original.id] }, 1)]), read({ $or: [{ id: original.id }] }, 1)],
      mutations: [{ ordinal: 0, table: "order", operation: "patch", before, after }] } };
}
const accepted = (value: Packet) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (value: Packet) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("Order archive authenticated call receipts", () => {
  beforeAll(async () => { prepared = Result.getOrThrow(prepareOrderArchiveRepository((await Effect.runPromise(captureOrderMetadata())).frame));
    policy = orderArchivePolicy(prepared); });
  it("accepts native immediate archive DTOs and fresh inverse DTOs separately", async () => {
    await accepted(packet()); await accepted(packet(true));
  });
  it("requires the native same-status inverse mutation and module event", async () => {
    const value = packet(true), mutation = value.activity.mutations[0];
    if (mutation?.before === null || mutation?.before === undefined || mutation.after === null)
      throw new Error("Missing inverse mutation");
    const before = { ...mutation.before, status: "completed" };
    const repeated: Packet = { ...value, activity: { ...value.activity,
      observedRows: [{ table: "order", row: before }], mutations: [{ ...mutation, before }] } };
    await accepted(repeated);
    await refused({ ...repeated, call: { ...repeated.call, events: [] } });
    await refused({ ...repeated, activity: { ...repeated.activity, mutations: [] } });
  });
  it("keeps raw duplicate request IDs while authenticating native deduplicated reads", async () => {
    const value = packet(), id = Array.isArray(value.call.input) ? value.call.input[0] : undefined;
    if (typeof id !== "string") throw new Error("Missing existing Order ID");
    await accepted({ ...value, call: { ...value.call, input: [id, id, id, id] } });
  });
  it("checks the full native owning-reference DTO shape", async () => {
    const original = orderArchiveRows()[0]?.row;
    if (original === undefined) throw new Error("Missing existing Order");
    const withReferences = { ...original, shipping_address_id: "address-live", billing_address_id: "address-historical" };
    expect(Result.getOrThrow(prepared.contracts.present(withReferences))).toEqual(nativeDto(withReferences));
    expect(Result.isSuccess(prepared.contracts.decodeRows([nativeDto(withReferences)]))).toBe(true);
    expect(Result.isSuccess(prepared.contracts.decodeRows([nativeDto(original)]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRows([{ ...nativeDto(original), shipping_address_id: null }]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRows([{ ...nativeDto(withReferences), shipping_address: { id: "foreign" } }]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRows([original]))).toBe(true);
  });
  it("binds status preimages to their complete actual root selection", async () => {
    const root = orderArchiveRows()[0]?.row;
    if (root === undefined || typeof root.id !== "string") throw new Error("Missing explicit Order");
    const value: Packet = { call: { ...packet().call, commandName: "orderStatusPreimages", mode: "read",
      input: { filters: { id: [root.id] }, config: { select: ["id", "status"] } },
      result: [{ id: root.id, status: root.status ?? null }], events: [] },
      activity: { ...empty(), observedRows: [{ table: "order", row: root }], relationalReads: [read({ id: [root.id] }, 1)] } };
    await accepted(value);
    await refused({ ...value, call: { ...value.call, result: [{ id: root.id, status: "canceled" }] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [] } });
  });
  it.each(["display_id", "customer_id", "currency_code", "metadata", "created_at", "deleted_at"])("refuses an unrelated %s mutation", async field => {
    const value = packet(), mutation = value.activity.mutations[0];
    if (mutation?.after === null || mutation?.after === undefined) throw new Error("Missing mutation");
    const replacement: Json = field === "display_id" ? 999 : field === "metadata" ? { forged: true } : "forged";
    await refused({ ...value, activity: { ...value.activity,
      mutations: [{ ...mutation, after: { ...mutation.after, [field]: replacement } }] } });
  });
  it("refuses swapped immediate/cold DTO timestamps", async () => {
    const archive = packet(), mutation = archive.activity.mutations[0];
    if (mutation?.after === null || mutation?.after === undefined) throw new Error("Missing mutation");
    await refused({ ...archive, call: { ...archive.call, result: [nativeDto(mutation.after)] } });
    const inverse = packet(true), before = inverse.activity.mutations[0]?.before;
    if (before === null || before === undefined) throw new Error("Missing preimage");
    await refused({ ...inverse, call: { ...inverse.call, result: [nativeDto({ ...before, status: "completed" })] } });
  });
  it("refuses missing, duplicate, foreign and reordered event identities", async () => {
    const value = packet();
    for (const events of [[], [event("foreign")], [...value.call.events, ...value.call.events]])
      await refused({ ...value, call: { ...value.call, events } });
    await refused({ ...value, call: { ...value.call, events: [{ name: "order.archived", data: { id: "foreign" } }] } });
  });
  it("refuses omitted or forged reads and contradictory observed bodies", async () => {
    const value = packet(), observation = value.activity.observedRows[0], actualRead = value.activity.relationalReads[0];
    if (observation === undefined || actualRead === undefined) throw new Error("Missing actual read evidence");
    await refused({ ...value, activity: { ...value.activity, relationalReads: [] } });
    await refused({ ...value, activity: { ...value.activity,
      relationalReads: [{ ...actualRead, total: 2 }, ...value.activity.relationalReads.slice(1)] } });
    await refused({ ...value, activity: { ...value.activity,
      observedRows: [observation, { ...observation, row: { ...observation.row, metadata: { forged: true } } }] } });
    await refused({ ...value, activity: { ...value.activity,
      observedRows: [{ ...observation, table: "order_credit_line" }] } });
  });
  it("refuses extra status transitions and unrequested roots", async () => {
    const value = packet(), mutation = value.activity.mutations[0];
    if (mutation === undefined) throw new Error("Missing mutation");
    await refused({ ...value, activity: { ...value.activity, mutations: [mutation, { ...mutation, ordinal: 1 }] } });
    await refused({ ...value, call: { ...value.call, input: ["foreign"] } });
    await refused({ ...value, call: { ...value.call, commandName: "orderCreate" } });
  });
});
