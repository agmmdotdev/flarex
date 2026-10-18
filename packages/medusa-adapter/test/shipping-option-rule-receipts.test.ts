import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionRuleRepository } from "../src/modules/fulfillment/shipping-option-rule-repository";
import { shippingOptionRulePolicy } from "../src/modules/fulfillment/shipping-option-rule-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingOptionRulePolicy>, prepared: Result.Result.Success<ReturnType<typeof prepareShippingOptionRuleRepository>>;
const stamp = "2026-10-18T00:00:00.000Z", next = "2026-10-18T01:00:00.000Z";
const scalar = (id = "rule-a", extra: JsonObject = {}): JsonObject => ({ id, attribute: "a", operator: "eq", value: "v", shipping_option_id: "option-a",
  created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string, action = "created"): Json => ({ name: "fulfillment.shipping-option-rule." + action,
  metadata: { source: "fulfillment", object: "shipping_option_rule", action }, data: { id } });
const createCall = (): Call => ({ commandName: "shippingOptionRuleCreateForBatch", mode: "write",
  input: [{ id: "rule-a", attribute: "a", operator: "eq", value: "v", shipping_option_id: "option-a" }], result: [scalar()], events: [event("rule-a")],
  fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 });
const creation = (): Activity => ({ ...empty(), observedRows: [{ table: "shipping_option_rule", row: scalar() }],
  mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "insert", before: null, after: scalar() }] });
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const selectionRead = (selector: JsonObject, total = 1) => {
  const query = Result.getOrThrow(captureCommerceInput(buildQuery(selector)).pipe(Result.flatMap(prepared.query)));
  return { table: "shipping_option_rule", query: commerceRelationReadQuery(defaultCommerceResources, query.query.predicate), total, returned: total };
};
beforeAll(async () => {
  prepared = Result.getOrThrow(prepareShippingOptionRuleRepository((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame));
  policy = shippingOptionRulePolicy(prepared);
});

describe("native ShippingOptionRule receipt correlation", () => {
  it("binds complete creation scalars, native boolean normalization and ordered actual events", async () => {
    await Effect.runPromise(policy.validateLogicalCall(createCall(), creation()));
    const call = { ...createCall(), input: [{ attribute: "a", operator: "eq", value: true, shipping_option_id: "option-a" }],
      result: [scalar("rule-a", { value: "true" })] };
    const activity = { ...creation(), observedRows: [], mutations: creation().mutations.map(mutation => ({ ...mutation, after: scalar("rule-a", { value: "true" }) })) };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, result: [scalar("rule-a", { value: true })] }, activity);
    await refused({ ...call, input: [{ attribute: "a", operator: "eq", value: false, shipping_option_id: "option-a" }] }, activity);
    await refused({ ...createCall(), events: [] }, creation());
    await refused({ ...createCall(), events: [event("other")] }, creation());
  });

  it("rejects full-result, stored-field, target, operation and sibling forgeries", async () => {
    for (const result of [[scalar("other")], [scalar("rule-a", { value: "forged" })], [{ id: "rule-a" }], []])
      await refused({ ...createCall(), result }, creation());
    for (const extra of [{ value: "forged" }, { shipping_option_id: "outside" }, { updated_at: next }, { deleted_at: stamp }])
      await refused(createCall(), { ...creation(), mutations: creation().mutations.map(mutation => ({ ...mutation, after: scalar("rule-a", extra) })) });
    await refused(createCall(), empty());
    await refused({ ...createCall(), mode: "read" }, creation());
    await refused(createCall(), { ...creation(), mutations: creation().mutations.map(mutation => ({ ...mutation, table: "shipping_option" })) });
    await refused(createCall(), { ...creation(), observedRows: [{ table: "shipping_option", row: scalar() }] });
    await refused(createCall(), { ...creation(), relationalReads: [selectionRead({ id: "rule-a" })] });
  });

  it("binds the actual last-update deduplication, active read and complete output", async () => {
    const before = scalar(), after = scalar("rule-a", { value: "last", updated_at: next });
    const call: Call = { ...createCall(), commandName: "shippingOptionRuleUpdateForBatch",
      input: [{ id: "rule-a", attribute: "a", operator: "eq", value: "first" }, { id: "rule-a", attribute: "a", operator: "eq", value: "last" }],
      result: [after], events: [event("rule-a", "updated")] };
    const activity: Activity = { ...empty(), observedRows: [{ table: "shipping_option_rule", row: before }],
      relationalReads: [selectionRead({ $or: [{ id: "rule-a" }, { id: "rule-a" }] })],
      mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "patch", before, after }] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, input: [{ id: "rule-a", value: "last" }] }, activity);
    await refused(call, { ...activity, relationalReads: [] });
    await refused(call, { ...activity, mutations: [] });
    await refused({ ...call, result: [before] }, activity);
  });

  it("binds physical historical deletion to raw selectors, actual attempts and events", async () => {
    const before = scalar("rule-a", { deleted_at: stamp });
    const call: Call = { ...createCall(), commandName: "shippingOptionRuleDeleteForBatch", input: ["rule-a", "missing", "rule-a"], result: null,
      events: [event("rule-a", "deleted")] };
    const activity: Activity = { ...empty(), observedRows: [{ table: "shipping_option_rule", row: before }], relationalReads: [{ table: "shipping_option_rule",
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["rule-a", "missing", "rule-a"] },
        { kind: "storageInsertion", direction: "asc" }), total: 1, returned: 1, orderedIdentities: [{ id: "rule-a" }] }],
      mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "delete", before, after: null }] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, relationalReads: [] });
    await refused(call, { ...activity, mutations: [] });
    await refused({ ...call, result: ["rule-a"] }, activity);
    await refused({ ...call, events: [] }, activity);
    await refused({ ...call, input: ["outside"] }, activity);
  });

  it("requires authenticated complete insertion-order identities and binds actual deletion attempts/events to their order", async () => {
    const ids = ["rule-b", "rule-a"], physical = ["rule-a", "rule-b"];
    const call: Call = { ...createCall(), commandName: "shippingOptionRuleDeleteForBatch", input: ids, result: null,
      events: physical.map(id => event(id, "deleted")), toAttempt: 2 };
    const activity: Activity = { ...empty(), observedRows: physical.map(id => ({ table: "shipping_option_rule", row: scalar(id) })),
      relationalReads: [{ table: "shipping_option_rule", query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }), total: 2, returned: 2,
        orderedIdentities: physical.map(id => ({ id })) }],
      mutations: physical.map((id, ordinal) => ({ ordinal, table: "shipping_option_rule", operation: "delete", before: scalar(id), after: null })) };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const identities of [[], [{ id: "rule-a" }], [{ id: "rule-a" }, { id: "rule-a" }],
      [{ id: "outside" }, { id: "rule-b" }], ids.map(id => ({ id }))])
      await refused(call, { ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, orderedIdentities: identities })) });
    await refused(call, { ...activity, relationalReads: activity.relationalReads.map(({ orderedIdentities: _ordered, ...read }) => read) });
    await refused(call, { ...activity, mutations: [...activity.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal })) });
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    const missing: Call = { ...call, input: ["missing"], events: [], toAttempt: 0 };
    await Effect.runPromise(policy.validateLogicalCall(missing, { ...empty(), relationalReads: [{ table: "shipping_option_rule",
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["missing"] },
        { kind: "storageInsertion", direction: "asc" }), total: 0, returned: 0, orderedIdentities: [] }] }));
    await refused(missing, empty());
  });

  it("retains genuine empty creation and refuses invented empty activity/events", async () => {
    const call = { ...createCall(), input: [], result: [], events: [], toAttempt: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, empty()));
    await refused({ ...call, events: [event("invented")] }, empty());
    await refused(call, creation());
  });

  it("bounds whole-participant identities and before/after parent cohort", async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({ table: "shipping_option_rule", row: scalar("rule-" + index) }));
    await expect(Effect.runPromise(policy.validateLogical([], [], [], rows, []))).rejects.toMatchObject({ reason: "limitExceeded" });
    // This tests cohort accounting only. Immediate receipts prove actual Rule
    // calls; the core separately authenticates these closed FK observations.
    const foreign = Array.from({ length: 4 }, (_, index) => ({ table: "shipping_option", row: { id: "option-" + index } }));
    await Effect.runPromise(policy.validateLogical([], [], [], [...rows.slice(0, 12), ...foreign], []));
    const parents = Array.from({ length: 5 }, (_, index) => ({ table: "shipping_option_rule", row: scalar("rule-" + index, { shipping_option_id: "parent-" + index }) }));
    await expect(Effect.runPromise(policy.validateLogical([], [], [], parents, []))).rejects.toMatchObject({ reason: "limitExceeded" });
    await Effect.runPromise(policy.validateLogical([], [], [], parents.slice(0, 4), []));
  });
});
