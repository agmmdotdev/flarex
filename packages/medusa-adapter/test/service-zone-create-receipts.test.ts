import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileServiceZoneCreationContracts } from "../src/modules/fulfillment/service-zone-create-input";
import { serviceZoneCreationPolicy } from "../src/modules/fulfillment/service-zone-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof serviceZoneCreationPolicy>;
const stamp = "2026-10-18T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const zone: JsonObject = { id: "zone-a", name: " Native Zone ", fulfillment_set_id: "parent", metadata: null, ...managed };
const geo: JsonObject = { id: "geo-a", type: "country", country_code: "Raw", province_code: null, city: null,
  postal_expression: null, metadata: null, service_zone_id: "zone-a", ...managed };
const option: JsonObject = { id: "option-a", name: "Option", price_type: "flat", data: null, metadata: null, service_zone_id: "zone-a",
  shipping_profile_id: "profile", provider_id: "provider", shipping_option_type_id: "type", ...managed };
const rule: JsonObject = { id: "rule-a", attribute: "raw", operator: "eq", value: null, shipping_option_id: "option-a", ...managed };
const output = { ...zone, geo_zones: [geo], shipping_options: [] };
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (object: string, id: string, action = "created"): Json => ({ name: "fulfillment." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "fulfillment", object, action }, data: { id } });
const createCall = (): Call => ({ commandName: "serviceZoneCreateForWorkflow", mode: "write",
  input: [{ name: " Native Zone ", fulfillment_set_id: "parent", geo_zones: [{ type: "country", country_code: "Raw" }] }], result: [output],
  events: [event("service_zone", "zone-a"), event("geo_zone", "geo-a")], fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 });
const creation = (): Activity => ({ ...empty(), mutations: [
  { ordinal: 0, table: "service_zone", operation: "insert", before: null, after: zone },
  { ordinal: 1, table: "geo_zone", operation: "insert", before: null, after: geo },
] });
const read = (table: string, column: string, values: string[], count: number) => ({ table, query: { take: defaultCommerceResources.queryRows,
  order: { column: "id", direction: "asc" as const }, predicate: { kind: "in" as const, column, values } }, total: count, returned: count });
const deletionReads = () => [read("service_zone", "id", ["zone-a"], 1), read("shipping_option", "service_zone_id", ["zone-a"], 1),
  read("shipping_option_rule", "shipping_option_id", ["option-a"], 1), read("geo_zone", "service_zone_id", ["zone-a"], 1)];
const deletion = (): Activity => ({ ...empty(), observedRows: [
  { table: "service_zone", row: zone }, { table: "shipping_option", row: option }, { table: "shipping_option_rule", row: rule }, { table: "geo_zone", row: geo },
], relationalReads: deletionReads(),
mutations: [
  { ordinal: 0, table: "shipping_option_rule", operation: "delete", before: rule, after: null },
  { ordinal: 1, table: "geo_zone", operation: "delete", before: geo, after: null },
  { ordinal: 2, table: "shipping_option", operation: "delete", before: option, after: null },
  { ordinal: 3, table: "service_zone", operation: "delete", before: zone, after: null },
] });
const deleteCall = (): Call => ({ commandName: "serviceZonePhysicalDeleteForWorkflow", mode: "write", input: ["zone-a"], result: null,
  events: [event("service_zone", "zone-a", "deleted")], fromAttempt: 0, toAttempt: 4, fromLifecycle: 0, toLifecycle: 0 });
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
  policy = serviceZoneCreationPolicy(Result.getOrThrow(compileServiceZoneCreationContracts(metadata))); });

