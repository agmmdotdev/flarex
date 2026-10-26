import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { preparePaymentCollectionLinkLifecycle } from "../src/links/payment-collection-lifecycle";
import { workflowMethodDefinition } from "../src/workflow/module";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCommerceInput } from "../src/value/input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const stamp = "2026-10-23T00:00:00.000Z";
for (const kind of ["cart", "order"] as const) describe(kind + " collection Link lifecycle causality", () => {
  let runtime: Effect.Success<ReturnType<typeof preparePaymentCollectionLinkLifecycle>>;
  const endpoint = kind + "_id", table = kind + "_payment_collection";
  const row = (owner = "owner"): JsonObject => ({ id: "link-causality", [endpoint]: owner,
    payment_collection_id: "paycol", created_at: stamp, updated_at: stamp, deleted_at: null });
  const input = [{ [kind]: { [endpoint]: "owner" }, payment: { payment_collection_id: "paycol" } }];
  beforeAll(async () => { runtime = await Effect.runPromise(preparePaymentCollectionLinkLifecycle(kind)); });
  const packet = (after = row()) => {
    const call: Call = { commandName: "paymentCollectionLinkCreate", mode: "write", input, result: [after],
      events: [{ name: runtime.prepared.entityName + ".attached", metadata: { source: runtime.prepared.serviceName,
        object: runtime.prepared.entityName, action: "attached" }, data: { id: "link-causality" } }],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const query = Result.getOrThrow(captureCommerceInput(buildQuery({
      $or: [{ [endpoint]: { $ne: "owner" }, payment_collection_id: "paycol" }],
    }, { take: 1 })));
    const plan = Result.getOrThrow(runtime.prepared.prepared.readPlan(query, defaultCommerceResources.queryRows));
    const activity: Activity = { observedRows: [], relationalReads: [{ table, query: plan.query, total: 0, returned: 0 }], mutations: [{ ordinal: 0, table, operation: "insert", before: null, after }],
      lifecycle: [], setNull: [], referenceReplacements: [] };
    return { call, activity };
  };
  const validate = (value: ReturnType<typeof packet>) => runtime.logicalEventPolicy().validateLogicalCall(value.call, value.activity);
  const refused = async (value: ReturnType<typeof packet>) => expect(await Effect.runPromise(Effect.result(validate(value)))).toMatchObject({ _tag: "Failure" });
  it("binds native creation to the requested endpoint pair and exact result", async () => {
    await Effect.runPromise(validate(packet()));
    await refused(packet(row("foreign")));
    const value = packet();
    await refused({ ...value, call: { ...value.call, result: [] } });
    await refused({ ...value, call: { ...value.call, result: [{ ...row(), id: "forged" }] } });
    await refused({ ...value, activity: { ...value.activity, relationalReads: [{ table, query: {}, total: 0, returned: 0 }] } });
    await refused({ ...value, activity: { ...value.activity, relationalReads: [] } });
    await refused({ ...value, activity: { ...value.activity, relationalReads: value.activity.relationalReads.map(read => ({ ...read, total: 1, returned: 1 })) } });
    await refused({ ...value, activity: { ...value.activity, mutations: [] } });
  });
  it("admits witnessed absent dismissal and its native empty result", async () => {
    const selector = { $or: [{ $and: [{ [endpoint]: "owner" }, { payment_collection_id: "paycol" }] }] };
    const plan = Result.getOrThrow(runtime.prepared.prepared.lifecycleReadPlan("softDelete", selector, defaultCommerceResources.queryRows));
    const value = packet();
    const absent = { call: { ...value.call, commandName: "paymentCollectionLinkDismiss", result: [], events: [] }, activity: {
      ...value.activity, mutations: [], relationalReads: [{ table, query: plan.query, total: 0, returned: 0 }],
    } };
    await Effect.runPromise(validate(absent));
    const method = workflowMethodDefinition(runtime.workflow.methods.dismiss);
    if (method === undefined) throw new Error("Missing genuine native dismiss method");
    expect(Result.getOrThrow(method.output([]))).toEqual([]);
    await refused({ ...absent, activity: { ...absent.activity, relationalReads: [] } });
    await refused({ ...absent, activity: { ...absent.activity, observedRows: [{ table, row: row() }] } });
    await refused({ ...absent, call: { ...absent.call, result: [row()] } });
  });
});
