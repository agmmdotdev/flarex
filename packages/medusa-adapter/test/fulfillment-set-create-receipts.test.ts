import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentSetCreationContracts, decodeFulfillmentSetCreates } from "../src/modules/fulfillment/fulfillment-set-create-input";
import { fulfillmentSetCreationPolicy } from "../src/modules/fulfillment/fulfillment-set-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const stamp = "2026-10-18T00:00:00.000Z";
const row: JsonObject = { id: "fuset-a", name: " Native Set ", type: "", metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const event = (action: string): Json => ({ name: "fulfillment.fulfillment-set." + action,
  metadata: { source: "fulfillment", object: "fulfillment_set", action }, data: { id: "fuset-a" } });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const createCall = (): Call => ({ commandName: "fulfillmentSetCreateForWorkflow", mode: "write", input: [{ name: " Native Set ", type: "" }],
  result: [{ ...row, service_zones: [] }], events: [event("created")], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 });
const created = (): Activity => ({ ...empty(), observedRows: [{ table: "fulfillment_set", row }],
  mutations: [{ ordinal: 0, table: "fulfillment_set", operation: "insert", before: null, after: row }] });
let policy: ReturnType<typeof fulfillmentSetCreationPolicy>;
beforeAll(async () => { const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
  policy = fulfillmentSetCreationPolicy(Result.getOrThrow(compileFulfillmentSetCreationContracts(metadata))); });
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("native scalar FulfillmentSet creation receipts", () => {
  it("admits one new scalar root, preserving empty native strings but no supplied IDs or graph branches", () => {
    expect(Result.isSuccess(decodeFulfillmentSetCreates([{ name: "", type: "" }]))).toBe(true);
    expect(Result.isFailure(decodeFulfillmentSetCreates([{ id: "supplied", name: "", type: "" }]))).toBe(true);
    expect(Result.isFailure(decodeFulfillmentSetCreates([{ name: "", type: "", service_zones: [] }]))).toBe(true);
    expect(Result.isFailure(decodeFulfillmentSetCreates([{ name: "a", type: "" }, { name: "b", type: "" }]))).toBe(true);
  });
  it("correlates actual defaults, empty inverse presentation, mutations and final observations", async () => {
    const call = createCall(), activity = created();
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, empty());
    await refused(call, { ...activity, observedRows: [] });
    await refused(call, { ...activity, observedRows: [{ table: "fulfillment_set", row: { ...row, name: "forged" } }] });
    await refused(call, { ...activity, mutations: [...activity.mutations, ...activity.mutations] });
    await refused({ ...call, result: [{ ...row, metadata: {}, service_zones: [] }] }, activity);
    await refused({ ...call, result: [{ ...row, service_zones: [{ id: "invented" }] }] }, activity);
    await refused({ ...call, events: [] }, activity);
    await refused({ ...call, events: [event("created"), event("deleted")] }, activity);
  });
  it("requires the complete physical root and empty-child read without inventing child events", async () => {
    const call: Call = { ...createCall(), commandName: "fulfillmentSetPhysicalDeleteForWorkflow", input: ["fuset-a"], result: null, events: [event("deleted")] };
    const read = (table: string, column: string, total: number) => ({ table, query: { take: defaultCommerceResources.queryRows,
      order: { column: "id", direction: "asc" as const }, predicate: { kind: "in" as const, column, values: ["fuset-a"] } }, total, returned: total });
    const activity: Activity = { ...empty(), relationalReads: [read("fulfillment_set", "id", 1), read("service_zone", "fulfillment_set_id", 0)],
      mutations: [{ ordinal: 0, table: "fulfillment_set", operation: "delete", before: row, after: null }] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, relationalReads: activity.relationalReads.slice(0, 1) });
    await refused(call, { ...activity, mutations: [] });
    await refused(call, { ...activity, observedRows: [{ table: "fulfillment_set", row: { ...row, metadata: { forged: true } } }] });
    await refused({ ...call, events: [event("created")] }, activity);
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], events: [], toAttempt: 0 }, empty()));
  });
});
