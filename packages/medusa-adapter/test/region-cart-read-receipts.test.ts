import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureRegionMetadata } from "../src/modules/region/schema";
import { prepareRegionCartReadRepository } from "../src/modules/region/cart-read-repository";
import { regionCartReadPolicy } from "../src/modules/region/cart-read-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof regionCartReadPolicy>;
const stamp = "2026-10-22T00:00:00.000Z", region = { id: "reg-a", name: "Native", currency_code: "usd", automatic_taxes: true,
  metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const country = { iso_2: "us", iso_3: "usa", num_code: "840", name: "UNITED STATES", display_name: "United States", region_id: "reg-a",
  metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const call = (): Call => ({ commandName: "regionListForCart", mode: "read", input: { filters: { id: "reg-a" }, config: { relations: ["countries"] } },
  result: [{ ...region, countries: [country] }], events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const rootRead = (total = 1) => ({ table: "region", query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
  predicate: { kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "id", values: ["reg-a"] }] }, { kind: "isNull", column: "deleted_at" }] } }, total, returned: total });
const countryRead = (total = 1) => ({ table: "region_country", query: { take: defaultCommerceResources.queryRows, order: { column: "iso_2", direction: "asc" },
  predicate: { kind: "and", children: [{ kind: "in", column: "region_id", values: ["reg-a"] }, { kind: "isNull", column: "deleted_at" }] } }, total, returned: total });
const activity = (): Activity => ({ observedRows: [{ table: "region", row: region }, { table: "region_country", row: country }],
  relationalReads: [rootRead(), countryRead()], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const refused = async (value: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = regionCartReadPolicy(Result.getOrThrow(prepareRegionCartReadRepository((await Effect.runPromise(captureRegionMetadata())).frame))); });

describe("Cart Region/Country authenticated read correlation", () => {
  it("correlates genuine Country keys and active complete relation cohorts", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call(), activity()));
    await Effect.runPromise(policy.validateLogicalCall({ ...call(), commandName: "regionCountForCart", result: [call().result, 1] }, activity()));
    await Effect.runPromise(policy.validateLogicalCall({ ...call(), result: [{ ...region, countries: [] }] },
      { ...activity(), observedRows: [{ table: "region", row: region }], relationalReads: [rootRead(), countryRead(0)] }));
    await Effect.runPromise(policy.validateLogicalCall({ ...call(), result: [] },
      { ...activity(), observedRows: [], relationalReads: [rootRead(0)] }));
    await Effect.runPromise(policy.validateLogicalCall({ ...call(), result: [{ ...region, countries: [] }] },
      { ...activity(), observedRows: [{ table: "region", row: region }, { table: "region_country", row: { ...country, deleted_at: stamp } }], relationalReads: [rootRead(), countryRead(0)] }));
  });

  it("refuses missing/truncated reads, wrong owners, conflicting identities and invented relation results", async () => {
    await refused(call(), { ...activity(), relationalReads: [rootRead()] });
    await refused(call(), { ...activity(), relationalReads: [rootRead(), { ...countryRead(), returned: 0 }] });
    await refused(call(), { ...activity(), observedRows: [{ table: "region", row: region }, { table: "region_country", row: { ...country, region_id: "outside" } }] });
    await refused(call(), { ...activity(), observedRows: [...activity().observedRows, { table: "region_country", row: { ...country, iso_3: "forged" } }] });
    await refused({ ...call(), result: [{ ...region, countries: [] }] }, activity());
    await refused({ ...call(), commandName: "regionListForShippingOptions" }, activity());
    await refused({ ...call(), events: [{ name: "unadmitted" }] }, activity());
    await refused(call(), { ...activity(), mutations: [{ ordinal: 0, table: "region_country", operation: "insert", before: null, after: country }] });
  });

  it("authenticates the native null default Region selector as an actual nonnullable-id query", async () => {
    const query = { ...rootRead(0).query, predicate: { kind: "and", children: [
      { kind: "and", children: [{ kind: "isNull", column: "id" }] }, { kind: "isNull", column: "deleted_at" }] } };
    const value = { ...call(), input: { filters: { id: null }, config: { relations: ["countries"] } }, result: [] };
    const evidence = { ...activity(), observedRows: [], relationalReads: [{ ...rootRead(0), query }] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, relationalReads: [] });
    await refused(value, { ...evidence, relationalReads: [rootRead(0)] });
    await refused(value, { ...evidence, observedRows: [{ table: "region", row: region }] });
  });
});
