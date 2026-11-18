import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingProfileDeletionContracts } from "../src/modules/fulfillment/shipping-profile-delete-input";
import { shippingProfileDeletionPolicy } from "../src/modules/fulfillment/shipping-profile-delete-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingProfileDeletionPolicy>;
const stamp = "2026-10-17T00:00:00.000Z", later = "2026-10-17T01:00:00.000Z";
const profile = (id: string, fields: JsonObject = {}): JsonObject => ({ id, name: id, type: "custom", metadata: { kept: true },
  created_at: stamp, updated_at: stamp, deleted_at: null, ...fields });
const option = (id: string, fields: JsonObject = {}): JsonObject => ({ id, name: id, price_type: "flat", data: null, metadata: null,
  service_zone_id: "zone-a", shipping_profile_id: "sp-a", provider_id: null, shipping_option_type_id: "type-a",
  created_at: stamp, updated_at: stamp, deleted_at: stamp, ...fields });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const rootRead = (ids: string[], count: number): Activity["relationalReads"][number] => ({ table: "shipping_profile",
  query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
    predicate: { kind: "in", column: "id", values: ids } }, total: count, returned: count });
const optionRead = (ids: string[]): Activity["relationalReads"][number] => ({ table: "shipping_option",
  query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
    predicate: { kind: "and", children: [{ kind: "in", column: "shipping_profile_id", values: ids },
      { kind: "isNull", column: "deleted_at" }] } }, total: 0, returned: 0 });
