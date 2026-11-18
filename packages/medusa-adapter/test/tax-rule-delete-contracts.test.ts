import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRuleDeletionContracts, decodeTaxRuleDeletionIds, decodeTaxRuleDeletionOutput } from "../src/modules/tax/rule-delete-input";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileTaxRuleDeletionContracts>>;
const stamp = "2020-01-02T03:04:05.000Z";
const row = { id: "txrule166-contract", tax_rate_id: "txr166-contract", reference: "product", reference_id: "prod166-contract",
  metadata: null, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const ids = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeTaxRuleDeletionIds));
beforeAll(async () => { contracts = Result.getOrThrow(compileTaxRuleDeletionContracts((await Effect.runPromise(captureTaxMetadata())).frame)); });

describe("bounded native Tax Rule deletion contracts", () => {
  it("preserves empty, duplicate, absent and empty-string request identities", () => {
    for (const value of [[], [""], ["b", "a", "a", "missing"], Array.from({ length: 8 }, (_, index) => `rule-${index}`)]) {
      const decoded = Result.getOrThrow(ids(value)); expect(decoded).toEqual(value); expect(decoded).not.toBe(value);
    }
  });
  it.each([["scalar", "rule"], ["null", null], ["object", { id: "rule" }], ["null member", [null]], ["number member", [3]],
    ["ninth ID", Array.from({ length: 9 }, (_, index) => `rule-${index}`)], ["overlong member", ["x".repeat(257)]]])
    ("refuses %s", (_name, value) => { expect(Result.isFailure(ids(value))).toBe(true); });
  it("refuses accessors without evaluating caller code", () => {
    let invoked = false; const value: unknown[] = [];
    Object.defineProperty(value, "0", { enumerable: true, get() { invoked = true; return "rule"; } });
    expect(Result.isFailure(ids(value))).toBe(true); expect(invoked).toBe(false);
  });
  it("admits only the native affected-map key and complete unique cohorts", () => {
    for (const value of [{}, { tax_rate_rule_id: ["rule-a", "rule-b"] }]) expect(Result.getOrThrow(decodeTaxRuleDeletionOutput(value))).toEqual(value);
    for (const value of [null, [], { tax_rate_rule_id: [] }, { tax_rate_rule_id: ["rule-a", "rule-a"] },
      { tax_rate_rule_id: [""] }, { tax_rate_rule_id: ["rule-a"], tax_rate_id: ["parent"] }])
      expect(Result.isFailure(decodeTaxRuleDeletionOutput(value))).toBe(true);
  });
  it("requires all native Rule fields and preserves general JSON metadata", () => {
    for (const metadata of [null, [], "metadata", 7, false, { nested: [null, "x"] }])
      expect(Result.getOrThrow(contracts.decodeRuleRow({ ...row, metadata }))).toEqual({ ...row, metadata });
    for (const field of Object.keys(row)) {
      const incomplete: Record<string, unknown> = { ...row }; delete incomplete[field];
      expect(Result.isFailure(contracts.decodeRuleRow(incomplete))).toBe(true);
    }
    for (const value of [{ ...row, extra: true }, { ...row, tax_rate: { id: row.tax_rate_id } }, { ...row, deleted_at: false }])
      expect(Result.isFailure(contracts.decodeRuleRow(value))).toBe(true);
  });
  it("authenticates native Rule metadata and the parent relationship", async () => {
    const metadata = (await Effect.runPromise(captureTaxMetadata())).frame;
    expect(Result.isFailure(compileTaxRuleDeletionContracts({ ...metadata, tables: metadata.tables.filter(table => table.name !== "tax_rate_rule") }))).toBe(true);
    expect(Result.isFailure(compileTaxRuleDeletionContracts({ ...metadata, tables: metadata.tables.map(table => table.name === "tax_rate_rule"
      ? { ...table, foreignKeys: [] } : table) }))).toBe(true);
  });
  it("authenticates complete native lifecycle tuples, unique rows and four-parent closure", () => {
    expect(Result.getOrThrow(contracts.decodeLifecycleResult([[row], { TaxRateRule: [row] }]))).toEqual([[row], { TaxRateRule: [row] }]);
    for (const value of [[[row], {}], [[row], { TaxRateRule: [{ ...row, reference: "altered" }] }],
      [[row, row], { TaxRateRule: [row, row] }], [[row], { TaxRateRule: [row], TaxRate: [] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(value))).toBe(true);
    const cohort = Array.from({ length: 5 }, (_, index) => ({ ...row, id: `rule-${index}`, tax_rate_id: `parent-${index}` }));
    expect(Result.isFailure(contracts.decodeLifecycleResult([cohort, { TaxRateRule: cohort }]))).toBe(true);
  });
});
