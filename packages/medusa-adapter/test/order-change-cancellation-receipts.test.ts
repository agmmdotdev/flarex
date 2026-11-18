import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { prepareOrderChangeCancellationRepository } from "../src/modules/order/change-cancellation-repository";
import { orderChangeCancellationPolicy } from "../src/modules/order/change-cancellation-receipt";
import { decodeOrderChangeCancellationInput, decodeOrderChangeCancellationPreimage } from "../src/modules/order/change-cancellation-input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Packet = { readonly call: Call; readonly activity: Activity };
let prepared: Result.Result.Success<ReturnType<typeof prepareOrderChangeCancellationRepository>>;
let policy: ReturnType<typeof orderChangeCancellationPolicy>;
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string): Json => ({ name: "order.order-change.updated", data: { id },
  metadata: { source: "order", object: "order_change", action: "updated" } });
const before = (): JsonObject & { readonly id: string } => ({ id: "ordch-unit", order_id: "order-unit", version: 2,
  return_id: null, claim_id: null, exchange_id: null, change_type: "edit", description: "preserve", status: "pending",
  internal_note: "keep", created_by: null, requested_by: null, requested_at: null, confirmed_by: null, confirmed_at: null,
  declined_by: null, declined_reason: null, declined_at: null, canceled_by: "prior", canceled_at: "2020-01-02T00:00:00.000Z",
  carry_over_promotions: null, metadata: { keep: true, remove: 1, nested: { prior: true }, literal: "" },
  created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null });
const parent = (): JsonObject => ({ id: "order-unit", display_id: 31, custom_display_id: null, region_id: null, customer_id: null,
  version: 1, sales_channel_id: null, status: "pending", is_draft_order: false, email: null, currency_code: "usd", locale: null,
  no_notification: null, metadata: null, canceled_at: null, shipping_address_id: null, billing_address_id: null,
  created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null });
const dto = (value: JsonObject): JsonObject => ({ ...value, order: { id: value.order_id ?? null } });
const guardFields = ["id", "order_id", "return_id", "claim_id", "exchange_id", "version", "status"];
function read(where: JsonObject, fields?: readonly string[]): Activity["relationalReads"][number] {
  const plan = Result.getOrThrow(prepared.query({ where, options: { populate: [], orderBy: { id: "ASC" }, ...(fields ? { fields } : {}) } }));
  return { table: "order_change", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 };
}
function packet(input: JsonObject = { id: "ordch-unit" }, metadata: Json = before().metadata ?? null): Packet {
  const initial = before(), after = { ...initial, status: "canceled", canceled_at: "2026-10-23T01:00:00.000Z",
    canceled_by: input.canceled_by ?? initial.canceled_by ?? null, metadata, updated_at: "2026-10-23T01:00:01.000Z" };
  return { call: { commandName: "orderChangeCancel", mode: "write", input, result: null, events: [event(initial.id)],
    fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 },
    activity: { ...empty(), observedRows: [{ table: "order_change", row: after },
      { table: "order", row: parent() }], relationalReads: [read({ id: [initial.id] }, guardFields), read({ $or: [{ id: initial.id }] }),
      { table: "order", query: commerceRelationReadQuery(defaultCommerceResources, Result.getOrThrow(prepared.orderPredicate([initial]))), total: 1, returned: 1 }],
      mutations: [{ ordinal: 0, table: "order_change", operation: "patch", before: initial, after }] } };
}
const accepted = (value: Packet) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (value: Packet) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
function replaceAfter(value: Packet, patch: JsonObject): Packet {
  const after = value.activity.mutations[0]?.after;
  if (after === null || after === undefined) throw new Error("Missing transition");
  const changed = { ...after, ...patch };
  return { ...value, call: value.call.commandName === "orderChangeRestoreCancellation"
    ? { ...value.call, result: dto(changed) } : value.call,
    activity: { ...value.activity,
      observedRows: value.activity.observedRows.map(observation => observation.table === "order_change" && jsonEqual(observation.row, after)
        ? { ...observation, row: changed } : observation),
      mutations: value.activity.mutations.map(mutation => ({ ...mutation, after: changed })) } };
}

