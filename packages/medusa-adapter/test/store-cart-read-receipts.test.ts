import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureStoreMetadata } from "../src/modules/store/schema";
import { prepareStoreCartReadRepository } from "../src/modules/store/cart-read-repository";
import { storeCartReadPolicy } from "../src/modules/store/cart-read-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let prepared: Result.Result.Success<ReturnType<typeof prepareStoreCartReadRepository>>;
let policy: ReturnType<typeof storeCartReadPolicy>;
const stamp = "2026-10-22T00:00:00.000Z";
const store = (id: string): JsonObject => ({ id, name: "Native Cart Store", default_sales_channel_id: "sc_cart160",
  default_region_id: "reg_cart160", default_location_id: null, metadata: null,
  created_at: stamp, updated_at: stamp, deleted_at: null });
const rows = [store("store_a160"), store("store_b160")];
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const activity = (): Activity => ({ ...empty(), observedRows: rows.map(row => ({ table: "store", row })), relationalReads: [{
  table: "store", query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
    { kind: "and", children: [] }, { kind: "isNull", column: "deleted_at" },
  ] }, "id", { includeIdentities: true }), total: 2, returned: 2, orderedIdentities: rows.map(row => ({ id: row.id! })),
}] });
const call = (): Call => ({ commandName: "storeListForCartContext", mode: "read", input: {
  filters: {}, config: { select: ["id", "default_sales_channel_id"] },
}, result: rows.map(row => ({ id: row.id!, default_sales_channel_id: row.default_sales_channel_id! })), events: [],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const refused = async (receipt: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  prepared = Result.getOrThrow(prepareStoreCartReadRepository((await Effect.runPromise(captureStoreMetadata())).frame));
  policy = storeCartReadPolicy(prepared);
});

describe("native Cart Store context read receipts", () => {
  it("binds the default-channel selection to complete actual Store rows and ordered membership", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call(), activity()));
    const complete: Call = { ...call(), input: { filters: {} }, result: rows };
    await Effect.runPromise(policy.validateLogicalCall(complete, activity()));
    await refused({ ...complete, result: rows.map(row => ({ ...row, supported_currencies: [], supported_locales: [] })) }, activity());
  });

  it("requires complete stored scalars even when native projection omits them", async () => {
    const broken = { ...rows[0] };
    delete broken.name;
    await refused(call(), { ...activity(), observedRows: [{ table: "store", row: broken }, { table: "store", row: rows[1]! }] });
    await refused(call(), { ...activity(), observedRows: [{ table: "store", row: { ...rows[0], name: false } }, { table: "store", row: rows[1]! }] });
  });

  it("rejects changed query, truncation, missing identity and duplicate or reversed membership", async () => {
    const evidence = activity(), read = evidence.relationalReads[0]!;
    if (!isJsonObject(read.query)) throw new Error("Expected the Store read fixture's query object");
    for (const changed of [{ ...read, query: { ...read.query, includeIdentities: false } }, { ...read, total: 3 },
      { ...read, returned: 1 }, { ...read, orderedIdentities: [{ id: rows[0]!.id! }] },
      { ...read, orderedIdentities: [{ id: rows[0]!.id! }, { id: rows[0]!.id! }] },
      { ...read, orderedIdentities: [...read.orderedIdentities ?? []].reverse() }])
      await refused(call(), { ...evidence, relationalReads: [changed] });
    await refused(call(), { ...evidence, relationalReads: [] });
    await refused(call(), { ...evidence, relationalReads: [read, read] });
  });

  it("authenticates native count and page while retaining the complete cohort receipt", async () => {
    const counted: Call = { ...call(), commandName: "storeCountForCartContext", input: {
      filters: {}, config: { select: ["id"], take: 1, skip: 1, order: { id: "DESC" } },
    }, result: [[{ id: rows[0]!.id! }], 2] };
    await Effect.runPromise(policy.validateLogicalCall(counted, activity()));
    await refused({ ...counted, result: [[{ id: rows[1]!.id! }], 2] }, activity());
    await refused({ ...counted, result: [[{ id: rows[0]!.id! }], 1] }, activity());
  });

  it("rejects forged scalar results, events, mutations and unrelated child observations", async () => {
    await refused({ ...call(), result: [{ id: rows[0]!.id!, default_sales_channel_id: "sc_forged160" }] }, activity());
    await refused({ ...call(), events: [{ name: "store.store.updated" }] }, activity());
    await refused(call(), { ...activity(), mutations: [{ ordinal: 0, table: "store", operation: "delete", before: rows[0]!, after: null }] });
    await refused(call(), { ...activity(), observedRows: [...activity().observedRows, { table: "store_currency", row: { id: "stocur_unrelated160" } }] });
    await refused({ ...call(), commandName: "storeListForSalesChannelGuard" }, activity());
  });

  it("refuses non-Cart selectors, historical roots and child projections", () => {
    for (const query of [{ where: { default_sales_channel_id: ["sc_cart160"] } }, { where: { id: "store_a160" } },
      { options: { fields: ["supported_currencies"] } }, { options: { populate: ["supported_locales"] } },
      { options: { filters: { softDeletable: { withDeleted: true } } } }])
      expect(Result.isFailure(prepared.query(query))).toBe(true);
  });
});
