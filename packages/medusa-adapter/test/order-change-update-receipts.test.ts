import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { prepareOrderChangeUpdateRepository } from "../src/modules/order/change-update-repository";
import { orderChangeUpdatePolicy } from "../src/modules/order/change-update-receipt";
import { decodeOrderChangeUpdateInput } from "../src/modules/order/change-update-input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Packet = { readonly call: Call; readonly activity: Activity };
let prepared: Result.Result.Success<ReturnType<typeof prepareOrderChangeUpdateRepository>>;
let policy: ReturnType<typeof orderChangeUpdatePolicy>;
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string): Json => ({ name: "order.order-change.updated", data: { id },
  metadata: { source: "order", object: "order_change", action: "updated" } });
const row = (): JsonObject & { readonly id: string } => ({ id: "ordch-unit", order_id: "order-unit", version: 2,
  return_id: null, claim_id: null, exchange_id: null, change_type: "edit", description: "before", status: "pending",
  internal_note: "keep", created_by: null, requested_by: null, requested_at: null, confirmed_by: null, confirmed_at: null,
  declined_by: null, declined_reason: null, declined_at: null, canceled_by: null, canceled_at: null,
  carry_over_promotions: null, metadata: { unchanged: [true, 1] }, created_at: "2020-01-01T00:00:00.000Z",
  updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null });
const order = (): JsonObject => ({ id: "order-unit", display_id: 31, custom_display_id: null, region_id: null, customer_id: null,
  version: 1, sales_channel_id: null, status: "pending", is_draft_order: false, email: null, currency_code: "usd", locale: null,
  no_notification: null, metadata: null, canceled_at: null, shipping_address_id: null, billing_address_id: null,
  created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null });
const dto = (value: JsonObject): JsonObject => ({ ...value, order: { id: value.order_id ?? null } });
function read(where: JsonObject, count = 1): Activity["relationalReads"][number] {
  const plan = Result.getOrThrow(prepared.query({ where, options: { populate: [], orderBy: { id: "ASC" } } }));
  return { table: "order_change", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: count, returned: count };
}
function packet(update: JsonObject = { description: "after" }): Packet {
  const before = row(), after = { ...before, ...update, updated_at: "2026-10-23T01:00:00.000Z" };
  return { call: { commandName: "orderChangeUpdate", mode: "write", input: [{ id: before.id, ...update }], result: [dto(after)],
    events: [event(before.id)], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 },
    activity: { ...empty(), observedRows: [{ table: "order_change", row: before }, { table: "order", row: order() }],
      relationalReads: [read({ $or: [{ id: before.id }] }), { table: "order",
        query: commerceRelationReadQuery(defaultCommerceResources, Result.getOrThrow(prepared.orderPredicate([before]))), total: 1, returned: 1 }],
      mutations: [{ ordinal: 0, table: "order_change", operation: "patch", before, after }] } };
}
const accepted = (value: Packet) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (value: Packet) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const scalarUpdates: readonly JsonObject[] = [{ status: "confirmed" }, { status: null }, { description: null }, { internal_note: "new" },
  { requested_by: "user" }, { confirmed_by: "user" }, { declined_by: "user" }, { declined_reason: "reason" },
  { canceled_by: null }, { carry_over_promotions: true }];

