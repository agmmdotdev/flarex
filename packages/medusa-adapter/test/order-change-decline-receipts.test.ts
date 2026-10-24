import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { prepareOrderChangeDeclineRepository } from "../src/modules/order/change-decline-repository";
import { orderChangeDeclinePolicy } from "../src/modules/order/change-decline-receipt";
import { decodeOrderChangeDeclineInput, decodeOrderChangeDeclinePreimage } from "../src/modules/order/change-decline-input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Packet = { readonly call: Call; readonly activity: Activity };
let prepared: Result.Result.Success<ReturnType<typeof prepareOrderChangeDeclineRepository>>;
let policy: ReturnType<typeof orderChangeDeclinePolicy>;
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string): Json => ({ name: "order.order-change.updated", data: { id },
  metadata: { source: "order", object: "order_change", action: "updated" } });
const before = (): JsonObject & { readonly id: string } => ({ id: "ordch-unit", order_id: "order-unit", version: 2,
  return_id: null, claim_id: null, exchange_id: null, change_type: "edit", description: "preserve", status: "pending",
  internal_note: "keep", created_by: null, requested_by: null, requested_at: null, confirmed_by: null, confirmed_at: null,
  declined_by: "prior", declined_reason: "preserve reason", declined_at: "2020-01-02T00:00:00.000Z", canceled_by: "prior-cancel", canceled_at: "2020-01-03T00:00:00.000Z",
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
  const initial = before(), after = { ...initial, status: "declined", declined_at: "2026-10-23T01:00:00.000Z",
    declined_by: input.declined_by ?? initial.declined_by ?? null, metadata, updated_at: "2026-10-23T01:00:01.000Z" };
  return { call: { commandName: "orderChangeDecline", mode: "write", input, result: null, events: [event(initial.id)],
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
  return { ...value, call: value.call.commandName === "orderChangeRestoreDecline"
    ? { ...value.call, result: dto(changed) } : value.call,
    activity: { ...value.activity,
      observedRows: value.activity.observedRows.map(observation => observation.table === "order_change" && jsonEqual(observation.row, after)
        ? { ...observation, row: changed } : observation),
      mutations: value.activity.mutations.map(mutation => ({ ...mutation, after: changed })) } };
}

describe("Order Change decline receipts", () => {
  beforeAll(async () => {
    prepared = Result.getOrThrow(prepareOrderChangeDeclineRepository((await Effect.runPromise(captureOrderMetadata())).frame));
    policy = orderChangeDeclinePolicy(prepared);
  });
  it("authenticates genuine decline and an optional actor without changing omitted metadata", async () => {
    await accepted(packet()); await accepted(packet({ id: before().id, declined_by: "actor" }));
    await refused(replaceAfter(packet(), { declined_by: "invented" }));
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
  it("restores only retained decline fields and literal metadata exactly, including repeated inverse writes", async () => {
    const value = packet(), declined = value.activity.mutations[0]?.after;
    if (declined === null || declined === undefined) throw new Error("Missing declined row");
    const initial = before(), input = { id: initial.id, status: "pending", declined_at: initial.declined_at ?? null,
      declined_by: initial.declined_by ?? null, metadata: initial.metadata ?? null };
    const restored = { ...declined, ...input, updated_at: "2026-10-23T02:00:00.000Z" };
    const inverse: Packet = { call: { ...value.call, commandName: "orderChangeRestoreDecline", input, result: dto(restored) },
      activity: { ...value.activity, observedRows: [{ table: "order_change", row: restored }, { table: "order", row: parent() }],
        relationalReads: value.activity.relationalReads.slice(1), mutations: [{ ordinal: 0, table: "order_change", operation: "patch", before: declined, after: restored }] } };
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
      const fields = ["id", "status", "declined_at", "declined_by"];
      const selected = { id: initial.id, status, declined_at: initial.declined_at ?? null, declined_by: initial.declined_by ?? null };
      const template = packet();
      await accepted({ call: { ...template.call, commandName: "orderChangeRetrieveForDecline", mode: "read",
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
  it.each([
    { field: "id", value: "ordch-forged" }, { field: "order_id", value: "order-forged" },
    { field: "return_id", value: "return-forged" }, { field: "claim_id", value: "claim-forged" },
    { field: "exchange_id", value: "exchange-forged" }, { field: "version", value: 9 },
    { field: "change_type", value: "forged" }, { field: "description", value: "forged" },
    { field: "internal_note", value: "forged" }, { field: "created_by", value: "forged" },
    { field: "requested_by", value: "forged" }, { field: "requested_at", value: "2026-10-24T00:00:00.000Z" },
    { field: "confirmed_by", value: "forged" }, { field: "confirmed_at", value: "2026-10-24T00:00:00.000Z" },
    { field: "declined_reason", value: "must stay unchanged" },
    { field: "canceled_by", value: "forged" }, { field: "canceled_at", value: "2026-10-24T00:00:00.000Z" },
    { field: "carry_over_promotions", value: true }, { field: "created_at", value: "2026-10-24T00:00:00.000Z" },
    { field: "deleted_at", value: "2026-10-24T00:00:00.000Z" },
  ])("refuses unrequested $field mutation with otherwise valid native values", async ({ field, value }) => {
    await refused(replaceAfter(packet(), { [field]: value }));
  });
  it("requires genuine canonical native dates", async () => {
    for (const declined_at of [null, "invalid", "2026-10-23", "2026-10-23T01:00:00Z"])
      await refused(replaceAfter(packet(), { declined_at }));
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
  it("keeps decline and inverse argument authority finite", () => {
    for (const field of ["status", "order_id", "version", "declined_at", "declined_reason", "canceled_at", "canceled_by", "actions", "description"])
      expect(Result.isFailure(decodeOrderChangeDeclineInput({ id: before().id, [field]: null }))).toBe(true);
    for (const status of [null, "canceled", "confirmed", "declined"])
      expect(Result.isFailure(decodeOrderChangeDeclinePreimage({ id: before().id, status, declined_at: null, declined_by: null }))).toBe(true);
    expect(Result.isFailure(decodeOrderChangeDeclineInput([{ id: before().id }]))).toBe(true);
    const complete = dto(before());
    expect(Result.isSuccess(prepared.contracts.decodeRows([complete]))).toBe(true);
    for (const value of [before(), { ...complete, order: { id: "foreign" } }, { ...complete, unknown: true }])
      expect(Result.isFailure(prepared.contracts.decodeOutput(value))).toBe(true);
  });
  it("authenticates requested status and an event containing a singleton native ID array", async () => {
    const value = packet(), requested = { ...before(), status: "requested" };
    await accepted({ ...value, call: { ...value.call, events: [{ name: "order.order-change.updated", data: { id: [requested.id] },
      metadata: { source: "order", object: "order_change", action: "updated" } }] },
      activity: { ...value.activity, mutations: value.activity.mutations.map(mutation => ({ ...mutation, before: requested })) } });
    await refused(replaceAfter(value, { status: "requested" }));
  });
  it("preserves current metadata when the inverse did not retain metadata", async () => {
    const value = packet({ id: before().id, metadata: { fresh: true } },
      { keep: true, remove: 1, nested: { prior: true }, literal: "", fresh: true });
    const declined = value.activity.mutations[0]?.after;
    if (declined === null || declined === undefined) throw new Error("Missing declined row");
    const initial = before(), input = { id: initial.id, status: "pending", declined_at: initial.declined_at ?? null,
      declined_by: initial.declined_by ?? null };
    const restored = { ...declined, ...input, updated_at: "2026-10-24T01:00:00.000Z" };
    const inverse: Packet = { call: { ...value.call, commandName: "orderChangeRestoreDecline", input, result: dto(restored) },
      activity: { ...value.activity, observedRows: [{ table: "order_change", row: restored }, { table: "order", row: parent() }],
        relationalReads: value.activity.relationalReads.slice(1), mutations: [{ ordinal: 0, table: "order_change", operation: "patch", before: declined, after: restored }] } };
    await accepted(inverse);
    await refused(replaceAfter(inverse, { metadata: initial.metadata ?? null }));
    await refused(replaceAfter(inverse, { declined_reason: "invented inverse reason" }));
    await refused(replaceAfter(inverse, { canceled_by: "invented inverse cancellation" }));
    await refused(replaceAfter(inverse, { status: "requested" }));
  });
  it("authenticates exact read order, row counts and active parent identity", async () => {
    const value = packet();
    await refused({ ...value, activity: { ...value.activity, relationalReads: [...value.activity.relationalReads].reverse() } });
    await refused({ ...value, activity: { ...value.activity,
      relationalReads: [...value.activity.relationalReads, ...value.activity.relationalReads] } });
    for (const change of [{ total: 2 }, { returned: 0 }, { table: "order" }])
      await refused({ ...value, activity: { ...value.activity,
        relationalReads: value.activity.relationalReads.map((receipt, index) => index === 0 ? { ...receipt, ...change } : receipt) } });
    for (const row of [{ ...parent(), id: "order-foreign" }, { ...parent(), deleted_at: "2026-10-24T00:00:00.000Z" }])
      await refused({ ...value, activity: { ...value.activity, observedRows: value.activity.observedRows.map(observation =>
        observation.table === "order" ? { ...observation, row } : observation) } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows,
      { table: "order", row: { ...parent(), version: 9 } }] } });
  });
  it("refuses absent, extra and misidentified transitions", async () => {
    const value = packet();
    await refused({ ...value, call: { ...value.call, mode: "read" } });
    await refused({ ...value, activity: { ...value.activity, mutations: [] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [...value.activity.mutations, ...value.activity.mutations] } });
    for (const patch of [{ ordinal: 1 }, { table: "order" }, { before: null }, { after: null }])
      await refused({ ...value, activity: { ...value.activity, mutations: value.activity.mutations.map(mutation => ({ ...mutation, ...patch })) } });
  });
  it("checks preimage read result, mode and absence of writes and parent reads", async () => {
    const initial = before(), fields = ["id", "status", "declined_at", "declined_by", "metadata"];
    const selected = { id: initial.id, status: initial.status ?? null, declined_at: initial.declined_at ?? null,
      declined_by: initial.declined_by ?? null, metadata: initial.metadata ?? null }, template = packet();
    const value: Packet = { call: { ...template.call, commandName: "orderChangeRetrieveForDecline", mode: "read",
      input: { id: initial.id, config: { select: fields, relations: [] } }, result: selected, events: [] },
      activity: { ...empty(), observedRows: [{ table: "order_change", row: initial }], relationalReads: [read({ id: initial.id }, fields)] } };
    await accepted(value);
    await refused({ ...value, call: { ...value.call, result: { ...selected, declined_reason: "not selected" } } });
    await refused({ ...value, call: { ...value.call, result: { ...selected, status: "requested" } } });
    await refused({ ...value, call: { ...value.call, mode: "write" } });
    await refused({ ...value, call: { ...value.call, events: [event(initial.id)] } });
    await refused({ ...value, activity: { ...value.activity, mutations: template.activity.mutations } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows, { table: "order", row: parent() }] } });
  });
  it("refuses foreign module event source, object, action and data cardinality", async () => {
    const value = packet();
    for (const message of [
      { name: "order.order-change.updated", data: { id: before().id }, metadata: { source: "cart", object: "order_change", action: "updated" } },
      { name: "order.order-change.updated", data: { id: before().id }, metadata: { source: "order", object: "order", action: "updated" } },
      { name: "order.order-change.updated", data: { id: before().id }, metadata: { source: "order", object: "order_change", action: "created" } },
      { name: "order.order-change.updated", data: { id: [] }, metadata: { source: "order", object: "order_change", action: "updated" } },
      { name: "order.order-change.updated", data: { id: [before().id, before().id] }, metadata: { source: "order", object: "order_change", action: "updated" } },
    ]) await refused({ ...value, call: { ...value.call, events: [message] } });
  });
  it("refuses own prototype keys before native metadata preparation while preserving ordinary business keys", async () => {
    const unsafe: JsonObject = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(Result.isFailure(decodeOrderChangeDeclineInput({ id: before().id, metadata: unsafe }))).toBe(true);
    expect(Result.isFailure(decodeOrderChangeDeclineInput({ id: before().id, metadata: { nested: unsafe } }))).toBe(true);
    const value = packet({ id: before().id, metadata: unsafe }, {});
    await refused(value);
    const ordinary = JSON.parse('{"constructor":"business","prototype":"business"}');
    expect(Result.isSuccess(decodeOrderChangeDeclineInput({ id: before().id, metadata: ordinary }))).toBe(true);
    const initial = { ...before(), metadata: unsafe };
    await refused({ ...packet(), activity: { ...packet().activity,
      observedRows: [{ table: "order_change", row: initial }, { table: "order", row: parent() }] } });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
