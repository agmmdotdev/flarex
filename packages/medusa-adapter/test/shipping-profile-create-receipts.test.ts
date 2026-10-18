import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingProfileCreationContracts } from "../src/modules/fulfillment/shipping-profile-create-input";
import { shippingProfileCreationPolicy } from "../src/modules/fulfillment/shipping-profile-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingProfileCreationPolicy>;
const stamp = "2026-10-18T00:00:00.000Z";
const scalar = (id: string, extra: JsonObject = {}): JsonObject => ({ id, name: " Native Name ", metadata: null, type: " Mixed TYPE ",
  created_at: stamp, updated_at: stamp, deleted_at: null, ...extra });
const output = (id: string, extra: JsonObject = {}): JsonObject => ({ ...scalar(id, extra), shipping_options: [] });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (id: string | string[], action = "created"): Json => ({ name: "fulfillment.shipping-profile." + action,
  metadata: { source: "fulfillment", object: "shipping_profile", action }, data: { id } });
const created = (ids = ["sp-a"]): Activity => ({ ...empty(), observedRows: ids.map(id => ({ table: "shipping_profile", row: scalar(id) })), mutations: ids.map((id, ordinal) => ({ ordinal,
  table: "shipping_profile", operation: "insert", before: null, after: scalar(id) })) });
const createCall = (ids = ["sp-a"]): Call => ({ commandName: "shippingProfileCreateForWorkflow", mode: "write",
  input: ids.map(id => ({ id, name: " Native Name ", type: " Mixed TYPE " })), result: ids.map(id => output(id)), events: ids.map(id => event(id)),
  fromAttempt: 0, toAttempt: ids.length, fromLifecycle: 0, toLifecycle: 0 });
const query = (ids: string[]) => ({ take: defaultCommerceResources.queryRows,
  order: { column: "id" as const, direction: "asc" as const }, predicate: { kind: "in" as const, column: "id", values: ids } });
const deletion = (ids = ["sp-a"], historical = false): Activity => ({ ...empty(),
  relationalReads: [{ table: "shipping_profile", query: query(ids), total: ids.length, returned: ids.length },
    ...(ids.length && !historical ? [{ table: "shipping_option", query: { ...query(ids), predicate: { kind: "and" as const,
      children: [{ kind: "in" as const, column: "shipping_profile_id", values: [...ids].sort() }, { kind: "isNull" as const, column: "deleted_at" }] } }, total: 0, returned: 0 }] : []),
    ...(ids.length ? [{ table: "shipping_profile", query: query(ids), total: ids.length, returned: ids.length }] : [])],
  mutations: ids.map((id, ordinal) => ({ ordinal, table: "shipping_profile", operation: "delete", before: scalar(id, historical ? { deleted_at: stamp } : {}), after: null })),
  setNull: ids.map(id => ({ sourceTable: "shipping_option", sourceColumn: "shipping_profile_id", targetTable: "shipping_profile", targetColumn: "id", targetKey: id,
    managedUpdate: "preserve" })),
});
const deleteCall = (ids = ["sp-a"]): Call => ({ ...createCall(), commandName: "shippingProfilePhysicalDeleteForWorkflow",
  input: ids, result: null, events: ids.map(id => event(id, "deleted")), toAttempt: ids.length });
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = shippingProfileCreationPolicy(Result.getOrThrow(compileShippingProfileCreationContracts(
  (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame))); });