describe("Order Change scalar update receipts", () => {
  beforeAll(async () => {
    prepared = Result.getOrThrow(prepareOrderChangeUpdateRepository((await Effect.runPromise(captureOrderMetadata())).frame));
    policy = orderChangeUpdatePolicy(prepared);
  });
  it.each(scalarUpdates)("authenticates native scalar patch %j", async update => {
    await accepted(packet(update));
  });
  it("accepts exact same-value assignments with their mutation and event", async () => {
    const value = packet({ description: "before" }); await accepted(value);
    await refused({ ...value, activity: { ...value.activity, mutations: [] } });
    await refused({ ...value, call: { ...value.call, events: [] } });
  });
  it("authenticates duplicate final whole-patch assignment without merging earlier keys", async () => {
    const value = packet(), id = row().id;
    await accepted({ ...value, call: { ...value.call,
      input: [{ id, description: "first", internal_note: "discarded" }, { id, description: "after" }] } });
    const mutation = value.activity.mutations[0];
    if (mutation?.after === null || mutation?.after === undefined) throw new Error("Missing patch");
    await refused({ ...value, activity: { ...value.activity,
      mutations: [{ ...mutation, after: { ...mutation.after, internal_note: "discarded" } }] } });
  });
  it("keeps ID-only requests and last-duplicate ID-only requests as exact no-ops", async () => {
    const before = row(), template = packet();
    const inputs: readonly Json[] = [[{ id: before.id }], [{ id: before.id, description: "discarded" }, { id: before.id }]];
    for (const input of inputs) {
      const value: Packet = { call: { ...template.call, input, result: [dto(before)], events: [] },
        activity: { ...empty(), observedRows: [{ table: "order_change", row: before }, { table: "order", row: order() }],
          relationalReads: template.activity.relationalReads } };
      await accepted(value);
      await refused({ ...value, call: { ...value.call, events: [event(before.id)] } });
    }
  });
  it("accepts only a fully empty direct module update", async () => {
    const template = packet();
    await accepted({ call: { ...template.call, input: [], result: [], events: [] }, activity: empty() });
    await refused({ call: { ...template.call, input: [], result: [], events: [] }, activity: template.activity });
  });
  it("correlates selected preimages with complete observed rows", async () => {
    const before = row(), template = packet();
    const value: Packet = { call: { ...template.call, commandName: "orderChangeListForUpdate", mode: "read",
      input: { filters: { id: [before.id] }, config: { select: ["id", "description", "carry_over_promotions"], relations: [] } },
      result: [{ id: before.id, description: before.description ?? null, carry_over_promotions: null }], events: [] },
      activity: { ...empty(), observedRows: [{ table: "order_change", row: before }], relationalReads: [read({ id: [before.id] })] } };
    await accepted(value);
    await refused({ ...value, call: { ...value.call, result: [{ id: before.id, description: "forged", carry_over_promotions: null }] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [] } });
  });
  it.each(["metadata", "requested_at", "confirmed_at", "declined_at", "canceled_at", "order_id", "actions", "created_by", "change_type"])(
    "refuses unadmitted %s assignments before execution", field => {
      expect(Result.isFailure(decodeOrderChangeUpdateInput([{ id: row().id, [field]: null }]))).toBe(true);
    });
  it.each(["metadata", "created_at", "requested_at", "version", "order_id", "change_type", "internal_note"])(
    "refuses unrequested %s changes", async field => {
      const value = packet(), mutation = value.activity.mutations[0];
      if (mutation?.after === null || mutation?.after === undefined) throw new Error("Missing patch");
      await refused({ ...value, activity: { ...value.activity,
        mutations: [{ ...mutation, after: { ...mutation.after, [field]: field === "metadata" ? {} : field === "version" ? 4 : "forged" } }] } });
    });
  it("requires complete unchanged DTO columns and consistent required Order references", () => {
    const complete = dto(row());
    expect(Result.getOrThrow(prepared.contracts.present(row()))).toEqual(complete);
    expect(Result.isSuccess(prepared.contracts.decodeRows([complete]))).toBe(true);
    for (const bad of [{}, row(), { ...complete, order: { id: "foreign" } }, { ...complete, metadata: undefined },
      { ...complete, version: "2" }, { ...complete, canceled_at: 1 }, { ...complete, unknown: null }])
      expect(Result.isFailure(prepared.contracts.decodeRows([bad]))).toBe(true);
    expect(Result.isFailure(prepared.contracts.decodeRows([complete, complete]))).toBe(true);
  });
  it("authenticates active Order eligibility only for the default full native update read", async () => {
    const value = packet();
    await refused({ ...value, activity: { ...value.activity, observedRows: [{ table: "order_change", row: row() }] } });
    for (const parent of [{ ...order(), id: "foreign" }, { ...order(), deleted_at: "2026-10-23T01:00:00.000Z" }])
      await refused({ ...value, activity: { ...value.activity,
        observedRows: [{ table: "order_change", row: row() }, { table: "order", row: parent }] } });
    await refused({ ...value, activity: { ...value.activity, relationalReads: value.activity.relationalReads.slice(0, 1) } });
    expect(Result.getOrThrow(prepared.filterActiveOrderChanges([row()], [{ ...order(), deleted_at: "2026-10-23T01:00:00.000Z" }]))).toEqual([]);
    expect(Result.getOrThrow(prepared.filterActiveOrderChanges([row()], [order()]))).toEqual([row()]);
  });
  it("refuses missing, duplicate, foreign and wrong-name native events", async () => {
    const value = packet();
    for (const events of [[], [event("foreign")], [...value.call.events, ...value.call.events],
      [{ name: "order.order.updated", data: { id: row().id }, metadata: { source: "order", object: "order", action: "updated" } }]])
      await refused({ ...value, call: { ...value.call, events } });
  });
  it("refuses absent reads, foreign observations and extra mutations", async () => {
    const value = packet(), observation = value.activity.observedRows[0], mutation = value.activity.mutations[0];
    if (observation === undefined || mutation === undefined) throw new Error("Missing actual evidence");
    await refused({ ...value, activity: { ...value.activity, relationalReads: [] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [{ ...observation, table: "order" }] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [mutation, { ...mutation, ordinal: 1 }] } });
    await refused({ ...value, call: { ...value.call, commandName: "orderComplete" } });
    await refused({ ...value, call: { ...value.call, input: [{ id: "foreign", description: "after" }] } });
  });
});
