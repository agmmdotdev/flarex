import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureRegionMetadata } from "../src/modules/region/schema";
import { prepareRegionReadRepository } from "../src/modules/region/repository";
import { regionReadPolicy } from "../src/modules/region/receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof regionReadPolicy>;
const stamp = "2026-10-18T00:00:00.000Z", row = { id: "region", name: "Native", currency_code: "usd", automatic_taxes: true, metadata: null,
  created_at: stamp, updated_at: stamp, deleted_at: null };
const call = (): Call => ({ commandName: "regionListForShippingOptions", mode: "read", input: { filters: { id: ["region"] } }, result: [row],
  events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const read = (ids = ["region"], total = 1) => ({ table: "region", query: { take: defaultCommerceResources.queryRows,
  order: { column: "id", direction: "asc" as const }, predicate: { kind: "and", children: [
    { kind: "and", children: [{ kind: "in", column: "id", values: ids }] }, { kind: "isNull", column: "deleted_at" }] } }, total, returned: total });
const activity = (): Activity => ({ observedRows: [{ table: "region", row }], relationalReads: [read()], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const refused = async (value: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = regionReadPolicy(Result.getOrThrow(prepareRegionReadRepository((await Effect.runPromise(captureRegionMetadata())).frame))); });

describe("native Region read receipt correlation", () => {
  it("correlates all eight distinct Regions required by the complete four-Option price envelope", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...row, id: "region-" + index })), ids = rows.map(value => value.id);
    await Effect.runPromise(policy.validateLogicalCall({ ...call(), input: { filters: { id: ids } }, result: rows },
      { ...activity(), observedRows: rows.map(row => ({ table: "region", row })), relationalReads: [read(ids, 8)] }));
  });
  it("correlates full and selected native rows with exact actual read evidence", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call(), activity()));
    await Effect.runPromise(policy.validateLogicalCall({ ...call(), input: { filters: { id: ["region"] }, config: { select: ["id", "currency_code"] } },
      result: [{ id: "region", currency_code: "usd" }] }, activity()));
    await refused({ ...call(), result: [{ ...row, countries: [] }] }, activity());
    await refused({ ...call(), result: [{ ...row, currency_code: "eur" }] }, activity());
    await refused(call(), { ...activity(), relationalReads: [] });
    await refused(call(), { ...activity(), relationalReads: [read(["outside"])] });
    await refused(call(), { ...activity(), observedRows: [{ table: "region", row: { ...row, automatic_taxes: "forged" } }] });
  });

  it("authenticates empty and missing-ID reads without hydrating Countries", async () => {
    const value = { ...call(), input: { filters: { id: [] } }, result: [] }, empty = { ...activity(), observedRows: [], relationalReads: [read([], 0)] };
    await Effect.runPromise(policy.validateLogicalCall(value, empty));
    await refused(value, { ...empty, relationalReads: [] });
    await Effect.runPromise(policy.validateLogicalCall({ ...value, input: { filters: { id: ["missing"] } } }, { ...empty, relationalReads: [read(["missing"], 0)] }));
    await refused(call(), { ...activity(), observedRows: [...activity().observedRows, { table: "region_country", row }] });
  });

  it("retains active-read semantics over historical candidates and refuses writes or events", async () => {
    const value = { ...call(), result: [] }, evidence = { ...activity(), observedRows: [{ table: "region", row: { ...row, deleted_at: stamp } }], relationalReads: [read(["region"], 0)] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(call(), evidence);
    await refused(call(), { ...activity(), mutations: [{ ordinal: 0, table: "region", operation: "insert", before: null, after: row }] });
    await refused({ ...call(), events: [{ name: "unadmitted" }] }, activity());
  });
});