describe("Order Change cancellation receipts", () => {
  beforeAll(async () => {
    prepared = Result.getOrThrow(prepareOrderChangeCancellationRepository((await Effect.runPromise(captureOrderMetadata())).frame));
    policy = orderChangeCancellationPolicy(prepared);
  });
  it("authenticates genuine cancellation and an optional actor without changing omitted metadata", async () => {
    await accepted(packet()); await accepted(packet({ id: before().id, canceled_by: "actor" }));
    await refused(replaceAfter(packet(), { canceled_by: "invented" }));
  });
  it("correlates current post-write, retained pre-write and mixed observations with one exact native transition", async () => {
    const value = packet(), mutation = value.activity.mutations[0];
    if (mutation?.before === null || mutation?.before === undefined || mutation.after === null) throw new Error("Missing transition");
    await accepted(value);
    await accepted({ ...value, activity: { ...value.activity, observedRows: [{ table: "order_change", row: mutation.before },
      { table: "order", row: parent() }] } });
    await accepted({ ...value, activity: { ...value.activity, observedRows: [{ table: "order_change", row: mutation.before },
      { table: "order_change", row: mutation.after }, { table: "order", row: parent() }] } });
    for (const row of [{ ...mutation.after, description: "neither-before-nor-after" }, { ...mutation.after, id: "foreign" }])
      await refused({ ...value, activity: { ...value.activity, observedRows: [{ table: "order_change", row }, { table: "order", row: parent() }] } });
  });
  it.each([
    { supplied: null, expected: null },
    { supplied: {}, expected: {} },
    { supplied: { added: 2 }, expected: { keep: true, remove: 1, nested: { prior: true }, literal: "", added: 2 } },
    { supplied: { remove: "", nested: { next: true }, nullable: null }, expected: { keep: true, nested: { next: true }, literal: "", nullable: null } },
  ])("authenticates native metadata preparation for $supplied", async ({ supplied, expected }) => {
    const value = packet({ id: before().id, metadata: supplied }, expected);
    await accepted(value); await refused(replaceAfter(value, { metadata: { forged: true } }));
  });
  it("restores only retained cancellation fields and literal metadata exactly, including repeated inverse writes", async () => {
    const value = packet(), canceled = value.activity.mutations[0]?.after;
    if (canceled === null || canceled === undefined) throw new Error("Missing canceled row");
    const initial = before(), input = { id: initial.id, status: "pending", canceled_at: initial.canceled_at ?? null,
      canceled_by: initial.canceled_by ?? null, metadata: initial.metadata ?? null };
    const restored = { ...canceled, ...input, updated_at: "2026-10-23T02:00:00.000Z" };
    const inverse: Packet = { call: { ...value.call, commandName: "orderChangeRestoreCancellation", input, result: dto(restored) },
      activity: { ...value.activity, observedRows: [{ table: "order_change", row: restored }, { table: "order", row: parent() }],
        relationalReads: value.activity.relationalReads.slice(1), mutations: [{ ordinal: 0, table: "order_change", operation: "patch", before: canceled, after: restored }] } };
    await accepted(inverse);
    await refused({ ...inverse, activity: { ...inverse.activity, observedRows: [{ table: "order_change",
      row: { ...restored, description: "forged-inverse-observation" } }, { table: "order", row: parent() }] } });
    await refused(replaceAfter(inverse, { metadata: { keep: true, remove: 1, nested: { prior: true }, literal: "", added: true } }));
    const repeatedAfter = { ...restored, updated_at: "2026-10-23T03:00:00.000Z" };
    const repeated: Packet = { call: { ...inverse.call, result: dto(repeatedAfter) }, activity: { ...inverse.activity,
      observedRows: [{ table: "order_change", row: repeatedAfter }, { table: "order", row: parent() }],
      mutations: [{ ordinal: 0, table: "order_change", operation: "patch", before: restored, after: repeatedAfter }] } };
    await accepted(repeated); await refused({ ...repeated, call: { ...repeated.call, events: [] } });
    await refused({ ...repeated, activity: { ...repeated.activity, observedRows: [{ table: "order_change",
      row: { ...repeatedAfter, requested_by: "forged-repeat-observation" } }, { table: "order", row: parent() }] } });
  });
  it("reads native terminal and nullable statuses before the genuine forward guard", async () => {
    for (const status of ["pending", "requested", "canceled", "confirmed", "declined", null]) {
      const initial: JsonObject & { readonly id: string } = { ...before(), status };
      const fields = ["id", "status", "canceled_at", "canceled_by"];
      const selected = { id: initial.id, status, canceled_at: initial.canceled_at ?? null, canceled_by: initial.canceled_by ?? null };
      const template = packet();
      await accepted({ call: { ...template.call, commandName: "orderChangeRetrieveForCancellation", mode: "read",
        input: { id: initial.id, config: { select: fields, relations: [] } }, result: selected, events: [] },
        activity: { ...empty(), observedRows: [{ table: "order_change", row: initial }], relationalReads: [read({ id: initial.id }, fields)] } });
      expect(Result.isSuccess(prepared.contracts.decodeSelected(selected))).toBe(true);
      expect(Result.isSuccess(prepared.contracts.decodePreimage(selected))).toBe(status === "pending" || status === "requested");
    }
  });
  it("rejects successful writes for every terminal or nullable prior status", async () => {
    for (const status of ["canceled", "confirmed", "declined", null]) {
      const value = packet(), initial = { ...before(), status };
      await refused({ ...value, activity: { ...value.activity,
        observedRows: [{ table: "order_change", row: initial }, { table: "order", row: parent() }],
        mutations: value.activity.mutations.map(mutation => ({ ...mutation, before: initial })) } });
    }
  });
  it.each(["order_id", "version", "created_at", "description", "internal_note", "requested_at", "confirmed_at", "deleted_at"])(
    "refuses unrequested %s mutation", async field => {
      await refused(replaceAfter(packet(), { [field]: field === "version" ? 9 : "forged" }));
    });
  it("requires genuine canonical native dates", async () => {
    for (const canceled_at of [null, "invalid", "2026-10-23", "2026-10-23T01:00:00Z"])
      await refused(replaceAfter(packet(), { canceled_at }));
  });
  it("refuses missing guard/default/parent reads and foreign observations", async () => {
    const value = packet();
    for (let i = 0; i < value.activity.relationalReads.length; i++)
      await refused({ ...value, activity: { ...value.activity, relationalReads: value.activity.relationalReads.filter((_, index) => index !== i) } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows, { table: "order_change_action", row: {} }] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [{ table: "order_change", row: before() }] } });
  });
  it("refuses unknown commands, results and event identities", async () => {
    const value = packet();
    for (const call of [{ ...value.call, commandName: "orderChangeUpdate" }, { ...value.call, result: [] },
      { ...value.call, events: [] }, { ...value.call, events: [event("foreign")] },
      { ...value.call, events: [...value.call.events, ...value.call.events] }]) await refused({ ...value, call });
  });
  it("keeps cancellation and inverse argument authority finite", () => {
    for (const field of ["status", "order_id", "version", "canceled_at", "actions", "description"])
      expect(Result.isFailure(decodeOrderChangeCancellationInput({ id: before().id, [field]: null }))).toBe(true);
    for (const status of [null, "canceled", "confirmed", "declined"])
      expect(Result.isFailure(decodeOrderChangeCancellationPreimage({ id: before().id, status, canceled_at: null, canceled_by: null }))).toBe(true);
    expect(Result.isFailure(decodeOrderChangeCancellationInput([{ id: before().id }]))).toBe(true);
    const complete = dto(before());
    expect(Result.isSuccess(prepared.contracts.decodeRows([complete]))).toBe(true);
    for (const value of [before(), { ...complete, order: { id: "foreign" } }, { ...complete, unknown: true }])
      expect(Result.isFailure(prepared.contracts.decodeOutput(value))).toBe(true);
  });
  it("refuses own prototype keys before native metadata preparation while preserving ordinary business keys", async () => {
    const unsafe: JsonObject = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(Result.isFailure(decodeOrderChangeCancellationInput({ id: before().id, metadata: unsafe }))).toBe(true);
    expect(Result.isFailure(decodeOrderChangeCancellationInput({ id: before().id, metadata: { nested: unsafe } }))).toBe(true);
    const value = packet({ id: before().id, metadata: unsafe }, {});
    await refused(value);
    const ordinary = JSON.parse('{"constructor":"business","prototype":"business"}');
    expect(Result.isSuccess(decodeOrderChangeCancellationInput({ id: before().id, metadata: ordinary }))).toBe(true);
    const initial = { ...before(), metadata: unsafe };
    await refused({ ...packet(), activity: { ...packet().activity,
      observedRows: [{ table: "order_change", row: initial }, { table: "order", row: parent() }] } });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
