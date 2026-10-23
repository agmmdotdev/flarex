import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRateDeletionContracts, decodeTaxRateDeletionIds, decodeTaxRateDeletionOutput } from "../src/modules/tax/rate-delete-input";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileTaxRateDeletionContracts>>;
const stamp = "2020-01-02T03:04:05.000Z";
const rule = { id: "txrule169-contract", tax_rate_id: "txr169-contract", reference: "product", reference_id: "prod169-contract",
  metadata: null, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const row = { id: "txr169-contract", tax_region_id: "txreg169-contract", rate: 7, code: "DELETE169", name: "Contract Rate",
  is_default: false, is_combinable: false, metadata: null, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const region = { id: "txreg169-contract", country_code: "us", province_code: null, parent_id: null, provider_id: "tp_system",
  metadata: null, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const ids = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeTaxRateDeletionIds));
beforeAll(async () => { contracts = Result.getOrThrow(compileTaxRateDeletionContracts((await Effect.runPromise(captureTaxMetadata())).frame)); });

describe("bounded native Tax Rate deletion contracts", () => {
  it("preserves empty, duplicate, absent and empty-string request identities", () => {
    for (const value of [[], [""], ["b", "a", "a", "missing"], Array.from({ length: 4 }, (_, index) => `rule-${index}`)]) {
      const decoded = Result.getOrThrow(ids(value)); expect(decoded).toEqual(value); expect(decoded).not.toBe(value);
    }
  });
  it.each([["scalar", "rule"], ["null", null], ["object", { id: "rule" }], ["null member", [null]], ["number member", [3]],
    ["fifth ID", Array.from({ length: 5 }, (_, index) => `rule-${index}`)], ["overlong member", ["x".repeat(257)]]])
    ("refuses %s", (_name, value) => { expect(Result.isFailure(ids(value))).toBe(true); });
  it("refuses accessors without evaluating caller code", () => {
    let invoked = false; const value: unknown[] = [];
    Object.defineProperty(value, "0", { enumerable: true, get() { invoked = true; return "rule"; } });
    expect(Result.isFailure(ids(value))).toBe(true); expect(invoked).toBe(false);
  });
  it("admits only genuine Rate and Rule affected-map keys and unique bounded cohorts", () => {
    for (const value of [{}, { tax_rate_id: ["rate-a", "rate-b"], tax_rate_rule_id: ["rule-a"] }, { tax_rate_id: ["rate-a"] }])
      expect(Result.getOrThrow(decodeTaxRateDeletionOutput(value))).toEqual(value);
    for (const value of [null, [], { tax_rate_id: [] }, { tax_rate_id: ["rate-a", "rate-a"] }, { tax_rate_id: [""] },
      { tax_rate_id: ["rate-a"], tax_region_id: ["parent"] }, { tax_rate_rule_id: ["rule-a", "rule-a"] },
      { tax_rate_id: Array.from({ length: 5 }, (_, index) => `rate-${index}`) },
      { tax_rate_rule_id: Array.from({ length: 9 }, (_, index) => `rule-${index}`) }])
      expect(Result.isFailure(decodeTaxRateDeletionOutput(value))).toBe(true);
  });
  it("requires every scalar Rate, Rule and Region field and rejects relation bodies", () => {
    for (const [value, decode] of [[row, contracts.decodeRateRow], [rule, contracts.decodeRuleRow], [region, contracts.decodeRegionRow]] as const) {
      expect(Result.getOrThrow(decode(value))).toEqual(value);
      for (const field of Object.keys(value)) { const incomplete: Record<string, unknown> = { ...value }; delete incomplete[field];
        expect(Result.isFailure(decode(incomplete))).toBe(true); }
      for (const extra of [{ extra: true }, { deleted_at: false }, { tax_region: { id: region.id } }])
        expect(Result.isFailure(decode({ ...value, ...extra }))).toBe(true);
    }
  });
  it("preserves general JSON metadata without narrowing business payloads", () => {
    for (const metadata of [null, [], "metadata", 7, false, { nested: [null, "x"] }]) {
      expect(Result.getOrThrow(contracts.decodeRateRow({ ...row, metadata }))).toEqual({ ...row, metadata });
      expect(Result.getOrThrow(contracts.decodeRuleRow({ ...rule, metadata }))).toEqual({ ...rule, metadata });
    }
  });
  it("authenticates all three required models and their native relationships", async () => {
    const metadata = (await Effect.runPromise(captureTaxMetadata())).frame;
    for (const name of ["tax_rate", "tax_rate_rule", "tax_region"])
      expect(Result.isFailure(compileTaxRateDeletionContracts({ ...metadata, tables: metadata.tables.filter(table => table.name !== name) }))).toBe(true);
    for (const name of ["tax_rate", "tax_rate_rule"])
      expect(Result.isFailure(compileTaxRateDeletionContracts({ ...metadata, tables: metadata.tables.map(table => table.name === name
        ? { ...table, foreignKeys: [] } : table) }))).toBe(true);
  });
  it("authenticates complete Rate-root lifecycle tuples without accepting unrelated models or duplicate IDs", () => {
    const child = { ...rule, tax_rate_id: row.id };
    const tuple = [[row], { TaxRate: [row], TaxRateRule: [child] }];
    expect(Result.getOrThrow(contracts.decodeLifecycleResult(tuple))).toEqual(tuple);
    for (const value of [[[row], {}], [[row], { TaxRate: [{ ...row, code: "altered" }] }],
      [[row, row], { TaxRate: [row, row] }], [[row], { TaxRate: [row], TaxRegion: [] }],
      [[row], { TaxRate: [row], TaxRateRule: [child, child] }],
      [[row], { TaxRate: [row], TaxRateRule: [{ ...child, tax_rate_id: "foreign" }] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(value))).toBe(true);
  });
});