describe("native ShippingProfile command receipt correlation", () => {
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
    for (const result of [[output("sp-a", { type: "forged" })], [{ ...scalar("sp-a") }],
      [{ ...output("sp-a"), shipping_options: [{ id: "invented-option" }] }], [output("outside")]]) await refused({ ...call, result }, activity);
    for (const fields of [{ name: "forged" }, { metadata: { forged: true } }, { type: "forged" }, { id: "outside" }, { updated_at: "2026-10-18T01:00:00.000Z" }])
      await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, after: scalar("sp-a", fields) })) });
    const generated: Call = { ...call, input: [{ name: " Native Name ", type: " Mixed TYPE " }] };
    await Effect.runPromise(policy.validateLogicalCall(generated, activity));
  });

  it("requires actual creation attempts and exact event identities even for a complete DTO", async () => {
    const call = createCall(), activity = created();
    await refused(call, empty()); await refused({ ...call, events: [] }, activity);
    for (const events of [[event("outside")], [event("sp-a"), event("sp-a")], [event("sp-a", "deleted")]]) await refused({ ...call, events }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, ordinal: 1 })) });
    await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, operation: "patch", before: scalar("sp-a") })) });
    await refused(call, { ...activity, observedRows: [] });
    await refused(call, { ...activity, observedRows: [{ table: "shipping_profile", row: scalar("sp-a", { name: "forged" }) }] });
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity, observedRows: [...activity.observedRows, ...activity.observedRows] }));
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
    await Effect.runPromise(policy.validateLogicalCall(deleteCall(), deletion(["sp-a"], true)));
    await Effect.runPromise(policy.validateLogicalCall(deleteCall([]), deletion([])));
    const missing = { ...deleteCall(["missing"]), events: [] };
    await Effect.runPromise(policy.validateLogicalCall(missing, { ...empty(), relationalReads: [
      { table: "shipping_profile", query: query(["missing"]), total: 0, returned: 0 },
      { table: "shipping_profile", query: query(["missing"]), total: 0, returned: 0 },
    ] }));
    await refused(missing, empty());
  });

  it("refuses sibling mutation, relation repair, unmanaged activity and read-mode receipts", async () => {
    const call = createCall(), activity = created();
    for (const table of ["shipping_option", "shipping_option_type", "service_zone", "fulfillment_set", "fulfillment_provider"])
      await refused(call, { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, table })) });
    await refused({ ...call, mode: "read" }, activity); await refused({ ...call, commandName: "shippingProfileCreate" }, activity);
    await refused(call, { ...activity, observedRows: [{ table: "shipping_option", row: scalar("sp-a") }] });
    await refused(call, { ...activity, relationalReads: deletion().relationalReads });
    await refused(call, { ...activity, lifecycle: [{ table: "shipping_profile", operation: "softDelete", key: { id: "sp-a" },
      beforeDeletedAt: null, afterDeletedAt: stamp, attemptOrdinal: 0, rowAtOperation: null }] });
    const intent = { sourceTable: "shipping_option", sourceColumn: "shipping_profile_id", targetTable: "shipping_profile", targetColumn: "id", targetKey: "sp-a" };
    await refused(call, { ...activity, setNull: [{ ...intent, managedUpdate: "preserve" }] }); await refused(call, { ...activity, referenceReplacements: [{ ...intent, desiredKeys: [] }] });
  });

  it("requires exactly one preserve-mode terminal intent for each actual physical deletion", async () => {
    const call = deleteCall(), activity = deletion(), intent = activity.setNull[0];
    if (intent === undefined) throw new Error("Missing physical detach intent");
    await refused(call, { ...activity, setNull: [] });
    await refused(call, { ...activity, setNull: [intent, intent] });
    for (const changed of [{ ...intent, managedUpdate: "advance" as const }, { ...intent, sourceTable: "product" },
      { ...intent, sourceColumn: "shipping_option_type_id" }, { ...intent, targetTable: "shipping_option_type" },
      { ...intent, targetColumn: "name" }, { ...intent, targetKey: "missing" }])
      await refused(call, { ...activity, setNull: [changed] });
    await refused(call, { ...activity, observedRows: [{ table: "shipping_profile", row: scalar("sp-a") }] });
    await refused(call, { ...activity, mutations: [...activity.mutations, {
      ordinal: 1, table: "shipping_option", operation: "patch", before: scalar("sp-a"), after: scalar("sp-a"),
    }] });
  });

  it("keeps raw duplicate and missing requests separate from actual inverse roots and intents", async () => {
    const ids = ["sp-a", "missing", "sp-a", "မရှိ"], activity = deletion();
    const raw: Activity = { ...activity, relationalReads: activity.relationalReads.map((read, index) => read.table === "shipping_profile"
      // Genuine buildQuery deduplicates the guard selector. The subsequent
      // physical DAL selection retains the raw duplicated input independently.
      ? { ...read, query: query(index === 0 ? [...new Set(ids)] : ids) } : read) };
    await Effect.runPromise(policy.validateLogicalCall({ ...deleteCall(), input: ids }, raw));
    await refused({ ...deleteCall(), input: ids }, { ...raw, setNull: [...raw.setNull, ...raw.setNull] });
  });

  it("keeps historical validation candidates separate from the surviving Option writes derived at settlement", async () => {
    const option = { id: "so-a", name: "Shipping", price_type: "flat", data: null, metadata: { retained: true },
      service_zone_id: "zone-a", shipping_profile_id: "sp-a", provider_id: null, shipping_option_type_id: "type-a",
      created_at: stamp, updated_at: stamp, deleted_at: stamp };
    const call = deleteCall(), activity: Activity = { ...deletion(), observedRows: [{ table: "shipping_option", row: option }] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity, observedRows: [...activity.observedRows, ...activity.observedRows] }));
    for (const changed of [{ ...option, shipping_profile_id: "outside" }, { ...option, shipping_profile_id: null }, { ...option, deleted_at: null }])
      await refused(call, { ...activity, observedRows: [{ table: "shipping_option", row: changed }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "shipping_option", row: { ...option, name: "forged" } }] });
  });
});