describe("native Service Zone command receipt correlation", () => {
  // Fixed transcripts test adapter correlation. Connected native roots prove
  // actual graph activity, event issuance and complete DB reads in both lanes.
  it("correlates exact new graph defaults, parent identity, complete DTO and native per-root message order", async () => {
    const call = createCall(), activity = creation(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, input: [{ name: "changed", fulfillment_set_id: "parent", geo_zones: [{ type: "country", country_code: "Raw" }] }] }, activity);
    await refused({ ...call, result: [{ ...output, fulfillment_set_id: "outside" }] }, activity);
    await refused({ ...call, result: [{ ...output, geo_zones: [{ ...geo, country_code: "forged" }] }] }, activity);
    await refused({ ...call, result: [{ ...output, shipping_options: [{ id: "fake" }] }] }, activity);
  });

  it("requires real ordered insert attempts and refuses sibling mutation or unowned reads", async () => {
    const call = createCall(), activity = creation(); await refused(call, empty());
    await refused(call, { ...activity, mutations: activity.mutations.slice(0, 1) });
    await refused(call, { ...activity, mutations: [...activity.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal })) });
    await refused(call, { ...activity, mutations: activity.mutations.map((mutation, ordinal) => ({ ...mutation, ordinal: ordinal + 1 })) });
    await refused(call, { ...activity, mutations: activity.mutations.map(mutation => mutation.table === "geo_zone" ? { ...mutation, table: "shipping_option_rule" } : mutation) });
    await refused(call, { ...activity, observedRows: [{ table: "fulfillment_set", row: zone }] });
    await refused(call, { ...activity, relationalReads: [read("service_zone", "id", ["zone-a"], 1)] });
    await refused({ ...call, events: [] }, activity); await refused({ ...call, mode: "read" }, activity);
  });

  it("retains empty creation without row/relation work or messages", async () => {
    const call = { ...createCall(), input: [], result: [], events: [], toAttempt: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, empty()));
    await refused({ ...call, result: [output] }, empty()); await refused({ ...call, events: [event("service_zone", "zone-a")] }, empty());
  });

  it("authenticates complete historical physical cascade while expecting only explicit root deletion events", async () => {
    const call = deleteCall(), activity = deletion(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, relationalReads: [] });
    for (const index of [0, 1, 2, 3]) await refused(call, { ...activity, relationalReads: activity.relationalReads.filter((_read, ordinal) => ordinal !== index) });
    await refused(call, { ...activity, relationalReads: activity.relationalReads.map(value => ({ ...value, total: 0, returned: 0 })) });
    await refused(call, { ...activity, mutations: activity.mutations.slice(1).map((mutation, ordinal) => ({ ...mutation, ordinal })) });
    await refused(call, { ...activity, mutations: [...activity.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal })) });
    await refused({ ...call, events: [...call.events, event("geo_zone", "geo-a", "deleted")] }, activity);
    await refused({ ...call, events: [] }, activity); await refused({ ...call, result: [] }, activity);
    const historic = (row: JsonObject) => ({ ...row, deleted_at: stamp });
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity,
      observedRows: activity.observedRows.map(value => ({ ...value, row: historic(value.row) })),
      mutations: activity.mutations.map(value => ({ ...value, before: value.before === null ? null : historic(value.before) })),
    }));
  });

  it("refuses extra/wrong-target read evidence and detached descendants while allowing equal observations", async () => {
    const call = deleteCall(), activity = deletion();
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity, observedRows: [...activity.observedRows, ...activity.observedRows] }));
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "service_zone", row: { ...zone, name: "conflicting" } }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "fulfillment_set", row: zone }] });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads, read("geo_zone", "service_zone_id", ["zone-a"], 1)] });
    for (const index of [0, 1, 2, 3]) await refused(call, { ...activity, relationalReads: deletionReads().map((value, ordinal) => ordinal === index
      ? { ...value, query: { ...value.query, predicate: { kind: "in", column: value.query.predicate.column, values: ["outside"] } } } : value) });
    for (const [table, row, foreign] of [["geo_zone", geo, "service_zone_id"], ["shipping_option", option, "service_zone_id"],
      ["shipping_option_rule", rule, "shipping_option_id"]] as const) {
      await refused(call, { ...activity, observedRows: activity.observedRows.map(value => value.table === table ? { ...value, row: { ...row, [foreign]: "outside" } } : value),
        mutations: activity.mutations.map(value => value.table === table ? { ...value, before: { ...row, [foreign]: "outside" } } : value) });
    }
  });

  it("correlates creation observations and exact mutation timestamps/identity without manufactured relations", async () => {
    const call = createCall(), activity = creation();
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity, observedRows: [{ table: "service_zone", row: zone }, { table: "geo_zone", row: geo }] }));
    await refused(call, { ...activity, observedRows: [{ table: "geo_zone", row: { ...geo, country_code: "forged" } }] });
    for (const extra of [{ id: "outside" }, { service_zone_id: "outside" }, { created_at: "2026-10-18T01:00:00.000Z" }, { deleted_at: stamp }])
      await refused(call, { ...activity, mutations: activity.mutations.map(value => value.table === "geo_zone" ? { ...value, after: { ...geo, ...extra } } : value) });
    await refused(call, { ...activity, mutations: [...activity.mutations, { ...activity.mutations[1]!, ordinal: 2 }] });
    await refused({ ...call, result: [{ ...output, geo_zones: [geo, geo] }] }, activity);
    await refused({ ...call, result: [{ ...output, fulfillment_set: { id: "parent" } }] }, activity);
  });

  it("requires authenticated zero-result inverse reads while retaining empty-ID skip", async () => {
    await Effect.runPromise(policy.validateLogicalCall({ ...deleteCall(), input: [], events: [], toAttempt: 0 }, empty()));
    const call = { ...deleteCall(), input: ["missing"], events: [], toAttempt: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, { ...empty(), relationalReads: [read("service_zone", "id", ["missing"], 0)] }));
    await refused(call, empty()); await refused(call, { ...empty(), relationalReads: [read("service_zone", "id", ["outside"], 0)] });
  });

  it("accepts UTF-8 ordered Unicode root reads and refuses reversed descendant-query groups", async () => {
    const bmp = "zone-\uE000", supplementary = "zone-\u{10000}", rawIds = [supplementary, bmp];
    const rootRows = [bmp, supplementary].map(id => ({ ...zone, id, name: id }));
    const call: Call = { ...deleteCall(), input: rawIds, events: [bmp, supplementary].map(id => event("service_zone", id, "deleted")), toAttempt: 2 };
    const groups = [bmp, supplementary].map(id => [read("shipping_option", "service_zone_id", [id], 0), read("geo_zone", "service_zone_id", [id], 0)]);
    const activity: Activity = { ...empty(), observedRows: [...rootRows].reverse().map(row => ({ table: "service_zone", row })),
      relationalReads: [read("service_zone", "id", rawIds, 2), ...groups.flat()],
      mutations: rootRows.map((before, ordinal) => ({ ordinal, table: "service_zone", operation: "delete", before, after: null })) };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, relationalReads: [read("service_zone", "id", rawIds, 2), ...groups.reverse().flat()] });
  });

  it("accepts UTF-8 ordered Unicode Option Rule reads and refuses their reversed query groups", async () => {
    const bmp = "option-\uE000", supplementary = "option-\u{10000}";
    const options = [bmp, supplementary].map(id => ({ ...option, id }));
    const rules = options.map((option, index) => ({ ...rule, id: "rule-" + index, shipping_option_id: option.id }));
    const ruleReads = [bmp, supplementary].map(id => read("shipping_option_rule", "shipping_option_id", [id], 1));
    const rootRead = read("service_zone", "id", ["zone-a"], 1), optionRead = read("shipping_option", "service_zone_id", ["zone-a"], 2),
      geoRead = read("geo_zone", "service_zone_id", ["zone-a"], 0);
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: zone },
      ...[...options].reverse().map(row => ({ table: "shipping_option", row })), ...rules.map(row => ({ table: "shipping_option_rule", row }))],
      relationalReads: [rootRead, optionRead, ...ruleReads, geoRead],
      mutations: [...rules.map(before => ({ table: "shipping_option_rule", before })), ...options.map(before => ({ table: "shipping_option", before })),
        { table: "service_zone", before: zone }].map((value, ordinal) => ({ ...value, ordinal, operation: "delete", after: null })) };
    const call = { ...deleteCall(), toAttempt: 5 };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, relationalReads: [rootRead, optionRead, ...ruleReads.reverse(), geoRead] });
  });
});
