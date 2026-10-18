import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionTypeCreationContracts } from "../src/modules/fulfillment/shipping-option-type-input";
import { shippingOptionTypeCreationPolicy } from "../src/modules/fulfillment/shipping-option-type-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingOptionTypeCreationPolicy>;
const stamp = "2026-10-18T00:00:00.000Z";
const scalar = (id: string, extra: JsonObject = {}): JsonObject => ({ id, label: " Native Label ", description: null, code: " Same Code ",
  created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const output = (id: string, extra: JsonObject = {}): JsonObject => ({ ...scalar(id, extra), shipping_options: [] });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string | string[], action = "created"): Json => ({ name: "fulfillment.shipping-option-type." + action,
  metadata: { source: "fulfillment", object: "shipping_option_type", action }, data: { id } });
const created = (ids = ["sotype-a"]): Activity => ({ ...empty(), mutations: ids.map((id, ordinal) => ({ ordinal,
  table: "shipping_option_type", operation: "insert", before: null, after: scalar(id) })) });
const createCall = (ids = ["sotype-a"]): Call => ({ commandName: "shippingOptionTypeCreateForWorkflow", mode: "write",
  input: ids.map(id => ({ id, label: " Native Label ", code: " Same Code " })), result: ids.map(id => output(id)), events: ids.map(id => event(id)),
  fromAttempt: 0, toAttempt: ids.length, fromLifecycle: 0, toLifecycle: 0 });
const deletion = (ids = ["sotype-a"]): Activity => ({ ...empty(),
  observedRows: ids.map(id => ({ table: "shipping_option_type", row: scalar(id) })),
  relationalReads: [{ table: "shipping_option_type", query: { take: defaultCommerceResources.queryRows,
    order: { column: "id", direction: "asc" }, predicate: { kind: "in", column: "id", values: ids } }, total: ids.length, returned: ids.length }],
  mutations: ids.map((id, ordinal) => ({ ordinal, table: "shipping_option_type", operation: "delete", before: scalar(id), after: null })),
});
const deleteCall = (ids = ["sotype-a"]): Call => ({ ...createCall(), commandName: "shippingOptionTypePhysicalDeleteForWorkflow",
  input: ids, result: null, events: ids.map(id => event(id, "deleted")), toAttempt: ids.length });
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = shippingOptionTypeCreationPolicy(Result.getOrThrow(compileShippingOptionTypeCreationContracts(
  (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame))); });

describe("native ShippingOptionType command receipt correlation", () => {
  // Fixed transcripts test correlation. Connected workflows prove the actual
  // shared-storage activity and native event issuer in each database lane.
  it("correlates all four complete rows, scalar defaults and actual insert/event order", async () => {
    const ids = ["d", "b", "c", "a"], call = createCall(ids), activity = created(ids);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, result: [...ids].reverse().map(id => output(id)) }, activity);
    await refused({ ...call, events: [...ids].reverse().map(id => event(id)) }, activity);
    await refused({ ...call, result: ids.slice(0, 3).map(id => output(id)) }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.slice(0, 3) });
  });

  it("refuses forged scalar/relation outputs and generated/supplied identity mismatches", async () => {
    const call = createCall(), activity = created();
    for (const result of [[output("sotype-a", { code: "forged" })], [{ ...scalar("sotype-a") }],
      [{ ...output("sotype-a"), shipping_options: [{ id: "invented-option" }] }], [output("outside")]]) await refused({ ...call, result }, activity);
    for (const fields of [{ label: "forged" }, { description: "forged" }, { code: "forged" }, { id: "outside" }, { updated_at: "2026-10-18T01:00:00.000Z" }])
      await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, after: scalar("sotype-a", fields) })) });
    const generated: Call = { ...call, input: [{ label: " Native Label ", code: " Same Code " }] };
    await Effect.runPromise(policy.validateLogicalCall(generated, activity));
  });

  it("requires actual creation attempts and exact event identities even for a complete DTO", async () => {
    const call = createCall(), activity = created();
    await refused(call, empty()); await refused({ ...call, events: [] }, activity);
    for (const events of [[event("outside")], [event("sotype-a"), event("sotype-a")], [event("sotype-a", "deleted")]]) await refused({ ...call, events }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, ordinal: 1 })) });
    await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, operation: "patch", before: scalar("sotype-a") })) });
  });

  it("retains empty native creation with no repository work or events", async () => {
    await Effect.runPromise(policy.validateLogicalCall(createCall([]), empty()));
    await refused({ ...createCall([]), events: [event("invented")] }, empty());
    await refused({ ...createCall([]), result: [output("invented")] }, empty());
  });

  it("authenticates physical inverse against the complete historical selection including empty results", async () => {
    await Effect.runPromise(policy.validateLogicalCall(deleteCall(), deletion()));
    await refused(deleteCall(), { ...deletion(), relationalReads: [] });
    await refused(deleteCall(), { ...deletion(), relationalReads: deletion().relationalReads.map(read => ({ ...read, total: 0, returned: 0 })) });
    await refused(deleteCall(), { ...deletion(), mutations: [] });
    await refused({ ...deleteCall(), result: [] }, deletion());
    await refused({ ...deleteCall(), events: [] }, deletion());
    const historical = scalar("sotype-a", { deleted_at: stamp });
    const activity: Activity = { ...deletion(), observedRows: [{ table: "shipping_option_type", row: historical }],
      mutations: [{ ordinal: 0, table: "shipping_option_type", operation: "delete", before: historical, after: null }] };
    await Effect.runPromise(policy.validateLogicalCall(deleteCall(), activity));
    await Effect.runPromise(policy.validateLogicalCall(deleteCall([]), empty()));
    const missing = { ...deleteCall(["missing"]), events: [] };
    await Effect.runPromise(policy.validateLogicalCall(missing, { ...empty(), relationalReads: deletion(["missing"]).relationalReads.map(read => ({ ...read, total: 0, returned: 0 })) }));
    await refused(missing, empty());
  });

  it("refuses sibling mutation, relation repair, unmanaged activity and read-mode receipts", async () => {
    const call = createCall(), activity = created();
    for (const table of ["shipping_option", "shipping_profile", "service_zone", "fulfillment_set", "fulfillment_provider"])
      await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, table })) });
    await refused({ ...call, mode: "read" }, activity); await refused({ ...call, commandName: "shippingProfileCreate" }, activity);
    await refused(call, { ...activity, observedRows: [{ table: "shipping_option", row: scalar("sotype-a") }] });
    await refused(call, { ...activity, relationalReads: deletion().relationalReads });
    await refused(call, { ...activity, lifecycle: [{ table: "shipping_option_type", operation: "softDelete", key: { id: "sotype-a" },
      beforeDeletedAt: null, afterDeletedAt: stamp, attemptOrdinal: 0, rowAtOperation: null }] });
    const intent = { sourceTable: "shipping_option", sourceColumn: "shipping_option_type_id", targetTable: "shipping_option_type", targetColumn: "id", targetKey: "sotype-a" };
    await refused(call, { ...activity, setNull: [{ ...intent, managedUpdate: "advance" }] }); await refused(call, { ...activity, referenceReplacements: [{ ...intent, desiredKeys: [] }] });
  });
});