const event = (id: string | string[], action: "deleted" | "restored" = "deleted"): Json => ({
  name: `fulfillment.shipping-profile.${action}`, metadata: { source: "fulfillment", object: "shipping_profile", action }, data: { id },
});
const call = (ids: string[] = ["sp-a", "sp-a", "missing"], restore = false): Call => ({
  commandName: restore ? "shippingProfileRestoreForWorkflow" : "shippingProfileSoftDeleteForWorkflow", mode: "write", input: ids,
  result: { shipping_profile_id: ["sp-a"] }, events: [event("sp-a", restore ? "restored" : "deleted")],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const deletion = (): Activity => {
  const before = profile("sp-a"), after = profile("sp-a", { updated_at: later, deleted_at: later });
  return { ...empty(), observedRows: [{ table: "shipping_profile", row: after }],
    relationalReads: [rootRead(["sp-a", "missing"], 1), optionRead(["sp-a"]), rootRead(["sp-a", "sp-a", "missing"], 1)],
    mutations: [{ ordinal: 0, table: "shipping_profile", operation: "patch", before, after }],
    lifecycle: [{ table: "shipping_profile", operation: "softDelete", key: { id: "sp-a" }, beforeDeletedAt: null,
      afterDeletedAt: later, attemptOrdinal: 0, rowAtOperation: null }] };
};
const refused = async (receipt: Call, evidence: Activity) => {
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
};
beforeAll(async () => {
  policy = shippingProfileDeletionPolicy(Result.getOrThrow(compileShippingProfileDeletionContracts(
    (await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame)));
});

describe("native ShippingProfile deletion receipt correlation", () => {
  // Fixed transcripts prove receipt correlation, not storage authentication.
  // Both connected database lanes provide the genuine activity witnesses.
  it("retains raw selector duplicates and authenticates exact result maps and lifecycle events", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call(), deletion()));
    for (const result of [{}, { shipping_profile_id: ["missing"] }, { shipping_profile_id: ["sp-a", "sp-a"] },
      { shipping_profile_id: [] }, { shipping_profile_id: ["sp-a"], shipping_option_id: ["so-a"] }])
      await refused({ ...call(), result }, deletion());
    await refused({ ...call(), input: ["outside"] }, deletion());
    for (const events of [[], [event("missing")], [event("sp-a"), event("sp-a")], [event("sp-a", "restored")]])
      await refused({ ...call(), events }, deletion());
  });

  it("authenticates all four complete roots in actual transition and event order", async () => {
    const ids = ["sp-a", "sp-b", "sp-c", "sp-d"];
    const evidence: Activity = { ...empty(), observedRows: [...ids].reverse().map(id => ({ table: "shipping_profile", row: profile(id) })),
      relationalReads: [rootRead(ids, 4), optionRead(ids), rootRead(ids, 4)],
      mutations: ids.map((id, ordinal) => ({ ordinal, table: "shipping_profile", operation: "patch",
        before: profile(id), after: profile(id, { updated_at: later, deleted_at: later }) })),
      lifecycle: ids.map((id, attemptOrdinal) => ({ table: "shipping_profile", operation: "softDelete", key: { id },
        beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal, rowAtOperation: null })) };
    const receipt: Call = { ...call(ids), result: { shipping_profile_id: ids }, events: [event(ids)] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: { shipping_profile_id: [...ids].reverse() } }, evidence);
    await refused({ ...receipt, events: [event([...ids].reverse())] }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.slice(0, 3) });
    await refused({ ...receipt, input: [...ids, "sp-a"] }, evidence);
    await refused(receipt, { ...evidence, observedRows: [...evidence.observedRows, { table: "shipping_profile", row: profile("outside") }] });
  });

  it("retains empty, missing and already-deleted root selectors without invented effects", async () => {
    const cases: ReadonlyArray<Readonly<{ ids: string[]; reads: Activity["relationalReads"]; rows: Activity["observedRows"] }>> = [
      { ids: [], reads: [rootRead([], 0)], rows: [] },
      { ids: ["missing"], reads: [rootRead(["missing"], 0), rootRead(["missing"], 0)], rows: [] },
      { ids: ["sp-a", "sp-a"], reads: [rootRead(["sp-a"], 1), rootRead(["sp-a", "sp-a"], 1)],
        rows: [{ table: "shipping_profile", row: profile("sp-a", { deleted_at: stamp }) }] },
    ];
    for (const { ids, reads, rows } of cases) {
      const receipt: Call = { ...call(ids), result: {}, events: [] };
      const evidence: Activity = { ...empty(), relationalReads: reads, observedRows: rows };
      await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
      await refused({ ...receipt, result: { shipping_profile_id: ["invented"] } }, evidence);
    }
    await refused({ ...call(), result: {}, events: [] }, { ...empty(), observedRows: [{ table: "shipping_profile", row: profile("sp-a") }] });
  });

  it("retains broad native restore and active restore no-op rows", async () => {
    const before = profile("sp-a", { deleted_at: stamp }), after = profile("sp-a", { updated_at: later });
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_profile", row: after }],
      relationalReads: [rootRead(["sp-a", "sp-a", "missing"], 1)],
      mutations: [{ ordinal: 0, table: "shipping_profile", operation: "patch", before, after }],
      lifecycle: [{ table: "shipping_profile", operation: "restore", key: { id: "sp-a" }, beforeDeletedAt: stamp,
        afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null }] };
    await Effect.runPromise(policy.validateLogicalCall(call(undefined, true), evidence));
    const active = profile("sp-a"), noop: Activity = { ...empty(), relationalReads: [rootRead(["sp-a", "sp-a", "missing"], 1)],
      lifecycle: [{ table: "shipping_profile", operation: "restore",
      key: { id: "sp-a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active }] };
    await Effect.runPromise(policy.validateLogicalCall(call(undefined, true), noop));
    await refused(call(undefined, true), { ...noop, lifecycle: noop.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
    await refused(call(undefined, true), { ...noop, lifecycle: noop.lifecycle.map(value => ({ ...value, rowAtOperation: { id: "sp-a" } })) });
    await refused(call(undefined, true), { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, beforeDeletedAt: null })) });
    await refused({ ...call(undefined, true), events: [event("sp-a")] }, evidence);
  });

  it("retains authentic deleted Option candidates and refuses active Option bypasses or foreign owners", async () => {
    const evidence = deletion();
    await Effect.runPromise(policy.validateLogicalCall(call(), { ...evidence,
      observedRows: [...evidence.observedRows, { table: "shipping_option", row: option("so-a") }] }));
    const malformed: JsonObject[] = [{ deleted_at: null }, { shipping_profile_id: "outside" }, { shipping_profile_id: null },
      { service_zone_id: null }, { extra: true }];
    for (const fields of malformed)
      await refused(call(), { ...evidence, observedRows: [...evidence.observedRows, { table: "shipping_option", row: option("so-a", fields) }] });
    await refused(call(), { ...evidence, observedRows: [...evidence.observedRows,
      ...Array.from({ length: 9 }, (_, index) => ({ table: "shipping_option", row: option(`so-${index}`, { deleted_at: null }) }))] });
    await refused(call(undefined, true), { ...empty(), observedRows: [{ table: "shipping_option", row: option("so-a") }] });
  });

  it("requires exact complete validation reads before lifecycle, including empty results", async () => {
    const evidence = deletion();
    await refused(call(), { ...evidence, relationalReads: [] });
    await refused(call(), { ...evidence, relationalReads: evidence.relationalReads.slice(1) });
    await refused(call(), { ...evidence, relationalReads: evidence.relationalReads.filter(value => value.table !== "shipping_option") });
    await refused(call(), { ...evidence, relationalReads: [...evidence.relationalReads].reverse() });
    await refused(call(), { ...evidence, relationalReads: [...evidence.relationalReads, rootRead(["sp-a"], 1)] });
    const first = evidence.relationalReads[0], child = evidence.relationalReads[1];
    if (first === undefined || child === undefined) throw new Error("Missing fixed native read transcript");
    await refused(call(), { ...evidence, relationalReads: [rootRead([], 0), child, evidence.relationalReads[2] ?? first] });
    await refused(call(), { ...evidence, relationalReads: [first, optionRead([]), evidence.relationalReads[2] ?? first] });
    await refused(call(), { ...evidence, relationalReads: evidence.relationalReads.map(value => ({ ...value, returned: 0 })) });
    await refused(call(), { ...evidence, relationalReads: evidence.relationalReads.map(value => value.table === "shipping_option"
      ? { ...value, total: 1, returned: 1 } : value) });
    const emptyCall: Call = { ...call([]), result: {}, events: [] };
    await Effect.runPromise(policy.validateLogicalCall(emptyCall, { ...empty(), relationalReads: [rootRead([], 0)] }));
    await refused(emptyCall, empty());
  });

  it("denies Option and parent mutations, lifecycle changes and foreign observations", async () => {
    const evidence = deletion();
    for (const table of ["shipping_option", "service_zone", "fulfillment_set", "shipping_option_type", "fulfillment_provider", "product"])
      await refused(call(), { ...evidence, mutations: [...evidence.mutations, { ordinal: 1, table,
        operation: "patch", before: option("so-a"), after: option("so-a", { deleted_at: later }) }] });
    for (const table of ["shipping_option", "service_zone", "fulfillment_set", "fulfillment_provider"])
      await refused(call(), { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, table })) });
    for (const table of ["service_zone", "fulfillment_set", "shipping_option_type", "fulfillment_provider", "product"])
      await refused(call(), { ...evidence, observedRows: [...evidence.observedRows, { table, row: option("so-a") }] });
    const intent = { sourceTable: "shipping_option", sourceColumn: "shipping_profile_id", targetTable: "shipping_profile",
      targetColumn: "id", targetKey: "sp-a" };
    await refused(call(), { ...evidence, setNull: [{ ...intent, managedUpdate: "advance" }] });
    await refused(call(), { ...evidence, referenceReplacements: [{ ...intent, desiredKeys: [] }] });
  });

  it("preserves all root scalar fields and rejects malformed transitions and attempt evidence", async () => {
    const evidence = deletion();
    const fieldsToForge: JsonObject[] = [{ name: "forged" }, { type: "other" }, { metadata: null }, { created_at: later }, { extra: true }];
    for (const fields of fieldsToForge)
      await refused(call(), { ...evidence, mutations: evidence.mutations.map(value => ({ ...value,
        after: value.after === null ? null : { ...value.after, ...fields } })) });
    for (const attemptOrdinal of [null, 1, 99]) await refused(call(), { ...evidence,
      lifecycle: evidence.lifecycle.map(value => ({ ...value, attemptOrdinal })) });
    await refused(call(), { ...evidence, lifecycle: [] });
    await refused(call(), { ...evidence, mutations: [] });
    await refused(call(), { ...evidence, lifecycle: [...evidence.lifecycle, ...evidence.lifecycle] });
    await refused(call(), { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, ordinal: 9 })) });
    await refused(call(), { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, before: null })) });
    await refused(call(), { ...evidence, mutations: evidence.mutations.map<Activity["mutations"][number]>(value => ({ ...value, operation: "delete", after: null })) });
    await refused(call(), { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, key: { id: "sp-a", extra: "foreign" } })) });
    await refused(call(), { ...evidence, observedRows: [{ table: "shipping_profile", row: { id: "sp-a" } }] });
    await refused({ ...call(), mode: "read" }, evidence);
    for (const commandName of ["shippingProfileCreate", "shippingProfileUpdateForWorkflow", "storeSoftDeleteForWorkflow"])
      await refused({ ...call(), commandName }, evidence);
  });

  it("projects only the two private document fields and captures exact event identities", async () => {
    const evidence = deletion(), document = (row: JsonObject): JsonObject => ({ ...row, _id: `doc-${row.id}`, _creationTime: 1 });
    await Effect.runPromise(policy.validateLogicalCall(call(), { ...evidence,
      observedRows: evidence.observedRows.map(value => ({ ...value, row: document(value.row) })),
      mutations: evidence.mutations.map(value => ({ ...value, before: value.before === null ? null : document(value.before),
        after: value.after === null ? null : document(value.after) })) }));
    await refused(call(), { ...evidence, observedRows: evidence.observedRows.map(value => ({ ...value, row: { ...value.row, _revision: "foreign" } })) });
    for (const message of [
      { name: "fulfillment.shipping-profile.deleted", metadata: { source: "product", object: "shipping_profile", action: "deleted" }, data: { id: "sp-a" } },
      { name: "fulfillment.shipping-option.deleted", metadata: { source: "fulfillment", object: "shipping_option", action: "deleted" }, data: { id: "so-a" } },
      { name: "fulfillment.shipping-profile.updated", metadata: { source: "fulfillment", object: "shipping_profile", action: "updated" }, data: { id: "sp-a" } },
      { name: "fulfillment.shipping-profile.deleted", metadata: { source: "fulfillment", object: "shipping_profile", action: "deleted" }, data: { id: [] } },
      { name: "fulfillment.shipping-profile.deleted", metadata: { source: "fulfillment", object: "shipping_profile", action: "deleted" }, data: { id: Array(5).fill("sp-a") } },
    ]) expect(await Effect.runPromise(Effect.result(policy.capture(message))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });
});
