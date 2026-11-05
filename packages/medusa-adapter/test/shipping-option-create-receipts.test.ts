import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionCreationRepository } from "../src/modules/fulfillment/shipping-option-create-repository";
import { shippingOptionCreationPolicy } from "../src/modules/fulfillment/shipping-option-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingOptionCreationPolicy>;
let nativePolicy: ReturnType<typeof shippingOptionCreationPolicy>;
const stamp = "2026-10-18T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const type: JsonObject = { id: "type", label: "Native", code: "native", description: null, ...managed };
const option: JsonObject = { id: "option", name: "Native", price_type: "flat", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual",
  shipping_option_type_id: "type", data: null, metadata: null, ...managed };
const rule: JsonObject = { id: "rule", attribute: "enabled", operator: "eq", value: "true", shipping_option_id: "option", ...managed };
const input = { name: "Native", price_type: "flat", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual",
  type: { label: "Native", code: "native" }, rules: [{ attribute: "enabled", operator: "eq", value: true }] };
const output = { ...option, type, rules: [rule], fulfillments: [] };
const profile: JsonObject = { id: "profile", name: "Profile", type: "default", metadata: null, ...managed };
const provider: JsonObject = { id: "manual_manual", is_enabled: true, ...managed };
const zone: JsonObject = { id: "zone", name: "Zone", fulfillment_set_id: "set", metadata: null, ...managed };
const event = (object: string, id: string, action = "created"): Json => ({ name: "fulfillment." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "fulfillment", object, action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const call = (): Call => ({ commandName: "shippingOptionCreateForWorkflow", mode: "write", input: [input], result: [output],
  events: [event("shipping_option_type", "type"), event("shipping_option", "option"), event("shipping_option_rule", "rule")], fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 0 });
const activity = (): Activity => ({ ...empty(), observedRows: [{ table: "shipping_option_type", row: type }, { table: "shipping_option", row: option }, { table: "shipping_option_rule", row: rule }],
  mutations: [{ ordinal: 0, table: "shipping_option_type", operation: "insert", before: null, after: type },
    { ordinal: 1, table: "shipping_option", operation: "insert", before: null, after: option },
    { ordinal: 2, table: "shipping_option_rule", operation: "insert", before: null, after: rule }] });
const refused = async (value: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const nativeActivity = (): Activity => ({ ...activity(), observedRows: [...activity().observedRows,
  { table: "shipping_profile", row: profile }, { table: "fulfillment_provider", row: provider }, { table: "service_zone", row: zone }] });
const nativeRefused = async (value: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(nativePolicy.validateLogicalCall(value, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => {
  const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
  policy = shippingOptionCreationPolicy(Result.getOrThrow(prepareShippingOptionCreationRepository(metadata)));
  nativePolicy = shippingOptionCreationPolicy(Result.getOrThrow(prepareShippingOptionCreationRepository(metadata, "standalone", { statementReferenceChecks: true })));
});

describe("native Shipping Option creation receipt correlation", () => {
  it("authenticates the complete eight-Provider availability read without widening creation", async () => {
    const providers = Array.from({ length: 8 }, (_, index) => ({ id: "provider-" + index, is_enabled: true, ...managed })), ids = providers.map(row => row.id);
    const value: Call = { ...call(), commandName: "shippingOptionProviderCountForCreate", mode: "read", input: { filters: { id: ids }, config: { select: ["id"] } },
      result: [providers.map(row => ({ id: row.id })), 8], events: [], toAttempt: 0 };
    const evidence: Activity = { ...empty(), observedRows: providers.map(row => ({ table: "fulfillment_provider", row })), relationalReads: [{ table: "fulfillment_provider",
      query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "and", children: [{ kind: "in", column: "id", values: ids }] }, { kind: "isNull", column: "deleted_at" }] } }, total: 8, returned: 8 }] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, observedRows: evidence.observedRows.slice(1) });
    await refused({ ...value, result: [providers.slice(0, 4).map(row => ({ id: row.id })), 8] }, evidence);
  });
  it("correlates complete inserted graph, genuine boolean rule normalization, and native event order", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call(), activity()));
    await refused({ ...call(), events: [...call().events].reverse() }, activity());
    await refused({ ...call(), result: [{ ...output, rules: [{ ...rule, value: true }] }] }, activity());
    await refused(call(), { ...activity(), mutations: activity().mutations.slice(1) });
    await refused(call(), { ...activity(), observedRows: [] });
    await refused(call(), { ...activity(), observedRows: [...activity().observedRows, { table: "shipping_option_type", row: { ...type, code: "forged" } }] });
    await refused({ ...call(), result: [{ ...output, fulfillments: [{ id: "uncreated" }] }] }, activity());
  });

  it("authenticates the physical Option/Rule inverse while retaining inline Type", async () => {
    const read = (table: string, column: string, values: string[]) => ({ table, query: { take: defaultCommerceResources.queryRows,
      order: { column: "id", direction: "asc" as const }, predicate: { kind: "in" as const, column, values } }, total: 1, returned: 1 });
    const value: Call = { ...call(), commandName: "shippingOptionPhysicalDeleteForWorkflow", input: ["option"], result: null,
      events: [event("shipping_option", "option", "deleted")], toAttempt: 2 };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: option }, { table: "shipping_option_rule", row: rule }],
      relationalReads: [read("shipping_option", "id", ["option"]), read("shipping_option_rule", "shipping_option_id", ["option"])],
      mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "delete", before: rule, after: null },
        { ordinal: 1, table: "shipping_option", operation: "delete", before: option, after: null }] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, relationalReads: evidence.relationalReads.slice(0, 1) });
    await refused(value, { ...evidence, mutations: [...evidence.mutations, { ordinal: 2, table: "shipping_option_type", operation: "delete", before: type, after: null }] });
    await refused({ ...value, events: [...value.events, event("shipping_option_rule", "rule", "deleted")] }, evidence);
  });

  it("requires indexed existing-Type evidence without inventing a Type creation event", async () => {
    const value: Call = { ...call(), input: [{ ...input, type: "type" }], events: call().events.slice(1), toAttempt: 2 };
    const evidence: Activity = { ...activity(), mutations: activity().mutations.slice(1).map((mutation, ordinal) => ({ ...mutation, ordinal })),
      relationalReads: [{ table: "shipping_option_type", query: { take: defaultCommerceResources.queryRows,
        order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [{ kind: "in", column: "id", values: ["type"] }, { kind: "isNull", column: "deleted_at" }] } }, total: 1, returned: 1 }] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, relationalReads: [] });
    await refused({ ...value, events: call().events }, evidence);
    await refused({ ...value, input: [{ ...input, type: "outside" }] }, evidence);
  });

  it("correlates selected ServiceZone to-one projection and its exact parent FK read", async () => {
    const zone: JsonObject = { id: "zone", name: "Zone", fulfillment_set_id: "set", metadata: null, ...managed },
      set: JsonObject = { id: "set", name: "Set", type: "shipping", metadata: null, ...managed };
    const value: Call = { ...call(), commandName: "shippingOptionServiceZoneCountForCreate", mode: "read",
      input: { filters: { id: ["zone"] }, config: { select: ["id", "fulfillment_set.id"], relations: ["fulfillment_set"] } },
      result: [[{ id: "zone", fulfillment_set: { id: "set" } }], 1], events: [], toAttempt: 0 };
    const query = (predicate: JsonObject) => ({ take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" as const }, predicate });
    const evidence: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: zone }, { table: "fulfillment_set", row: set }],
      relationalReads: [{ table: "service_zone", query: query({ kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "id", values: ["zone"] }] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 },
        { table: "fulfillment_set", query: query({ kind: "and", children: [{ kind: "in", column: "id", values: ["set"] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 }] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, relationalReads: evidence.relationalReads.slice(0, 1) });
    await refused({ ...value, result: [[{ id: "zone", fulfillment_set: { id: "outside" } }], 1] }, evidence);
  });

  it("requires real empty ID reads and genuine Manual calculated validation", async () => {
    const value: Call = { ...call(), commandName: "shippingOptionValidateCalculationForCreate", mode: "read", input: [{ ...input, price_type: "calculated" }], result: [false], events: [], toAttempt: 0 };
    await Effect.runPromise(policy.validateLogicalCall(value, empty()));
    await refused({ ...value, result: [true] }, empty()); await refused({ ...value, result: [] }, empty());
    const list: Call = { ...value, commandName: "shippingOptionListForCreate", input: { filters: { id: [""] }, config: { select: ["id", "price_type", "provider_id"] } }, result: [] };
    const evidence: Activity = { ...empty(), relationalReads: [{ table: "shipping_option", query: { take: defaultCommerceResources.queryRows,
      order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "id", values: [""] }] }, { kind: "isNull", column: "deleted_at" }] } }, total: 0, returned: 0 }] };
    await Effect.runPromise(policy.validateLogicalCall(list, evidence)); await refused(list, empty());
  });

  it("selects native statement checks with the exact metadata-derived target cohort", async () => {
    expect(nativePolicy.statementReferenceChecks).toBe(true);
    expect(policy.statementReferenceChecks).toBeUndefined();
    await Effect.runPromise(nativePolicy.validateLogicalCall(call(), nativeActivity()));
    await Effect.runPromise(nativePolicy.validateLogicalCall({ ...call(), input: [{ ...input, type_id: "ignored-scalar" }] }, nativeActivity()));
    await nativeRefused(call(), activity());
    await refused(call(), nativeActivity());
  });

  it.each(["shipping_profile", "fulfillment_provider", "service_zone", "shipping_option_type", "shipping_option"])(
    "requires actual same-call %s target observations", async table => {
      await Effect.runPromise(nativePolicy.validateLogicalCall(call(), nativeActivity()));
      await nativeRefused(call(), { ...nativeActivity(), observedRows: nativeActivity().observedRows.filter(row => row.table !== table) });
    });

  it("rejects extra, duplicate, foreign and malformed native target evidence", async () => {
    for (const observedRows of [
      [...nativeActivity().observedRows, { table: "shipping_profile", row: { ...profile, id: "unused" } }],
      [...nativeActivity().observedRows, { table: "fulfillment_set", row: { id: "set", name: "Set", type: "shipping", metadata: null, ...managed } }],
      [...nativeActivity().observedRows, { table: "foreign_table", row: profile }],
      nativeActivity().observedRows.map(row => row.table === "shipping_profile" ? { ...row, row: { ...profile, name: null } } : row),
      nativeActivity().observedRows.map(row => row.table === "shipping_profile" ? { ...row, row: { ...profile, id: "outside" } } : row),
    ]) await nativeRefused(call(), { ...nativeActivity(), observedRows });
    for (const table of ["shipping_profile", "shipping_option_type", "shipping_option"]) {
      const duplicate = nativeActivity().observedRows.find(row => row.table === table);
      if (duplicate === undefined) throw new Error("Missing native duplicate test target");
      await nativeRefused(call(), { ...nativeActivity(), observedRows: [...nativeActivity().observedRows, duplicate] });
    }
  });

  it("requires pending Type and Option targets to match actual normalized afterimages", async () => {
    for (const table of ["shipping_option_type", "shipping_option"]) await nativeRefused(call(), {
      ...nativeActivity(), observedRows: nativeActivity().observedRows.map(row => row.table !== table ? row
        : { ...row, row: table === "shipping_option_type" ? { ...type, code: "stale" } : { ...option, name: "stale" } }),
    });
    // A preceding valid call supplies no target evidence to the next call.
    await Effect.runPromise(nativePolicy.validateLogicalCall(call(), nativeActivity()));
    await nativeRefused(call(), { ...nativeActivity(), observedRows: nativeActivity().observedRows.filter(row => row.table !== "shipping_profile") });
  });

  it("separates historical physical parents from active-only Type hydration", async () => {
    const historical = "2026-10-19T00:00:00.000Z", historicalType = { ...type, deleted_at: historical };
    const value: Call = { ...call(), input: [{ ...input, type: "type" }], result: [{ ...output, type: null }], events: call().events.slice(1), toAttempt: 2 };
    const evidence: Activity = { ...nativeActivity(), mutations: activity().mutations.slice(1).map((mutation, ordinal) => ({ ...mutation, ordinal })),
      observedRows: nativeActivity().observedRows.map(row => row.table === "shipping_option_type" ? { ...row, row: historicalType }
        : row.table === "shipping_profile" ? { ...row, row: { ...profile, deleted_at: historical } } : row),
      relationalReads: [{ table: "shipping_option_type", query: { take: defaultCommerceResources.queryRows,
        order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [{ kind: "in", column: "id", values: ["type"] }, { kind: "isNull", column: "deleted_at" }] } }, total: 0, returned: 0 }] };
    await Effect.runPromise(nativePolicy.validateLogicalCall(value, evidence));
    await nativeRefused(value, { ...evidence, observedRows: evidence.observedRows.filter(row => row.table !== "shipping_option_type") });
    await nativeRefused({ ...value, result: [{ ...output, type: historicalType }] }, evidence);
    const read = evidence.relationalReads[0];
    if (read === undefined) throw new Error("Missing historical Type hydration read");
    await nativeRefused(value, { ...evidence, relationalReads: [{ ...read, total: 1, returned: 1 }] });
  });

  it("requires each native root's Type, Option and Rules before the next root", async () => {
    const nextType: JsonObject = { ...type, id: "type-next", code: "next" }, nextOption: JsonObject = { ...option, id: "option-next", name: "Next", shipping_option_type_id: "type-next" },
      nextRule: JsonObject = { ...rule, id: "rule-next", shipping_option_id: "option-next" };
    const value: Call = { ...call(), input: [input, { ...input, name: "Next", type: { ...input.type, code: "next" } }],
      result: [output, { ...nextOption, type: nextType, rules: [nextRule], fulfillments: [] }], toAttempt: 6,
      events: [...call().events, event("shipping_option_type", "type-next"), event("shipping_option", "option-next"), event("shipping_option_rule", "rule-next")] };
    const evidence: Activity = { ...nativeActivity(), observedRows: [...nativeActivity().observedRows, { table: "shipping_option_type", row: nextType },
      { table: "shipping_option", row: nextOption }, { table: "shipping_option_rule", row: nextRule }], mutations: [...activity().mutations,
      { ordinal: 3, table: "shipping_option_type", operation: "insert", before: null, after: nextType },
      { ordinal: 4, table: "shipping_option", operation: "insert", before: null, after: nextOption },
      { ordinal: 5, table: "shipping_option_rule", operation: "insert", before: null, after: nextRule }] };
    await Effect.runPromise(nativePolicy.validateLogicalCall(value, evidence));
    const order = [0, 3, 1, 4, 2, 5], grouped: Activity = { ...evidence,
      mutations: order.map((position, ordinal) => {
        const mutation = evidence.mutations[position];
        if (mutation === undefined) throw new Error("Missing native graph mutation");
        return { ...mutation, ordinal };
      }) };
    await nativeRefused(value, grouped);
    await Effect.runPromise(policy.validateLogicalCall(value, { ...grouped,
      observedRows: grouped.observedRows.filter(row => ["shipping_option_type", "shipping_option", "shipping_option_rule"].includes(row.table)) }));
    await refused(value, { ...evidence,
      observedRows: evidence.observedRows.filter(row => ["shipping_option_type", "shipping_option", "shipping_option_rule"].includes(row.table)) });
  });
});
